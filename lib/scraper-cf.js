/**
 * THN Scraper — Cloudflare Workers Edition
 * Uses fetch() native API only. No axios, no Node built-ins.
 * Cheerio is bundled via esbuild at build time.
 */

import * as cheerio from "cheerio";

const BASE_URL = "https://thehackernews.com";
const RSS_URL = "https://feeds.feedburner.com/TheHackersNews";

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

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(referer = null, extraCookies = "") {
  const ua = getRandomUA();
  const isFirefox = ua.includes("Firefox");
  const h = {
    "User-Agent": ua,
    "Accept": isFirefox
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
    "Connection": "keep-alive",
  };
  if (!isFirefox) {
    h["sec-ch-ua"] = `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`;
    h["sec-ch-ua-mobile"] = "?0";
    h["sec-ch-ua-platform"] = '"Windows"';
  }
  if (referer) h["Referer"] = referer;
  if (extraCookies) h["Cookie"] = extraCookies;
  return h;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function isCFChallenge(html, status) {
  if (status === 403 || status === 503) return true;
  if (typeof html !== "string") return false;
  return (
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_prog") ||
    html.includes("Checking your browser") ||
    html.includes("jschl_vc") ||
    (html.includes("cloudflare") && html.includes("challenge"))
  );
}

// Simple in-memory CF cookie store (per Worker instance lifetime)
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
  const jar = cfCookies[domain] || {};
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Fetch HTML using native fetch() — CF Workers compatible
 */
async function fetchHTML(url, retries = 3) {
  const domain = new URL(url).hostname;
  let lastErr;

  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(800 * i + Math.floor(Math.random() * 700));

    try {
      const isArticle = url !== BASE_URL && !url.includes("?");
      const referer = isArticle ? BASE_URL + "/" : null;
      const cookies = getCFCookies(domain);

      const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(referer, cookies),
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE_URL + url;
  return url;
}

function cleanDateRaw(text) {
  if (!text) return "";
  return text.replace(/^[^A-Za-z0-9]+/, "").trim();
}

function parseDateLabel(text) {
  if (!text) return null;
  try {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (_) {}
  return null;
}

function estimateReadTime(text) {
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
}

function extractSlug(url) {
  if (!url) return "";
  return url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.html$/, "").replace(/\/$/, "");
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseArticleCard($, el) {
  const $el = $(el);
  const url = $el.find("a.story-link").attr("href") || "";
  const title = $el.find("h2.home-title").text().trim() || $el.find("h2").text().trim() || "";
  const summary = $el.find("div.home-desc").text().trim() || "";
  const imgEl = $el.find("img.img-fluid, img.home-img-src, figure img").first();
  const image = imgEl.attr("data-src") || imgEl.attr("data-original") || imgEl.attr("src") || "";
  const labelEl = $el.find(".item-label, .h-datetime").first();
  const rawDateText = labelEl.find("span").first().text().trim() || $el.find(".h-datetime span").first().text().trim() || "";
  const dateText = cleanDateRaw(rawDateText);
  const tags = [];
  labelEl.find("a").each((_, tagEl) => {
    const tag = $(tagEl).text().trim();
    if (tag) tags.push(tag);
  });
  const author = $el.find("[rel='author'], .author-name").text().trim() || null;
  const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";
  return { slug, url, title, summary, image: normalizeImageUrl(image), date: parseDateLabel(dateText), date_raw: dateText, tags, author };
}

function extractNextPageToken($) {
  const olderLink =
    $("a#blog-pager-older-link").attr("href") ||
    $(".blog-pager-older-link").attr("href") ||
    $("a:contains('Older Posts')").attr("href") ||
    null;
  if (!olderLink) return null;
  const cursorMatch = olderLink.match(/[?&]updated-max=([^&]+)/);
  return { next_url: olderLink, cursor: cursorMatch ? decodeURIComponent(cursorMatch[1]) : null };
}

// ─── RSS ──────────────────────────────────────────────────────────────────────

function parseRSSXml(xmlData) {
  const $ = cheerio.load(xmlData, { xmlMode: true });
  const articles = [];
  $("item").each((_, el) => {
    const $el = $(el);
    const url = $el.find("link").text().trim() || $el.find("feedburner\\:origLink").text().trim();
    const title = $el.find("title").text().trim();
    const summary = $el.find("description").text().replace(/<[^>]+>/g, "").trim().slice(0, 300);
    const pubDate = $el.find("pubDate").text().trim();
    const author = $el.find("author").text().trim() || null;
    const image = $el.find("media\\:content").attr("url") || $el.find("enclosure").attr("url") || null;
    const tags = [];
    $el.find("category").each((_, cat) => { const t = $(cat).text().trim(); if (t) tags.push(t); });
    const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";
    const parsedDate = pubDate ? new Date(pubDate).toISOString() : null;
    if (title && url) articles.push({ slug, url, title, summary, image: normalizeImageUrl(image), date: parsedDate, date_raw: pubDate, tags, author, source: "rss" });
  });
  return { page_url: RSS_URL, count: articles.length, articles, next_page_url: null, next_cursor: null, pagination: null, source: "rss_fallback" };
}

async function fetchRSS() {
  for (const sourceUrl of RSS_SOURCES) {
    try {
      const res = await fetch(sourceUrl, {
        headers: { "User-Agent": getRandomUA(), "Accept": "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!res.ok) continue;
      let text = await res.text();
      // allorigins wraps in JSON
      if (sourceUrl.includes("allorigins.win")) {
        try { text = JSON.parse(text).contents || text; } catch (_) {}
      }
      const result = parseRSSXml(text);
      if (result.count > 0) return result;
    } catch (err) {
      console.warn("[THN CF] RSS source failed:", sourceUrl, err.message);
    }
  }
  throw new Error("All RSS sources failed");
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scrapeArticleList(pageUrl = BASE_URL) {
  try {
    const html = await fetchHTML(pageUrl);
    const $ = cheerio.load(html);
    const articles = [];
    $("div.body-post").each((_, el) => {
      const a = parseArticleCard($, el);
      if (a.title && a.url) articles.push(a);
    });
    if (articles.length === 0) {
      $(".news-container, .story-container").each((_, el) => {
        const a = parseArticleCard($, el);
        if (a.title && a.url) articles.push(a);
      });
    }
    if (articles.length === 0) return await fetchRSS();
    const pagination = extractNextPageToken($);
    return { page_url: pageUrl, count: articles.length, articles, next_page_url: pagination?.next_url || null, next_cursor: pagination?.cursor || null, pagination, source: "scraper" };
  } catch (err) {
    const isCF = err.isCFChallenge || err.status === 403 || err.status === 429 || err.status === 503;
    if (isCF || !err.status) return await fetchRSS();
    throw err;
  }
}

export async function scrapeArticle(articleUrl) {
  const url = articleUrl.startsWith("http") ? articleUrl : `${BASE_URL}/${articleUrl}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const metaTitle = $("meta[property='og:title']").attr("content") || $("title").text().trim();
  const metaDesc = $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "";
  const metaImage = $("meta[property='og:image']").attr("content") || null;
  const metaUrl = $("meta[property='og:url']").attr("content") || $("link[rel='canonical']").attr("href") || url;
  const publishedAt = $("meta[property='article:published_time']").attr("content") || null;
  const modifiedAt = $("meta[property='article:modified_time']").attr("content") || null;
  const author = $("[rel='author']").first().text().trim() || $(".author-name").first().text().trim() || null;
  const tags = [];
  $(".label a, .post-labels a").each((_, el) => { const t = $(el).text().trim(); if (t && !tags.includes(t)) tags.push(t); });
  const bodyEl = $("div.articlebody, div.post-body, div#articlebody, div.entry-content").first();
  const paragraphs = [];
  bodyEl.find("p").each((_, el) => { const t = $(el).text().trim(); if (t && t.length > 20) paragraphs.push(t); });
  const links = [];
  bodyEl.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && !href.startsWith("#") && !href.includes("thehackernews.com") && href.startsWith("http")) links.push({ text, url: href });
  });
  const images = [];
  bodyEl.find("img").each((_, el) => {
    const src = $(el).attr("data-src") || $(el).attr("data-original") || $(el).attr("src") || "";
    const alt = $(el).attr("alt") || "";
    if (src && !src.startsWith("data:")) images.push({ src: normalizeImageUrl(src), alt });
  });
  const headings = [];
  bodyEl.find("h2, h3, h4").each((_, el) => { headings.push({ level: el.tagName.toLowerCase(), text: $(el).text().trim() }); });

  return {
    url: metaUrl, slug: extractSlug(metaUrl), title: metaTitle, description: metaDesc,
    image: normalizeImageUrl(metaImage), author, published_at: publishedAt, modified_at: modifiedAt,
    tags, read_time_minutes: estimateReadTime(paragraphs.join(" ")),
    content: { paragraphs, headings, images, links, html: bodyEl.html() || "" },
  };
}

export async function scrapeCategory(category, cursor = null) {
  let url = `${BASE_URL}/search/label/${encodeURIComponent(category)}`;
  if (cursor) url += `?updated-max=${encodeURIComponent(cursor)}&max-results=10`;
  const result = await scrapeArticleList(url);
  return { ...result, category };
}

export async function scrapeSearch(query) {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  try {
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const articles = [];
    $("div.body-post").each((_, el) => { const a = parseArticleCard($, el); if (a.title && a.url) articles.push(a); });
    return { query, count: articles.length, articles };
  } catch (err) {
    // fallback: search RSS by keyword
    const rss = await fetchRSS();
    const q = query.toLowerCase();
    const filtered = rss.articles.filter(a => a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q));
    return { query, count: filtered.length, articles: filtered, source: "rss_search_fallback" };
  }
}

export async function scrapeSiteMeta() {
  const knownCategories = [
    "Data Breaches","Cyber Attack","Vulnerability","Malware","Ransomware",
    "Phishing","Security","Privacy","Zero Day","APT","AI Security",
    "Cloud Security","Mobile Security","IoT Security","Cryptography",
  ].map(name => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), url: `${BASE_URL}/search/label/${encodeURIComponent(name)}` }));
  return { site: "The Hacker News", base_url: BASE_URL, categories: knownCategories };
}
