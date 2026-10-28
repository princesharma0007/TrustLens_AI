const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const service = require('../services/imageAnalysisService');
const realTest = process.env.RUN_REAL_OCR === '1' ? test : test.skip;

// Opt-in: real local OCR, no mock output, no network or credentials required.
realTest('extracts and analyzes the synthetic screenshot with actual local OCR', async () => {
  const result = await service.analyze(fs.readFileSync(path.join(__dirname, 'fixtures/message-screenshot.png')));
  expect(result.analysisMode).toBe('ocr + rule-based');
  expect(result.riskLevel).toBe('high concern');
  expect(result.indicators.some(item => item.type === 'OTP request')).toBe(true);
  expect(result.indicators.some(item => item.type === 'Urgency')).toBe(true);
}, 60000);
realTest('real blank screenshot returns an unreadable-text error', async () => {
  const image = await sharp({ create: { width: 1000, height: 500, channels: 3, background: 'white' } }).png().toBuffer();
  await expect(service.analyze(image)).rejects.toMatchObject({ status: 422 });
}, 60000);
