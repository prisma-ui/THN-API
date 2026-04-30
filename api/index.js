/**
 * ╔══════════════════════════════════════════════════════╗
 * ║     The Hacker News API Wrapper                      ║
 * ║     Serverless (Vercel / Netlify / Any Node host)    ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Routes:
 *   GET /api                       — API info & docs
 *   GET /api/news                  — Latest articles (home page)
 *   GET /api/news?page_url=<url>   — Paginate using next_url from response
 *   GET /api/news/:slug            — Full article by slug
 *   GET /api/article?url=<url>     — Full article by absolute URL
 *   GET /api/category/:name        — Articles by category/label
 *   GET /api/category/:name?cursor=<cursor> — Paginated category
 *   GET /api/search?q=<query>      — Search articles
 *   GET /api/meta                  — Site metadata & categories
 *   GET /api/cache                 — Cache stats
 *   DELETE /api/cache              — Clear cache (needs ?secret=)
 */

const {
  scrapeArticleList,
  scrapeArticle,
  scrapeCategory,
  scrapeSearch,
  scrapeSiteMeta,
} = require("../lib/scraper");

const {
  cacheGet,
  cacheSet,
  cacheClear,
  cacheStats,
  DEFAULT_TTL,
} = require("../lib/cache");

const {
  successResponse,
  errorResponse,
  asyncHandler,
  setCORSHeaders,
} = require("../lib/helpers");

const { docsHandler } = require("../lib/swagger");

// ── Micro-router ──────────────────────────────────────────
function matchRoute(pathname) {
  // /api/news/<slug>
  const articleSlug = pathname.match(/^\/api\/news\/(.+)$/);
  if (articleSlug) return { route: "article_by_slug", slug: decodeURIComponent(articleSlug[1]) };

  // /api/category/<name>
  const category = pathname.match(/^\/api\/category\/(.+)$/);
  if (category) return { route: "category", name: decodeURIComponent(category[1]) };

  const routes = {
    "/api": "info",
    "/api/news": "news",
    "/api/article": "article_by_url",
    "/api/search": "search",
    "/api/meta": "meta",
    "/api/cache": "cache",
  };

  return { route: routes[pathname] || null };
}

// ── Main handler ──────────────────────────────────────────
module.exports = asyncHandler(async (req, res) => {
  setCORSHeaders(res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const { pathname } = url;
  const query = Object.fromEntries(url.searchParams);

  // ── Swagger / OpenAPI Docs ─────────────────────────────
  if (pathname.startsWith("/api/docs") || pathname === "/docs") {
    const handled = await docsHandler(req, res, pathname);
    if (handled !== false) return;
  }

  const { route, slug, name } = matchRoute(pathname);

  // ── GET /api — API Documentation ──────────────────────
  if (route === "info") {
    return res.status(200).json({
      name: "The Hacker News API Wrapper",
      version: "1.0.0",
      description: "Unofficial REST API for thehackernews.com",
      source: "https://thehackernews.com",
      endpoints: {
        "GET /api/docs": "Interactive Swagger UI documentation",
        "GET /api/docs/openapi.json": "Raw OpenAPI 3.0 spec",
        "GET /api/news": "Latest articles (home page)",
        "GET /api/news?page_url=URL": "Paginate articles",
        "GET /api/news/:year/:month/:slug.html": "Full article by slug",
        "GET /api/article?url=URL": "Full article by absolute URL",
        "GET /api/category/:name": "Articles by category",
        "GET /api/category/:name?cursor=CURSOR": "Paginate category",
        "GET /api/search?q=QUERY": "Search articles",
        "GET /api/meta": "Site metadata + categories",
        "GET /api/cache": "Cache stats",
        "DELETE /api/cache?secret=SECRET": "Clear cache",
      },
      example_categories: [
        "Data Breaches",
        "Vulnerability",
        "Malware",
        "Ransomware",
        "Cyber Attack",
        "AI Security",
        "Cloud Security",
      ],
    });
  }

  // ── GET /api/news — Latest Articles ───────────────────
  if (route === "news") {
    const pageUrl = query.page_url || null;
    const cacheKey = `news:${pageUrl || "home"}`;
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, ...cached });

    const data = await scrapeArticleList(
      pageUrl ? decodeURIComponent(pageUrl) : undefined
    );
    cacheSet(cacheKey, data, DEFAULT_TTL.list);
    return successResponse(res, { cached: false, ...data });
  }

  // ── GET /api/news/:slug — Article by Slug ─────────────
  if (route === "article_by_slug") {
    const articleUrl = `https://thehackernews.com/${slug}`;
    const cacheKey = `article:${slug}`;
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, article: cached });

    const article = await scrapeArticle(articleUrl);
    cacheSet(cacheKey, article, DEFAULT_TTL.article);
    return successResponse(res, { cached: false, article });
  }

  // ── GET /api/article?url= — Article by URL ────────────
  if (route === "article_by_url") {
    if (!query.url)
      return errorResponse(res, "Missing required query param: url", 400);

    const targetUrl = decodeURIComponent(query.url);
    const cacheKey = `article:${targetUrl}`;
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, article: cached });

    const article = await scrapeArticle(targetUrl);
    cacheSet(cacheKey, article, DEFAULT_TTL.article);
    return successResponse(res, { cached: false, article });
  }

  // ── GET /api/category/:name — Category Feed ───────────
  if (route === "category") {
    const cursor = query.cursor || null;
    const cacheKey = `category:${name}:${cursor || "first"}`;
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, category: name, ...cached });

    const data = await scrapeCategory(name, cursor);
    cacheSet(cacheKey, data, DEFAULT_TTL.list);
    return successResponse(res, { cached: false, category: name, ...data });
  }

  // ── GET /api/search?q= — Search ───────────────────────
  if (route === "search") {
    if (!query.q)
      return errorResponse(res, "Missing required query param: q", 400);

    const searchQuery = decodeURIComponent(query.q);
    const cacheKey = `search:${searchQuery}`;
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, ...cached });

    const data = await scrapeSearch(searchQuery);
    cacheSet(cacheKey, data, DEFAULT_TTL.search);
    return successResponse(res, { cached: false, ...data });
  }

  // ── GET /api/meta — Site Metadata ─────────────────────
  if (route === "meta") {
    const cacheKey = "meta";
    const cached = cacheGet(cacheKey);
    if (cached) return successResponse(res, { cached: true, ...cached });

    const data = await scrapeSiteMeta();
    cacheSet(cacheKey, data, DEFAULT_TTL.meta);
    return successResponse(res, { cached: false, ...data });
  }

  // ── /api/cache — Cache Management ─────────────────────
  if (route === "cache") {
    if (req.method === "DELETE") {
      const secret = query.secret || "";
      const adminSecret = process.env.CACHE_SECRET || "thn-secret-2025"; // Set CACHE_SECRET env var in production
      if (secret !== adminSecret)
        return errorResponse(res, "Invalid or missing secret", 401);
      cacheClear();
      return successResponse(res, { message: "Cache cleared successfully" });
    }
    return successResponse(res, { cache: cacheStats() });
  }

  // ── 404 ───────────────────────────────────────────────
  return errorResponse(res, `Route not found: ${pathname}`, 404);
});
