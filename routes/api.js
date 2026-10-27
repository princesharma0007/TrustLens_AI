const express = require('express');
const router = express.Router();
const validateMessage = require('../middleware/validateMessage');
const gemmaService = require('../services/gemmaService');

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
