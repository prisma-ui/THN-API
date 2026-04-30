/**
 * Shared response / error utilities
 */

function successResponse(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

function errorResponse(res, message, statusCode = 500, details = null) {
  const payload = {
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  };
  if (details) payload.details = details;
  return res.status(statusCode).json(payload);
}

/**
 * Async handler wrapper — catches errors and returns JSON
 */
function asyncHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error("[THN API Error]", err.message);

      // Axios upstream errors
      if (err.response) {
        const status = err.response.status;
        if (status === 404) {
          return errorResponse(res, "Article or page not found on thehackernews.com", 404);
        }
        // NOTE: 403/429/503 are NOT caught here — scraper.js handles them
        // with RSS fallback first. Only reach here if scraper also failed.
        if (status === 403 || status === 429 || status === 503) {
          return errorResponse(res, "THN blocked all requests including RSS fallback. Try again later.", 503);
        }
        return errorResponse(res, `Upstream request failed: ${status}`, 502, err.message);
      }

      // Timeout errors
      if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || err.message?.includes("timeout")) {
        return errorResponse(res, "Request to thehackernews.com timed out. Try again.", 504);
      }

      // DNS / network errors
      if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
        return errorResponse(res, "Cannot reach thehackernews.com. Network error.", 502);
      }

      return errorResponse(res, err.message || "Internal server error", 500);
    }
  };
}

/**
 * CORS headers helper
 */
function setCORSHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { successResponse, errorResponse, asyncHandler, setCORSHeaders };
