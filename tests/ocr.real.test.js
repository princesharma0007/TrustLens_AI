const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const service = require('../services/imageAnalysisService');
const request = require('supertest');
const app = require('../server');
const { rateLimitStore } = require('../middleware/imageUpload');
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

async function syntheticImage(lines) {
  const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const svg = `<svg width="1200" height="${100 + lines.length * 90}"><rect width="100%" height="100%" fill="white"/>${lines.map((text, index) => `<text x="40" y="${80 + index * 90}" font-family="Arial" font-size="40" fill="black">${xml(text)}</text>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
realTest.each([
  { name: 'retail promotion', lines: ['Retail sale! Up to 60% off.', 'Shop: bit.ly/SaleDemo', 'You only have 2 days!'], level: 'needs verification', evidence: 'bit.ly/SaleDemo' },
  { name: 'routine transaction', lines: ['Rs. 500 was debited from your account.'], level: 'low concern', evidence: 'debited' },
  { name: 'college announcement', lines: ['College announcement: lectures start', 'tomorrow in Room 204.'], level: 'low concern', evidence: 'College' },
  { name: 'wrapped OTP phishing', lines: ['Share your', 'OTP to prevent account suspension.'], level: 'high concern', evidence: 'OTP' },
])('real screenshot pipeline: $name', async ({ name, lines, level, evidence }) => {
  rateLimitStore.resetAll();
  const response = await request(app).post('/api/analyze-image').attach('image', await syntheticImage(lines), 'synthetic.png').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const result = response.body;
  expect(result.extractedText).toContain(evidence);
  expect(result.ocrConfidence).toBeGreaterThanOrEqual(45);
  expect(result.analysisMode).toBe('ocr + rule-based');
  expect(result.riskLevel).toBe(level);
  console.info(JSON.stringify({ synthetic: name, extractedText: result.extractedText, confidence: result.ocrConfidence, riskLevel: result.riskLevel }));
}, 60000);
realTest('real degraded screenshot returns an extraction error without a risk category', async () => {
  const image = await sharp(await syntheticImage(['Retail sale! Up to 60% off.', 'Shop: bit.ly/SaleDemo']))
    .resize({ width: 120 }).blur(3).png().toBuffer();
  rateLimitStore.resetAll();
  const response = await request(app).post('/api/analyze-image').attach('image', image, 'synthetic-blurred.png').expect(422);
  expect(response.body.error).toContain('No clear English text');
  expect(response.body).not.toHaveProperty('riskLevel');
}, 60000);
