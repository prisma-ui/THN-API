/**
 * THN Scraper Core
 * Scrapes thehackernews.com using Cheerio
 * Features: Retry logic, timeout handling, input validation
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

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
};

/**
 * Check if error is transient (should retry)
 * @param {Error} err
 * @returns {boolean}
 */
function isTransientError(err) {
  if (!err) return false;

  const transientCodes = [
    "ECONNABORTED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "ERR_HTTP_REQUEST_TIMEOUT",
  ];

  if (transientCodes.includes(err.code)) return true;

  // Check for transient HTTP status codes
  if (err.response?.status) {
    const transientStatuses = [408, 429, 500, 502, 503, 504];
    if (transientStatuses.includes(err.response.status)) return true;
  }

  return false;
}

/**
 * Fetch HTML from a URL with retry logic
 * @param {string} url
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<string>}
 */
async function fetchHTML(url, retryCount = 0) {
  try {
    const res = await axios.get(url, {
      headers: HEADERS,
      timeout: 30000, // 30 seconds (increased from 15s)
      maxRedirects: 5,
    });
    return res.data;
  } catch (err) {
    // If transient error and retries remaining, retry with backoff
    if (isTransientError(err) && retryCount < RETRY_CONFIG.maxRetries) {
      const delayMs =
        RETRY_CONFIG.initialDelayMs *
        Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount);
      console.warn(
        `[Scraper] Retry ${retryCount + 1}/${RETRY_CONFIG.maxRetries} for ${url} in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fetchHTML(url, retryCount + 1);
    }

    // Log error details
    console.error("[Scraper] Fetch error:", {
      url,
      code: err.code,
      status: err.response?.status,
      message: err.message,
    });

    throw err;
  }
}

/**
 * Validate category name
 * @param {string} category - Category name
 * @throws {Error} if invalid
 * @returns {string} sanitized category name
 */
function validateCategoryName(category) {
  if (!category || typeof category !== "string") {
    throw new Error("Category must be a non-empty string");
  }

  const trimmed = category.trim();

  // Check length
  if (trimmed.length > 100) {
    throw new Error("Category name exceeds 100 characters");
  }

  if (trimmed.length === 0) {
    throw new Error("Category name cannot be empty or whitespace-only");
  }

  // Check valid characters: alphanumeric, spaces, hyphens, underscores
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(trimmed)) {
    throw new Error(
      "Category name contains invalid characters. Only alphanumeric, spaces, hyphens, and underscores are allowed"
    );
  }

  return trimmed;
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

  // Date & Label
  const labelEl = $el.find(".item-label, .h-datetime");
  const dateText = labelEl.find("span").first().text().trim();

  // Tags from label links
  const tags = [];
  labelEl.find("a").each((_, tagEl) => {
    const tag = $(tagEl).text().trim();
    if (tag) tags.push(tag);
  });

  // Author (sometimes present in card)
  const author =
    $el.find("[rel='author'], .author-name").text().trim() || null;

  // Slug from URL
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
 * THN uses ?blogger=<timestamp> for pagination
 */
function extractNextPageToken($) {
  // Blogger-style "Load More" button / older posts link
  const olderLink =
    $("a#blog-pager-older-link").attr("href") ||
    $(".blog-pager-older-link").attr("href") ||
    $("a:contains('Older Posts')").attr("href") ||
    null;

  if (!olderLink) return null;

  // Extract the updated-max timestamp param (used by Blogger pagination)
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
    $("div.body-post, div.item-label").each((_, el) => {
      // Skip pure label-only elements
      if ($(el).hasClass("item-label")) return;
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
      pagination,
    };
  } catch (err) {
    console.error("[Scraper] Article list fetch failed:", err.message);
    throw err;
  }
}

/**
 * Scrape a single article page — full content + metadata
 */
async function scrapeArticle(articleUrl) {
  try {
    // Support both full URLs and paths
    const url = articleUrl.startsWith("http")
      ? articleUrl
      : `${BASE_URL}/${articleUrl}`;

    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    // ----- Meta tags -----
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

    // ----- Author -----
    const author =
      $("[rel='author']").first().text().trim() ||
      $(".author-name").first().text().trim() ||
      $("meta[name='author']").attr("content") ||
      null;

    // ----- Tags / Labels -----
    const tags = [];
    $(".label a, .post-labels a, span.label a").each((_, el) => {
      const t = $(el).text().trim();
      if (t && !tags.includes(t)) tags.push(t);
    });

    // ----- Article body -----
    const bodyEl = $(
      "div.articlebody, div.post-body, div#articlebody, div.entry-content"
    ).first();

    // Extract clean text paragraphs
    const paragraphs = [];
    bodyEl.find("p").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 20) paragraphs.push(text);
    });

    // Extract all external links from article
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

    // Extract images from body
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

    // Extract headings (h2, h3) for TOC
    const headings = [];
    bodyEl.find("h2, h3, h4").each((_, el) => {
      headings.push({
        level: el.tagName.toLowerCase(),
        text: $(el).text().trim(),
      });
    });

    // Full HTML content (sanitised)
    const contentHtml = bodyEl.html() || "";

    // ----- Related articles -----
    const related = [];
    $("div.related-posts a, .related-article a, .see-also a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (href && text) related.push({ title: text, url: href });
    });

    // ----- Share counts / stats (if present) -----
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
  } catch (err) {
    console.error("[Scraper] Article fetch failed:", err.message);
    throw err;
  }
}

/**
 * Scrape category/tag page
 */
async function scrapeCategory(category, cursor = null) {
  try {
    // Validate category name
    const validatedCategory = validateCategoryName(category);

    // THN categories: /search/label/<name>
    let url = `${BASE_URL}/search/label/${encodeURIComponent(validatedCategory)}`;
    if (cursor) url += `?updated-max=${encodeURIComponent(cursor)}&max-results=10`;

    return scrapeArticleList(url);
  } catch (err) {
    console.error("[Scraper] Category scrape failed:", err.message);
    throw err;
  }
}

/**
 * Scrape search results (Blogger-powered search)
 */
async function scrapeSearch(query) {
  try {
    const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);

    const results = [];
    $("div.body-post").each((_, el) => {
      const article = parseArticleCard($, el);
      if (article.title && article.url) results.push(article);
    });

    return {
      query,
      count: results.length,
      results,
    };
  } catch (err) {
    console.error("[Scraper] Search failed:", err.message);
    throw err;
  }
}

/**
 * Get site metadata and top categories
 */
async function scrapeSiteMeta() {
  try {
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

    // Fallback: known THN categories
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
  } catch (err) {
    console.error("[Scraper] Site meta fetch failed:", err.message);
    throw err;
  }
}

/**
 * Estimate reading time (words / 200 wpm)
 */
function estimateReadTime(text) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

/**
 * Extract slug from URL
 */
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
  validateCategoryName,
  BASE_URL,
};
