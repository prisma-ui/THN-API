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
      if (err.response) {
        // Axios error
        return errorResponse(
          res,
          `Upstream request failed: ${err.response.status}`,
          502,
          err.message
        );
      }
      if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
        return errorResponse(res, "Request timed out", 504);
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = { successResponse, errorResponse, asyncHandler, setCORSHeaders };
