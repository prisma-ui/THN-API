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
 * Generate safe cache key for long URLs
 * Uses SHA256 hash for URLs longer than 100 chars, base64 encoding fallback
 */
function generateCacheKey(key) {
  if (typeof key !== "string") {
    return String(key);
  }

  // For short keys, use as-is
  if (key.length <= 100) {
    return key;
  }

  // For long URLs, use SHA256 hash
  try {
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    return hash;
  } catch (err) {
    // Fallback: base64 encode
    console.warn("[Cache] SHA256 failed, using base64 fallback:", err.message);
    return Buffer.from(key).toString("base64").substring(0, 64);
  }
}

function cacheGet(key) {
  const safeKey = generateCacheKey(key);
  const entry = CACHE.get(safeKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(safeKey);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttl) {
  const safeKey = generateCacheKey(key);
  
  // Evict if too large (simple LRU: max 100 entries)
  if (CACHE.size >= 100) {
    const firstKey = CACHE.keys().next().value;
    CACHE.delete(firstKey);
  }
  
  CACHE.set(safeKey, {
    data,
    expiresAt: Date.now() + ttl,
    cachedAt: new Date().toISOString(),
    originalKey: key.substring(0, 50), // Keep reference for debugging
  });
}

function cacheDelete(key) {
  const safeKey = generateCacheKey(key);
  CACHE.delete(safeKey);
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
