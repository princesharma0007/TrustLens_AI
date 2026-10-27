
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const apiRouter = require('./routes/api');

const app = express();

// Security headers
app.use(helmet());

// Rate limiter middleware – max 10 requests per minute per IP for /api/analyze
const rateLimiter = (req, res, next) => {
  if (req.path !== '/api/analyze') return next();
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  if (!global.__rateLimitMap) global.__rateLimitMap = {};
  const entry = global.__rateLimitMap[ip] || { count: 0, start: now };
  // Reset if window passed
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  global.__rateLimitMap[ip] = entry;
  // Clean up old entries
  for (const [key, val] of Object.entries(global.__rateLimitMap)) {
    if (now - val.start > windowMs) delete global.__rateLimitMap[key];
  }
  if (entry.count > 10) {
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }
  next();
};

// Apply rate limiter before routing
app.use(rateLimiter);

app.use(express.json({ limit: '5kb' }));

// Mount API routes under /api
app.use('/api', apiRouter);

// Generic error handler with safe public responses
app.use((err, req, res, next) => {
  console.error(err); // Server-side logging only

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON payload'
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: 'Request payload too large'
    });
  }

  const status =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 500
      ? err.status
      : 500;

  const message =
    status === 500
      ? 'Internal server error'
      : (err.publicMessage || 'Request failed');

  return res.status(status).json({
    success: false,
    error: message
  });
});

const port = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`TrustLens AI backend listening on port ${port}`);
  });
}

module.exports = app;
