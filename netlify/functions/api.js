/**
 * Netlify Functions adapter
 * Deploy path: netlify/functions/api.js
 * URL: /.netlify/functions/api/*
 */

const handler = require("../../api/index");

exports.handler = async (event, context) => {
  try {
    // Build a minimal req/res compatible with our handler
    // Handle URL construction with try-catch
    let url;
    try {
      url = event.path + (event.rawQuery ? "?" + event.rawQuery : "");
    } catch (err) {
      console.error("[Netlify API] URL construction error:", err.message);
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Invalid request URL",
          timestamp: new Date().toISOString(),
        }),
      };
    }

    let statusCode = 200;
    let responseBody = "";
    let responseHeaders = { "Content-Type": "application/json" };

    const req = {
      method: event.httpMethod,
      url,
      headers: event.headers || {},
    };

    const res = {
      statusCode,
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      setHeader(key, value) {
        responseHeaders[key] = value;
        return this;
      },
      getHeader(key) {
        return responseHeaders[key];
      },
      json(data) {
        responseBody = JSON.stringify(data);
        return this;
      },
      end(data) {
        if (data) responseBody = data;
        return this;
      },
    };

    await handler(req, res);

    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody,
    };
  } catch (err) {
    console.error("[Netlify API] Unhandled error:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
