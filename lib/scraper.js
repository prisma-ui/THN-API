/**
 * THN Scraper Core
 * Scrapes thehackernews.com using Cheerio
 */

const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");

const BASE_URL = "https://thehackernews.com";
const RSS_URL = "https://feeds.feedburner.com/TheHackersNews";

// Proxy-based RSS sources (bypass datacenter IP block)
// Google RSS cache doesn't require auth and bypasses CF blocks
const RSS_SOURCES = [
  // Direct RSS
  "https://feeds.feedburner.com/TheHackersNews",
  // AllOrigins proxy — wraps any URL, returns JSON with contents field
  "https://api.allorigins.win/get?url=" + encodeURIComponent("https://feeds.feedburner.com/TheHackersNews"),
  // corsproxy.io
  "https://corsproxy.io/?" + encodeURIComponent("https://feeds.feedburner.com/TheHackersNews"),
];

// Rotating User-Agents - Chrome/Firefox mix
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

// In-memory Cloudflare cookie store (per-process lifetime)
const cfCookieStore = {
  cookies: {},
  set(domain, cookieStr) {
    if (!this.cookies[domain]) this.cookies[domain] = {};
    // Parse Set-Cookie string
    cookieStr.split(",").forEach(part => {
      const [kv] = part.trim().split(";");
      const [k, v] = kv.split("=");
      if (k && v) this.cookies[domain][k.trim()] = v.trim();
    });
  },
  get(domain) {
    const jar = this.cookies[domain] || {};
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  },
  hasCF(domain) {
    const jar = this.cookies[domain] || {};
    return !!(jar["cf_clearance"] || jar["__cf_bm"]);
  },
};

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function buildHeaders(referer = null, extraCookies = "") {
  const ua = getRandomUA();
  const isFirefox = ua.includes("Firefox");
  const headers = {
    "User-Agent": ua,
    "Accept": isFirefox
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
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
    headers["sec-ch-ua"] = `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`;
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"Windows"';
  }
  if (referer) headers["Referer"] = referer;
  if (extraCookies) headers["Cookie"] = extraCookies;
  return headers;
}

/**
 * Custom HTTPS agent — avoids some TLS fingerprint checks
 */
const httpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  timeout: 15000,
});

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Check if response is a Cloudflare challenge page
 */
function isCFChallenge(html, status) {
  if (status === 403 || status === 503) return true;
  if (typeof html !== "string") return false;
  return (
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_prog") ||
    html.includes("Checking your browser") ||
    html.includes("jschl_vc") ||
    html.includes("cf-ray") ||
    html.includes("cloudflare") && html.includes("challenge")
  );
}

/**
 * Extract and store CF cookies from response headers
 */
function storeCFCookies(domain, responseHeaders) {
  const setCookie = responseHeaders["set-cookie"];
  if (!setCookie) return;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  cookies.forEach(c => cfCookieStore.set(domain, c));
}

/**
 * Fetch HTML from a URL with Cloudflare bypass + retry logic
 */
async function fetchHTML(url, retries = 3) {
  const domain = new URL(url).hostname;
  let lastErr;

  for (let i = 0; i <= retries; i++) {
    try {
      // Jitter delay between retries
      if (i > 0) {
        const delay = 800 * i + Math.floor(Math.random() * 700);
        await sleep(delay);
      }

      const isArticle = url !== BASE_URL && !url.includes("?");
      const referer = isArticle ? BASE_URL + "/" : null;
      const savedCookies = cfCookieStore.get(domain);

      const res = await axios.get(url, {
        headers: buildHeaders(referer, savedCookies),
        httpsAgent,
        timeout: 15000,
        maxRedirects: 5,
        decompress: true,
        // Accept all status codes so we can inspect CF challenge pages
        validateStatus: () => true,
      });

      // Store CF cookies from every response
      storeCFCookies(domain, res.headers);

      const status = res.status;
      const html = res.data;

      // Detect Cloudflare block/challenge — mark and throw upward
      if (isCFChallenge(html, status)) {
        const cfErr = new Error("Cloudflare challenge detected");
        cfErr.isCFChallenge = true;
        cfErr.response = { status };
        throw cfErr;
      }

      // Success
      if (status === 200) return html;

      // Other non-200 — wrap and throw
      const err = new Error(`HTTP ${status}`);
      err.response = { status };
      throw err;

    } catch (err) {
      lastErr = err;

      // CF challenge or hard block — bubble up immediately for RSS fallback
      if (err.isCFChallenge) throw err;

      // Don't retry on 4xx except 429
      if (err.response) {
        const s = err.response.status;
        if (s !== 429 && s < 500) throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * Parse RSS XML string into article list
 */
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

    const image =
      $el.find("media\\:content").attr("url") ||
      $el.find("enclosure").attr("url") ||
      null;

    const tags = [];
    $el.find("category").each((_, cat) => {
      const t = $(cat).text().trim();
      if (t) tags.push(t);
    });

    const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";
    const parsedDate = pubDate ? new Date(pubDate).toISOString() : null;

    if (title && url) {
      articles.push({
        slug,
        url,
        title,
        summary,
        image: normalizeImageUrl(image),
        date: parsedDate,
        date_raw: pubDate,
        tags,
        author,
        source: "rss",
      });
    }
  });

  return {
    page_url: RSS_URL,
    count: articles.length,
    articles,
    next_page_url: null,
    next_cursor: null,
    pagination: null,
    source: "rss_fallback",
  };
}

/**
 * Fetch RSS with multiple fallback sources (direct + proxy)
 */
async function fetchRSS() {
  for (const sourceUrl of RSS_SOURCES) {
    try {
      const res = await axios.get(sourceUrl, {
        headers: {
          "User-Agent": getRandomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        timeout: 12000,
        validateStatus: () => true,
      });

      if (res.status !== 200) continue;

      // allorigins wraps response in JSON: { contents: "...", status: {...} }
      let xmlData = res.data;
      if (sourceUrl.includes("allorigins.win") && typeof xmlData === "object" && xmlData.contents) {
        xmlData = xmlData.contents;
      }

      const result = parseRSSXml(xmlData);
      if (result.count > 0) {
        console.log("[THN API] RSS fetched from:", sourceUrl);
        return result;
      }
    } catch (err) {
      console.warn("[THN API] RSS source failed:", sourceUrl, err.message);
    }
  }
  throw new Error("All RSS sources failed");
}

/**
 * Clean date_raw — strip leading non-ASCII icon/font characters
 * e.g. "î ‚Apr 29, 2026" → "Apr 29, 2026"
 */
function cleanDateRaw(text) {
  if (!text) return "";
  // Remove any leading characters that are not letters/digits
  return text.replace(/^[^A-Za-z0-9]+/, "").trim();
}

/**
 * Parse article card from home/category page
 */
function parseArticleCard($, el) {
  const $el = $(el);

  const url = $el.find("a.story-link").attr("href") || "";
  const title =
    $el.find("h2.home-title").text().trim() ||
    $el.find("h2").text().trim() ||
    "";
  const summary =
    $el.find("div.home-desc").text().trim() ||
    $el.find(".home-desc").text().trim() ||
    "";

  // Image - handle lazy loading
  const imgEl = $el.find("img.img-fluid, img.home-img-src, figure img").first();
  const image =
    imgEl.attr("data-src") ||
    imgEl.attr("data-original") ||
    imgEl.attr("src") ||
    "";

  // Date & Label — try multiple selectors
  const labelEl = $el.find(".item-label, .h-datetime").first();
  const rawDateText = labelEl.find("span").first().text().trim() ||
    $el.find(".h-datetime span").first().text().trim() ||
    "";
  const dateText = cleanDateRaw(rawDateText);

  // Tags from label links
  const tags = [];
  labelEl.find("a").each((_, tagEl) => {
    const tag = $(tagEl).text().trim();
    if (tag) tags.push(tag);
  });

  // Author (sometimes present in card)
  const author =
    $el.find("[rel='author'], .author-name").text().trim() || null;

  // Slug from URL — keep full path for now, e.g. "2026/04/slug.html"
  const slug = url ? url.replace(BASE_URL + "/", "").replace(/\/$/, "") : "";

  return {
    slug,
    url,
    title,
    summary,
    image: normalizeImageUrl(image),
    date: parseDateLabel(dateText),
    date_raw: dateText,
    tags,
    author,
  };
}

/**
 * Normalize relative/CDN image URLs
 */
function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return BASE_URL + url;
  return url;
}

/**
 * Parse informal date labels like "Apr 29, 2025"
 */
function parseDateLabel(text) {
  if (!text) return null;
  try {
    const d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch (_) {}
  return null;
}

/**
 * Extract the cursor/next page token from pagination
 * THN uses Blogger-style updated-max timestamp for pagination
 */
function extractNextPageToken($) {
  const olderLink =
    $("a#blog-pager-older-link").attr("href") ||
    $(".blog-pager-older-link").attr("href") ||
    $("a.blog-pager-older-link").attr("href") ||
    $("a:contains('Older Posts')").attr("href") ||
    null;

  if (!olderLink) return null;

  // Extract the updated-max timestamp param
  const cursorMatch = olderLink.match(/[?&]updated-max=([^&]+)/);

  return {
    next_url: olderLink,
    cursor: cursorMatch ? decodeURIComponent(cursorMatch[1]) : null,
  };
}

/**
 * Scrape article list (home page or next page)
 */
async function scrapeArticleList(pageUrl = BASE_URL) {
  try {
    const html = await fetchHTML(pageUrl);
    const $ = cheerio.load(html);

    const articles = [];
    $("div.body-post").each((_, el) => {
      const article = parseArticleCard($, el);
      if (article.title && article.url) articles.push(article);
    });

    // Fallback selector
    if (articles.length === 0) {
      $(".news-container, .story-container").each((_, el) => {
        const article = parseArticleCard($, el);
        if (article.title && article.url) articles.push(article);
      });
    }

    // If still empty on home page, might be blocked — fallback to RSS
    if (articles.length === 0 && pageUrl === BASE_URL) {
      console.warn("[THN API] Scraper returned 0 articles, falling back to RSS...");
      return await fetchRSS();
    }

    const pagination = extractNextPageToken($);

    return {
      page_url: pageUrl,
      count: articles.length,
      articles,
      next_page_url: pagination ? pagination.next_url : null,
      next_cursor: pagination ? pagination.cursor : null,
      pagination,
      source: "scraper",
    };
  } catch (err) {
    const status = err.response && err.response.status;
    const isCF = err.isCFChallenge || status === 403 || status === 429 || status === 503;

    // Fallback to RSS on ANY block/CF challenge, regardless of URL
    if (isCF || !status) {
      const reason = err.isCFChallenge ? "Cloudflare challenge" : (status || err.code);
      console.warn("[THN API] Scraper blocked (" + reason + "), falling back to RSS...");
      return await fetchRSS();
    }
    throw err;
  }
}

/**
 * Scrape a single article page — full content + metadata
 */
async function scrapeArticle(articleUrl) {
  const url = articleUrl.startsWith("http")
    ? articleUrl
    : `${BASE_URL}/${articleUrl}`;

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const metaTitle =
    $("meta[property='og:title']").attr("content") ||
    $("title").text().trim();
  const metaDesc =
    $("meta[property='og:description']").attr("content") ||
    $("meta[name='description']").attr("content") ||
    "";
  const metaImage =
    $("meta[property='og:image']").attr("content") ||
    $("meta[property='og:image:secure_url']").attr("content") ||
    null;
  const metaUrl =
    $("meta[property='og:url']").attr("content") ||
    $("link[rel='canonical']").attr("href") ||
    url;
  const publishedAt =
    $("meta[property='article:published_time']").attr("content") ||
    $("meta[itemprop='datePublished']").attr("content") ||
    null;
  const modifiedAt =
    $("meta[property='article:modified_time']").attr("content") ||
    $("meta[itemprop='dateModified']").attr("content") ||
    null;

  const author =
    $("[rel='author']").first().text().trim() ||
    $(".author-name").first().text().trim() ||
    $("meta[name='author']").attr("content") ||
    null;

  const tags = [];
  $(".label a, .post-labels a, span.label a").each((_, el) => {
    const t = $(el).text().trim();
    if (t && !tags.includes(t)) tags.push(t);
  });

  const bodyEl = $(
    "div.articlebody, div.post-body, div#articlebody, div.entry-content"
  ).first();

  const paragraphs = [];
  bodyEl.find("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 20) paragraphs.push(text);
  });

  const links = [];
  bodyEl.find("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (
      href &&
      !href.startsWith("#") &&
      !href.includes("thehackernews.com") &&
      href.startsWith("http")
    ) {
      links.push({ text, url: href });
    }
  });

  const images = [];
  bodyEl.find("img").each((_, el) => {
    const src =
      $(el).attr("data-src") ||
      $(el).attr("data-original") ||
      $(el).attr("src") ||
      "";
    const alt = $(el).attr("alt") || "";
    if (src && !src.startsWith("data:")) {
      images.push({ src: normalizeImageUrl(src), alt });
    }
  });

  const headings = [];
  bodyEl.find("h2, h3, h4").each((_, el) => {
    headings.push({
      level: el.tagName.toLowerCase(),
      text: $(el).text().trim(),
    });
  });

  const contentHtml = bodyEl.html() || "";

  const related = [];
  $("div.related-posts a, .related-article a, .see-also a").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && text) related.push({ title: text, url: href });
  });

  const readTime = estimateReadTime(paragraphs.join(" "));

  return {
    url: metaUrl,
    slug: extractSlug(metaUrl),
    title: metaTitle,
    description: metaDesc,
    image: normalizeImageUrl(metaImage),
    author,
    published_at: publishedAt,
    modified_at: modifiedAt,
    tags,
    read_time_minutes: readTime,
    content: {
      paragraphs,
      headings,
      images,
      links,
      html: contentHtml,
    },
    related_articles: related,
  };
}

/**
 * Scrape category/tag page
 */
async function scrapeCategory(category, cursor = null) {
  let url = `${BASE_URL}/search/label/${encodeURIComponent(category)}`;
  if (cursor) url += `?updated-max=${encodeURIComponent(cursor)}&max-results=10`;

  const result = await scrapeArticleList(url);
  return {
    ...result,
    category,
  };
}

/**
 * Scrape search results
 */
async function scrapeSearch(query) {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const articles = [];
  $("div.body-post").each((_, el) => {
    const article = parseArticleCard($, el);
    if (article.title && article.url) articles.push(article);
  });

  return {
    query,
    count: articles.length,
    // Return as "articles" (not "results") for consistent API shape
    articles,
  };
}

/**
 * Get site metadata and top categories
 */
async function scrapeSiteMeta() {
  const html = await fetchHTML(BASE_URL);
  const $ = cheerio.load(html);

  const categories = [];
  $("ul.category-list li a, nav a, .sidebar-menu a, .nav-links a").each(
    (_, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (text && href && href.includes("/search/label/")) {
        categories.push({
          name: text,
          slug: text.toLowerCase().replace(/\s+/g, "-"),
          url: href,
        });
      }
    }
  );

  const knownCategories = [
    "Data Breaches",
    "Cyber Attack",
    "Vulnerability",
    "Malware",
    "Ransomware",
    "Phishing",
    "Security",
    "Privacy",
    "Zero Day",
    "APT",
    "AI Security",
    "Cloud Security",
    "Mobile Security",
    "IoT Security",
    "Cryptography",
  ].map((name) => ({
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    url: `${BASE_URL}/search/label/${encodeURIComponent(name)}`,
  }));

  return {
    site: "The Hacker News",
    base_url: BASE_URL,
    categories: categories.length > 0 ? categories : knownCategories,
  };
}

function estimateReadTime(text) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

function extractSlug(url) {
  if (!url) return "";
  return url
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.html$/, "")
    .replace(/\/$/, "");
}

module.exports = {
  scrapeArticleList,
  scrapeArticle,
  scrapeCategory,
  scrapeSearch,
  scrapeSiteMeta,
  BASE_URL,
};
