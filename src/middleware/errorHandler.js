'use strict';

/**
 * middleware/errorHandler.js
 * Global error handler + request logger.
 */

// Request Logger
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const color =
      res.statusCode >= 500 ? '\x1b[31m' : // red
      res.statusCode >= 400 ? '\x1b[33m' : // yellow
      res.statusCode >= 200 ? '\x1b[32m' : // green
      '\x1b[0m';
    const reset = '\x1b[0m';
    console.log(`${color}${res.statusCode}${reset} ${req.method} ${req.path} — ${duration}ms`);
  });
  next();
}

// 404 Handler
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    hint: 'Available base paths: /api/chat, /health',
  });
}

// Global Error Handler
function globalErrorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  // Log full error in dev; in prod include stack for 5xx so hosting logs are actionable.
  if (process.env.NODE_ENV !== 'production') {
    console.error('\x1b[31m[ERROR]\x1b[0m', err.stack || err.message);
  } else if (status >= 500) {
    console.error(`[ERROR] ${req.method} ${req.path} —`, err.stack || err.message);
  } else {
    console.error(`[ERROR] ${req.method} ${req.path} — ${err.message}`);
  }

  // Never leak stack traces to the client
  const body = {
    error: status < 500 ? err.message : 'An internal error occurred. Please try again.',
    status,
  };

  // In local dev, return extra info to speed debugging
  if (process.env.NODE_ENV === 'development' && status >= 500) {
    body.detail = err.message;
  }

  res.status(status).json(body);
}

// Validate JSON body fields
function requireFields(...fields) {
  return (req, res, next) => {
    const missing = fields.filter(
      f => req.body[f] === undefined || req.body[f] === null || req.body[f] === ''
    );
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required field(s): ${missing.join(', ')}`,
        fields: missing,
      });
    }
    next();
  };
}

module.exports = { requestLogger, notFoundHandler, globalErrorHandler, requireFields };

