
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const apiRouter = require('./routes/api');

const app = express();

// Security headers
app.use(helmet());

// Parse JSON with a 5 KB request body limit
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
