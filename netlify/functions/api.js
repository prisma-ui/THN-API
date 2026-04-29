/**
 * Netlify Functions adapter
 * Deploy path: netlify/functions/api.js
 * URL: /.netlify/functions/api/*
 */

const handler = require("../../api/index");

exports.handler = async (event, context) => {
  // Build a minimal req/res compatible with our handler
  const url = event.path + (event.rawQuery ? "?" + event.rawQuery : "");

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
};
