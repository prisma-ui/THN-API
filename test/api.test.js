/**
 * Basic integration test
 * Run: node test/api.test.js (requires network)
 */

// Mock test without network - validates structure only
const { cacheGet, cacheSet, cacheClear } = require("../lib/cache");
const { successResponse, errorResponse } = require("../lib/helpers");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

console.log("\n🧪 THN API - Unit Tests\n");

// Cache tests
console.log("📦 Cache Layer:");
cacheSet("test:key", { data: 42 }, 5000);
assert("Cache set and get returns value", cacheGet("test:key")?.data === 42);
assert("Cache miss returns null for unknown key", cacheGet("no:key") === null);
cacheClear();
assert("Cache clear removes all entries", cacheGet("test:key") === null);

// TTL test
cacheSet("ttl:test", { ok: true }, 1); // 1ms TTL
setTimeout(() => {
  assert("Expired cache entry returns null", cacheGet("ttl:test") === null);
  
  // Response helper tests
  console.log("\n📡 Response Helpers:");
  
  const mockRes = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(data) { this._body = data; return this; },
    setHeader() { return this; },
    getHeader() { return null; },
  };
  
  successResponse(mockRes, { articles: [1, 2, 3] });
  assert("successResponse sets success:true", mockRes._body.success === true);
  assert("successResponse includes data", mockRes._body.articles?.length === 3);
  assert("successResponse includes timestamp", !!mockRes._body.timestamp);

  errorResponse(mockRes, "Not found", 404);
  assert("errorResponse sets success:false", mockRes._body.success === false);
  assert("errorResponse sets status 404", mockRes._status === 404);
  assert("errorResponse includes error message", mockRes._body.error === "Not found");
  
  // Scraper structure tests
  console.log("\n🕷️  Scraper Module:");
  const scraper = require("../lib/scraper");
  assert("scrapeArticleList is a function", typeof scraper.scrapeArticleList === "function");
  assert("scrapeArticle is a function", typeof scraper.scrapeArticle === "function");
  assert("scrapeCategory is a function", typeof scraper.scrapeCategory === "function");
  assert("scrapeSearch is a function", typeof scraper.scrapeSearch === "function");
  assert("scrapeSiteMeta is a function", typeof scraper.scrapeSiteMeta === "function");
  assert("BASE_URL is correct", scraper.BASE_URL === "https://thehackernews.com");
  
  // API handler tests
  console.log("\n🔌 API Handler:");
  const handler = require("../api/index");
  assert("Handler is a function", typeof handler === "function");
  
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) console.log("✅ All tests passed!\n");
  else console.log("❌ Some tests failed.\n");
  
  process.exit(failed > 0 ? 1 : 0);
}, 50);
