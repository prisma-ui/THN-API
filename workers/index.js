/**
 * Cloudflare Workers Adapter
 * Uses fetch API natively — replace axios with fetch in scraper.js
 * Deploy: wrangler publish
 */

// Re-export the core scraper logic adapted for CF Workers (no Node built-ins)
import {
  scrapeArticleList,
  scrapeArticle,
  scrapeCategory,
  scrapeSearch,
  scrapeSiteMeta,
} from "../lib/scraper-cf";

// Simple in-memory cache (per-worker-instance)
const CACHE = new Map();

function getCache(key) {
  const e = CACHE.get(key);
  if (!e || Date.now() > e.exp) return null;
  return e.data;
}
function setCache(key, data, ttl) {
  CACHE.set(key, { data, exp: Date.now() + ttl });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function json(data, status = 200) {
  return new Response(JSON.stringify({ success: true, timestamp: new Date().toISOString(), ...data }, null, 2), {
    status,
    headers: CORS,
  });
}
function err(msg, status = 500) {
  return new Response(JSON.stringify({ success: false, error: msg, timestamp: new Date().toISOString() }), {
    status,
    headers: CORS,
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;
    const q = Object.fromEntries(url.searchParams);

    try {
      // /api/news
      if (path === "/api/news" || path === "/api") {
        const pageUrl = q.page_url || null;
        const key = `news:${pageUrl || "home"}`;
        const cached = getCache(key);
        if (cached) return json({ cached: true, ...cached });
        const data = await scrapeArticleList(pageUrl || undefined);
        setCache(key, data, 5 * 60 * 1000);
        return json({ cached: false, ...data });
      }

      // /api/article?url=
      if (path === "/api/article") {
        if (!q.url) return err("Missing ?url=", 400);
        const key = `article:${q.url}`;
        const cached = getCache(key);
        if (cached) return json({ cached: true, article: cached });
        const article = await scrapeArticle(q.url);
        setCache(key, article, 30 * 60 * 1000);
        return json({ cached: false, article });
      }

      // /api/category/<name>
      const catMatch = path.match(/^\/api\/category\/(.+)$/);
      if (catMatch) {
        const name = decodeURIComponent(catMatch[1]);
        const cursor = q.cursor || null;
        const key = `cat:${name}:${cursor || "0"}`;
        const cached = getCache(key);
        if (cached) return json({ cached: true, category: name, ...cached });
        const data = await scrapeCategory(name, cursor);
        setCache(key, data, 5 * 60 * 1000);
        return json({ cached: false, category: name, ...data });
      }

      // /api/search
      if (path === "/api/search") {
        if (!q.q) return err("Missing ?q=", 400);
        const key = `search:${q.q}`;
        const cached = getCache(key);
        if (cached) return json({ cached: true, query: q.q, ...cached });
        const data = await scrapeSearch(q.q);
        setCache(key, data, 2 * 60 * 1000);
        return json({ cached: false, ...data });
      }

      // /api/meta
      if (path === "/api/meta") {
        const cached = getCache("meta");
        if (cached) return json({ cached: true, ...cached });
        const data = await scrapeSiteMeta();
        setCache("meta", data, 60 * 60 * 1000);
        return json({ cached: false, ...data });
      }

      return err(`Not found: ${path}`, 404);
    } catch (e) {
      return err(e.message, 500);
    }
  },
};
