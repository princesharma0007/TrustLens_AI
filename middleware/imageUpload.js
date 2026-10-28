const multer = require('multer');
const { rateLimit, MemoryStore } = require('express-rate-limit');
const { MAX_BYTES } = require('../services/imageAnalysisService');

const rateLimitStore = new MemoryStore();
let activeUploads = 0;
// Bound in-memory multipart buffers as well as the single OCR job. Rejected
// clients are not queued, so a busy process cannot accumulate image uploads.
function imageRequestGate(req, res, next) {
  if (activeUploads >= 2) {
    return res.status(429).json({ success: false, error: 'Screenshot analysis is busy. Please wait and try again.' });
  }
  activeUploads += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads -= 1;
    res.removeListener('finish', release);
    res.removeListener('close', release);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}
const imageRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  store: rateLimitStore,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, error: 'Too many screenshot requests. Wait a minute and try again.' },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2 },
}).single('image');

function imageUpload(req, res, next) {
  res.set('Cache-Control', 'no-store');
  upload(req, res, error => {
    if (!error) return next();
    const oversized = error.code === 'LIMIT_FILE_SIZE';
    res.status(oversized ? 413 : 400).json({
      success: false,
      error: oversized ? 'The image exceeds 5 MB. Choose a smaller screenshot.' : 'Upload one PNG, JPEG, or WebP file using the image field.',
    });
  });
}

module.exports = { imageUpload, imageRateLimiter, imageRequestGate, rateLimitStore };
