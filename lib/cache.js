/**
 * Simple in-memory cache (survives within the same serverless instance)
 * For persistent cache: replace with Redis / Upstash / Vercel KV
 */

const CACHE = new Map();

const DEFAULT_TTL = {
  list: 5 * 60 * 1000,       // 5 minutes for article lists
  article: 30 * 60 * 1000,   // 30 minutes for full articles
  search: 2 * 60 * 1000,     // 2 minutes for search
  meta: 60 * 60 * 1000,      // 1 hour for site meta
};

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
  DEFAULT_TTL,
};
