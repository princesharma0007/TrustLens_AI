
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const path = require('path');
const apiRouter = require('./routes/api');
const imageAnalysis = require('./services/imageAnalysisService');
const { rateLimit, MemoryStore } = require('express-rate-limit');

const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.render('index', { imageAnalysisAvailable: imageAnalysis.isAvailable() }));

// Preserve the text API's 10-per-minute limit independently of image uploads.
const textRateLimitStore = new MemoryStore();
app.locals.textRateLimitStore = textRateLimitStore;
app.post('/api/analyze', rateLimit({
  windowMs: 60000,
  limit: 10,
  store: textRateLimitStore,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' },
}));

// Accommodate 5,000 characters, including UTF-8 and JSON-escaped text.
// The message validator separately enforces the character limit.
app.use(express.json({ limit: '64kb' }));

// Mount API routes under /api
app.use('/api', apiRouter);

// Generic error handler with safe public responses
app.use((err, req, res, next) => {
  // Do not log raw errors: JSON parser errors may contain private messages.

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
    err.status < 600
      ? err.status
      : 500;

  const message =
    err.isPublic
      ? err.publicMessage
      : status >= 500 ? 'Internal server error' : 'Request failed';

  if (status >= 500) console.error('Analysis request failed.');

  return res.status(status).json({
    success: false,
    error: message,
    ...(err.isPublic && err.textExtractionStatus === 'insufficient' ? { textExtractionStatus: 'insufficient' } : {}),
  });
});

const port = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(port, () => {
    console.log(`TrustLens AI backend listening on port ${port}`);
  });
}

module.exports = app;
