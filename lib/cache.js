/**
 * Simple in-memory cache (survives within the same serverless instance)
 * For persistent cache: replace with Redis / Upstash / Vercel KV
 */

const crypto = require("crypto");

const CACHE = new Map();

const DEFAULT_TTL = {
  list: 5 * 60 * 1000,       // 5 minutes for article lists
  article: 30 * 60 * 1000,   // 30 minutes for full articles
  search: 2 * 60 * 1000,     // 2 minutes for search
  meta: 60 * 60 * 1000,      // 1 hour for site meta
};

/**
 * Generate a safe cache key for long URLs using SHA256 + Base64
 * Prevents cache key collisions for long URLs (>100 chars)
 * @param {string} prefix - Cache key prefix (e.g., 'article', 'search')
 * @param {string} value - Value to encode (URL, query, etc.)
 * @returns {string} Safe cache key
 */
function generateCacheKey(prefix, value) {
  // If value is short, use it directly
  if (value && value.length < 100) {
    return `${prefix}:${value}`;
  }

  // For long values, use SHA256 hash
  if (!value) return prefix;

  try {
    const hash = crypto
      .createHash("sha256")
      .update(value)
      .digest("base64")
      .replace(/[+/=]/g, (c) => {
        // Replace base64 chars with URL-safe equivalents
        const map = { "+": "-", "/": "_", "=": "" };
        return map[c] || c;
      })
      .substring(0, 32); // Use first 32 chars for brevity

    return `${prefix}:${hash}`;
  } catch (err) {
    console.error("[Cache] Hash generation failed:", err.message);
    // Fallback to direct encoding
    return `${prefix}:${Buffer.from(value).toString("base64").substring(0, 32)}`;
  }
}

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttl) {
  // Evict if too large (simple LRU: max 100 entries)
  if (CACHE.size >= 100) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  CACHE.set(key, {
    data,
    expiresAt: Date.now() + ttl,
    cachedAt: new Date().toISOString(),
  });
}

function cacheDelete(key) {
  CACHE.delete(key);
}

function cacheClear() {
  CACHE.clear();
}

function cacheStats() {
  return {
    size: CACHE.size,
    keys: Array.from(CACHE.keys()),
  };
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheClear,
  cacheStats,
  generateCacheKey,
  DEFAULT_TTL,
};
