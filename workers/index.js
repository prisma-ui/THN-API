/**
 * THN API — Cloudflare Workers Bundle
 * Single file, no external dependencies, paste directly to CF Dashboard
 */

// ─── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://thehackernews.com";
const RSS_SOURCES = [
  "https://feeds.feedburner.com/TheHackersNews",
  "https://api.allorigins.win/get?url=" + encodeURIComponent("https://feeds.feedburner.com/TheHackersNews"),
  "https://corsproxy.io/?" + encodeURIComponent("https://feeds.feedburner.com/TheHackersNews"),
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE = new Map();
function getCache(key) {
  const e = CACHE.get(key);
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function setCache(key, data, ttl) {
  CACHE.set(key, { data, exp: Date.now() + ttl });
}

// ─── CORS / Response helpers ──────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResp(data, status = 200) {
  return new Response(
    JSON.stringify({ success: true, timestamp: new Date().toISOString(), ...data }, null, 2),
    { status, headers: CORS }
  );
}
function errResp(msg, status = 500) {
  return new Response(
    JSON.stringify({ success: false, error: msg, timestamp: new Date().toISOString() }),
    { status, headers: CORS }
  );
}

// ─── HTML Mini-Parser (no cheerio needed) ────────────────────────────────────

/**
 * Extract all occurrences of a tag with its attributes and inner text
 */
function findTags(html, tag) {
  const results = [];
  const re = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(html)) !== null) {
    results.push({ attrs: m[1], inner: m[2] });
  }
  return results;
}

function getAttr(attrsStr, attr) {
  const re = new RegExp(`${attr}=["']([^"']+)["']`, "i");
  const m = attrsStr.match(re);
  return m ? m[1] : null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getMeta(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i");
  const m = html.match(re) || html.match(re2);
  return m ? m[1] : null;
}

function cleanDateRaw(text) {
  return (text || "").replace(/^[^A-Za-z0-9]+/, "").trim();
}

function parseDateLabel(text) {
  if (!text) return null;
  try {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (_) {}
  return null;
}

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE_URL + url;
  return url;
}

function extractSlug(url) {
  if (!url) return "";
  return url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.html$/, "").replace(/\/$/, "");
}

function estimateReadTime(text) {
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
}

// ─── Article card parser ──────────────────────────────────────────────────────

function parseArticleCard(html) {
  const url = (html.match(/class="story-link"[^>]*href="([^"]+)"/) ||
               html.match(/href="([^"]+)"[^>]*class="story-link"/))?.[1] || "";
  const title = stripTags(html.match(/<h2[^>]*class="[^"]*home-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ||
                           html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
  const summary = stripTags(html.match(/<div[^>]*class="[^"]*home-desc[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");

  // Image
  const imgMatch = html.match(/<img[^>]+(data-src|data-original|src)="([^"]+)"[^>]*>/i);
  const image = imgMatch ? imgMatch[2] : "";

  // Date
  const labelHtml = html.match(/<[^>]+class="[^"]*(?:item-label|h-datetime)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "";
  const dateRaw = cleanDateRaw(stripTags(labelHtml.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ""));

  // Tags
  const tags = [];
  const tagRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let tm;
  while ((tm = tagRe.exec(labelHtml)) !== null) {
    const t = stripTags(tm[1]).trim();
    if (t) tags.push(t);
  }

  const author = stripTags(html.match(/rel="author"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ||
                            html.match(/class="author-name"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "") || null;
  const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";

  return { slug, url, title, summary, image: normalizeImageUrl(image), date: parseDateLabel(dateRaw), date_raw: dateRaw, tags, author };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(referer = null, cookies = "") {
  const ua = getRandomUA();
  const isFF = ua.includes("Firefox");
  const h = {
    "User-Agent": ua,
    "Accept": isFF
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
  };
  if (!isFF) {
    h["sec-ch-ua"] = `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`;
    h["sec-ch-ua-mobile"] = "?0";
    h["sec-ch-ua-platform"] = '"Windows"';
  }
  if (referer) h["Referer"] = referer;
  if (cookies) h["Cookie"] = cookies;
  return h;
}

const cfCookies = {};
function storeCFCookies(domain, headers) {
  const raw = headers.get("set-cookie");
  if (!raw) return;
  raw.split(",").forEach(part => {
    const [kv] = part.trim().split(";");
    const [k, v] = (kv || "").split("=");
    if (k && v) {
      if (!cfCookies[domain]) cfCookies[domain] = {};
      cfCookies[domain][k.trim()] = v.trim();
    }
  });
}
function getCFCookies(domain) {
  return Object.entries(cfCookies[domain] || {}).map(([k, v]) => `${k}=${v}`).join("; ");
}

function isCFChallenge(html, status) {
  if (status === 403 || status === 503) return true;
  if (typeof html !== "string") return false;
  return html.includes("cf-browser-verification") ||
    html.includes("cf_chl_prog") ||
    html.includes("Checking your browser") ||
    (html.includes("cloudflare") && html.includes("challenge"));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchHTML(url, retries = 3) {
  const domain = new URL(url).hostname;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(800 * i + Math.floor(Math.random() * 700));
    try {
      const isArticle = url !== BASE_URL && !url.includes("?");
      const res = await fetch(url, {
        headers: buildHeaders(isArticle ? BASE_URL + "/" : null, getCFCookies(domain)),
        redirect: "follow",
      });
      storeCFCookies(domain, res.headers);
      const status = res.status;
      const html = await res.text();
      if (isCFChallenge(html, status)) {
        const e = new Error("Cloudflare challenge detected");
        e.isCFChallenge = true;
        e.status = status;
        throw e;
      }
      if (status === 200) return html;
      const e = new Error(`HTTP ${status}`);
      e.status = status;
      throw e;
    } catch (err) {
      lastErr = err;
      if (err.isCFChallenge) throw err;
      if (err.status && err.status !== 429 && err.status < 500) throw err;
    }
  }
  throw lastErr;
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

function parseRSSXml(xml) {
  const articles = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const url = stripTags(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "") ||
                stripTags(item.match(/<feedburner:origLink>([\s\S]*?)<\/feedburner:origLink>/i)?.[1] || "");
    const title = stripTags(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const summary = stripTags(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "").slice(0, 300);
    const pubDate = stripTags(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "");
    const author = stripTags(item.match(/<author>([\s\S]*?)<\/author>/i)?.[1] || "") || null;
    const image = item.match(/media:content[^>]+url="([^"]+)"/i)?.[1] ||
                  item.match(/<enclosure[^>]+url="([^"]+)"/i)?.[1] || null;
    const tags = [];
    const catRe = /<category>([\s\S]*?)<\/category>/gi;
    let cm;
    while ((cm = catRe.exec(item)) !== null) {
      const t = stripTags(cm[1]).trim();
      if (t) tags.push(t);
    }
    const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";
    const parsedDate = pubDate ? new Date(pubDate).toISOString() : null;
    if (title && url) articles.push({ slug, url, title, summary, image: normalizeImageUrl(image), date: parsedDate, date_raw: pubDate, tags, author, source: "rss" });
  }
  return { page_url: RSS_SOURCES[0], count: articles.length, articles, next_page_url: null, next_cursor: null, pagination: null, source: "rss_fallback" };
}

async function fetchRSS() {
  for (const src of RSS_SOURCES) {
    try {
      const res = await fetch(src, {
        headers: { "User-Agent": getRandomUA(), "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!res.ok) continue;
      let text = await res.text();
      if (src.includes("allorigins.win")) {
        try { text = JSON.parse(text).contents || text; } catch (_) {}
      }
      const result = parseRSSXml(text);
      if (result.count > 0) return result;
    } catch (e) {
      console.warn("[THN] RSS source failed:", src, e.message);
    }
  }
  throw new Error("All RSS sources failed");
}

// ─── Scrapers ─────────────────────────────────────────────────────────────────

async function scrapeArticleList(pageUrl = BASE_URL) {
  try {
    const html = await fetchHTML(pageUrl);
    const articles = [];
    const cardRe = /<div[^>]+class="[^"]*body-post[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]+class="[^"]*body-post|<\/div>)/gi;
    let m;
    while ((m = cardRe.exec(html)) !== null) {
      const a = parseArticleCard(m[0]);
      if (a.title && a.url) articles.push(a);
    }
    if (articles.length === 0) return await fetchRSS();

    // Pagination
    const olderMatch = html.match(/id="blog-pager-older-link"[^>]*href="([^"]+)"/i) ||
                       html.match(/href="([^"]+)"[^>]*id="blog-pager-older-link"/i);
    const nextUrl = olderMatch ? olderMatch[1] : null;
    const cursorMatch = nextUrl?.match(/[?&]updated-max=([^&]+)/);
    const cursor = cursorMatch ? decodeURIComponent(cursorMatch[1]) : null;

    return {
      page_url: pageUrl, count: articles.length, articles,
      next_page_url: nextUrl, next_cursor: cursor,
      pagination: nextUrl ? { next_url: nextUrl, cursor } : null,
      source: "scraper",
    };
  } catch (err) {
    const isCF = err.isCFChallenge || err.status === 403 || err.status === 429 || err.status === 503;
    if (isCF || !err.status) return await fetchRSS();
    throw err;
  }
}

async function scrapeArticle(articleUrl) {
  const url = articleUrl.startsWith("http") ? articleUrl : `${BASE_URL}/${articleUrl}`;
  const html = await fetchHTML(url);

  const title = getMeta(html, "og:title") || stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = getMeta(html, "og:description") || getMeta(html, "description") || "";
  const image = getMeta(html, "og:image") || null;
  const canonicalUrl = getMeta(html, "og:url") ||
    html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1] || url;
  const publishedAt = getMeta(html, "article:published_time") || null;
  const modifiedAt = getMeta(html, "article:modified_time") || null;
  const author = stripTags(html.match(/rel="author"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || "") || null;

  const tags = [];
  const tagRe = /class="[^"]*(?:label|post-labels)[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
  let tm;
  while ((tm = tagRe.exec(html)) !== null) {
    const t = stripTags(tm[1]).trim();
    if (t && !tags.includes(t)) tags.push(t);
  }

  const bodyMatch = html.match(/<div[^>]+(?:class="articlebody"|id="articlebody"|class="post-body"|class="entry-content")[^>]*>([\s\S]*?)<\/div>/i);
  const bodyHtml = bodyMatch?.[1] || "";

  const paragraphs = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRe.exec(bodyHtml)) !== null) {
    const t = stripTags(pm[1]).trim();
    if (t && t.length > 20) paragraphs.push(t);
  }

  const links = [];
  const linkRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let lm;
  while ((lm = linkRe.exec(bodyHtml)) !== null) {
    if (!lm[1].includes("thehackernews.com")) {
      links.push({ text: stripTags(lm[2]).trim(), url: lm[1] });
    }
  }

  const images = [];
  const imgRe = /<img[^>]+(?:data-src|data-original|src)="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi;
  let im;
  while ((im = imgRe.exec(bodyHtml)) !== null) {
    const src = im[1];
    if (src && !src.startsWith("data:")) images.push({ src: normalizeImageUrl(src), alt: im[2] || "" });
  }

  return {
    url: canonicalUrl, slug: extractSlug(canonicalUrl), title, description,
    image: normalizeImageUrl(image), author, published_at: publishedAt, modified_at: modifiedAt,
    tags, read_time_minutes: estimateReadTime(paragraphs.join(" ")),
    content: { paragraphs, images, links, html: bodyHtml },
  };
}

async function scrapeCategory(category, cursor = null) {
  let url = `${BASE_URL}/search/label/${encodeURIComponent(category)}`;
  if (cursor) url += `?updated-max=${encodeURIComponent(cursor)}&max-results=10`;
  const result = await scrapeArticleList(url);
  return { ...result, category };
}

async function scrapeSearch(query) {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHTML(url);
    const articles = [];
    const cardRe = /<div[^>]+class="[^"]*body-post[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*body-post|$)/gi;
    let m;
    while ((m = cardRe.exec(html)) !== null) {
      const a = parseArticleCard(m[0]);
      if (a.title && a.url) articles.push(a);
    }
    return { query, count: articles.length, articles };
  } catch (_) {
    const rss = await fetchRSS();
    const q = query.toLowerCase();
    const filtered = rss.articles.filter(a =>
      a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q)
    );
    return { query, count: filtered.length, articles: filtered, source: "rss_search_fallback" };
  }
}

async function scrapeSiteMeta() {
  const categories = [
    "Data Breaches","Cyber Attack","Vulnerability","Malware","Ransomware",
    "Phishing","Security","Privacy","Zero Day","APT","AI Security",
    "Cloud Security","Mobile Security","IoT Security","Cryptography",
  ].map(name => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), url: `${BASE_URL}/search/label/${encodeURIComponent(name)}` }));
  return { site: "The Hacker News", base_url: BASE_URL, categories };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const q = Object.fromEntries(url.searchParams);

    try {
      // GET /api/news
      if (path === "/api/news" || path === "/api") {
        const pageUrl = q.page_url || null;
        const key = `news:${pageUrl || "home"}`;
        const cached = getCache(key);
        if (cached) return jsonResp({ cached: true, ...cached });
        const data = await scrapeArticleList(pageUrl || undefined);
        setCache(key, data, 5 * 60 * 1000);
        return jsonResp({ cached: false, ...data });
      }

      // GET /api/news/:slug
      const newsSlug = path.match(/^\/api\/news\/(.+)$/);
      if (newsSlug) {
        const slug = newsSlug[1];
        const articleUrl = `${BASE_URL}/${slug}`;
        const key = `article:${articleUrl}`;
        const cached = getCache(key);
        if (cached) return jsonResp({ cached: true, article: cached });
        const article = await scrapeArticle(articleUrl);
        setCache(key, article, 30 * 60 * 1000);
        return jsonResp({ cached: false, article });
      }

      // GET /api/article?url=
      if (path === "/api/article") {
        if (!q.url) return errResp("Missing ?url=", 400);
        const key = `article:${q.url}`;
        const cached = getCache(key);
        if (cached) return jsonResp({ cached: true, article: cached });
        const article = await scrapeArticle(q.url);
        setCache(key, article, 30 * 60 * 1000);
        return jsonResp({ cached: false, article });
      }

      // GET /api/category/:name
      const catMatch = path.match(/^\/api\/category\/(.+)$/);
      if (catMatch) {
        const name = decodeURIComponent(catMatch[1]);
        const key = `cat:${name}:${q.cursor || "0"}`;
        const cached = getCache(key);
        if (cached) return jsonResp({ cached: true, category: name, ...cached });
        const data = await scrapeCategory(name, q.cursor || null);
        setCache(key, data, 5 * 60 * 1000);
        return jsonResp({ cached: false, category: name, ...data });
      }

      // GET /api/search?q=
      if (path === "/api/search") {
        if (!q.q) return errResp("Missing ?q=", 400);
        const key = `search:${q.q}`;
        const cached = getCache(key);
        if (cached) return jsonResp({ cached: true, query: q.q, ...cached });
        const data = await scrapeSearch(q.q);
        setCache(key, data, 2 * 60 * 1000);
        return jsonResp({ cached: false, ...data });
      }

      // GET /api/meta
      if (path === "/api/meta") {
        const cached = getCache("meta");
        if (cached) return jsonResp({ cached: true, ...cached });
        const data = await scrapeSiteMeta();
        setCache("meta", data, 60 * 60 * 1000);
        return jsonResp({ cached: false, ...data });
      }

      if (path === "/" || path === "") {
        return jsonResp({
          name: "THN API",
          endpoints: ["/api/news", "/api/news/:slug", "/api/article?url=", "/api/category/:name", "/api/search?q=", "/api/meta"],
        });
      }

      return errResp(`Not found: ${path}`, 404);
    } catch (e) {
      return errResp(e.message || "Internal server error", 500);
    }
  },
};