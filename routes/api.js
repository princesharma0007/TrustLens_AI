const express = require('express');
const router = express.Router();
const validateMessage = require('../middleware/validateMessage');
const gemmaService = require('../services/gemmaService');
const imageAnalysis = require('../services/imageAnalysisService');
const { imageUpload, imageRateLimiter, imageRequestGate } = require('../middleware/imageUpload');

router.post('/analyze-image', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, imageRateLimiter, imageRequestGate, imageUpload, async (req, res, next) => {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', cancel);
  try {
    const analysis = await imageAnalysis.analyze(req.file?.buffer, { signal: controller.signal });
    if (!res.destroyed) res.json(analysis);
  } catch (error) {
    if (!res.destroyed) next(error);
  } finally {
    res.removeListener('close', cancel);
    // Release the multipart buffer reference as soon as processing ends.
    if (req.file) delete req.file.buffer;
  }
});

// POST /api/analyze
router.post('/analyze', validateMessage, async (req, res, next) => {
  try {
    const { message } = req.body;
    // Call the analysis service (currently rule‑based placeholder)
    const analysis = await gemmaService.analyze(message);
    res.json(analysis);
  } catch (err) {
    // If the service throws a known error shape, forward it; otherwise generic
    next(err);
  }
});

module.exports = router;
