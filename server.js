/**
 * Local development server
 * Run: node server.js
 * Test: http://localhost:3000/api/news
 */

const http = require("http");
const handler = require("./api/index");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Attach json() helper (Vercel-compatible shim)
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify(data, null, 2));
    return res;
  };
  res.setHeader("Content-Type", "application/json");
  handler(req, res);
});

server.listen(PORT, () => {
  console.log(`\n🚀 THN API running at http://localhost:${PORT}`);
  console.log("\nAvailable endpoints:");
  console.log(`  GET http://localhost:${PORT}/api`);
  console.log(`  GET http://localhost:${PORT}/api/news`);
  console.log(`  GET http://localhost:${PORT}/api/search?q=ransomware`);
  console.log(`  GET http://localhost:${PORT}/api/category/Malware`);
  console.log(`  GET http://localhost:${PORT}/api/meta`);
  console.log(`  GET http://localhost:${PORT}/api/cache`);
  console.log("\nPress Ctrl+C to stop\n");
});
