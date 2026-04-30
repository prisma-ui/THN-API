/**
 * THN Scraper Core
 * Scrapes thehackernews.com using Cheerio
 */

const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://thehackernews.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Cache-Control": "no-cache",
};

/**
 * Fetch HTML from a URL
 */
async function fetchHTML(url, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: HEADERS,
        timeout: 12000,  // Keep below Vercel/Render function timeout
        maxRedirects: 5,
      });
      return res.data;
    } catch (err) {
      lastErr = err;
      // Don't retry on 4xx errors
      if (err.response && err.response.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
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

  const pagination = extractNextPageToken($);

  return {
    page_url: pageUrl,
    count: articles.length,
    articles,
    // Expose next_page_url at top level for easy consumption
    next_page_url: pagination ? pagination.next_url : null,
    next_cursor: pagination ? pagination.cursor : null,
    pagination,
  };
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
