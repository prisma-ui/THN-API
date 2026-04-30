/**
 * Serves Swagger UI at /api/docs
 * Uses CDN for swagger-ui assets (no local file dependency)
 */

const spec = require("./openapi");

const SWAGGER_UI_VERSION = "5.17.14";
const CDN = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

function swaggerUIHtml(specUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>THN API – Documentation</title>
  <link rel="stylesheet" type="text/css" href="${CDN}/swagger-ui.css" />
  <style>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>THN API – Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; }
    #thn-header {
      background: #0d0d0d;
      border-bottom: 1px solid #1a1a1a;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    #thn-header .logo { font-family: "Courier New", monospace; font-size: 1.1rem; font-weight: 700; color: #00ff88; letter-spacing: 0.05em; }
    #thn-header .tagline { font-size: 0.8rem; color: #555; font-family: "Courier New", monospace; }
    #thn-header a { margin-left: auto; font-size: 0.8rem; color: #00ff88; text-decoration: none; font-family: "Courier New", monospace; border: 1px solid #00ff88; padding: 4px 10px; border-radius: 2px; }
    #thn-header a:hover { background: #00ff8815; }
    .swagger-ui { background: #0a0a0a !important; }
    .swagger-ui .topbar { display: none !important; }
    .swagger-ui .info .title { color: #00ff88 !important; font-family: "Courier New", monospace !important; }
    .swagger-ui .opblock-tag { color: #00ff88 !important; border-bottom-color: #1a1a1a !important; }
    .swagger-ui .opblock-tag:hover { background: #00ff8808 !important; }
    .swagger-ui section.models h4 { color: #00ff88 !important; }
    .swagger-ui .response-col_status { color: #00ff88 !important; }
  </style>
  <link rel="stylesheet" type="text/css" href="/api/docs/swagger-ui.css" />
</head>
<body>
  <div id="thn-header">
    <div class="logo">&gt;_ THN API</div>
    <div class="tagline">// Unofficial REST API for thehackernews.com</div>
    <a href="${specUrl}" target="_blank">openapi.json ↗</a>
  </div>
  <div id="swagger-ui"></div>
  <script src="${CDN}/swagger-ui-bundle.js"></script>
  <script src="${CDN}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        deepLinking: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        persistAuthorization: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: "list",
        syntaxHighlight: { activated: true, theme: "monokai" },
      });
    };
  </script>
</body>
</html>`;
}

async function docsHandler(req, res, pathname) {
  // Raw OpenAPI JSON spec
  if (pathname === "/api/docs/openapi.json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.statusCode = 200;
    res.end(JSON.stringify(spec, null, 2));
    return true;
  }

  // Swagger UI HTML — /api/docs or /api/docs/
  if (pathname === "/api/docs" || pathname === "/api/docs/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    res.end(swaggerUIHtml("/api/docs/openapi.json"));
    return true;
  }

  // Redirect /docs → /api/docs
  if (pathname === "/docs" || pathname === "/docs/") {
    res.setHeader("Location", "/api/docs");
    res.statusCode = 301;
    res.end();
    return true;
  }

  return false;
}

module.exports = { docsHandler, spec };
