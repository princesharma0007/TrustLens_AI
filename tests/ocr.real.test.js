const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const service = require('../services/imageAnalysisService');
const request = require('supertest');
const app = require('../server');
const { rateLimitStore } = require('../middleware/imageUpload');
const analysis = require('../services/analysisService');
const ocr = require('../services/ocrService');
const { ocrError } = require('../scripts/evaluationMetrics');
const ocrRows = [];
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

async function syntheticImage(lines, { width = 1200, fontSize = 40, gap = 90, foreground = 'black', background = 'white' } = {}) {
  const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const svg = `<svg width="${width}" height="${100 + lines.length * gap}"><rect width="100%" height="100%" fill="${background}"/>${lines.map((text, index) => `<text x="40" y="${60 + index * gap}" font-family="Arial" font-size="${fontSize}" fill="${foreground}">${xml(text)}</text>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
realTest.each([
  { name: 'retail promotion', lines: ['Retail sale! Up to 60% off.', 'Shop: bit.ly/SaleDemo', 'You only have 2 days!'], level: 'needs verification', evidence: 'bit.ly/SaleDemo' },
  { name: 'routine transaction', lines: ['Rs. 500 was debited from your account.'], level: 'low concern', evidence: 'debited' },
  { name: 'college announcement', lines: ['College announcement: lectures start', 'tomorrow in Room 204.'], level: 'low concern', evidence: 'College' },
  { name: 'small low-contrast transaction', lines: ['INR 500 was debited from your account.'], options: { width: 650, fontSize: 16, gap: 40, foreground: '#999999', background: '#dddddd' }, level: 'low concern', evidence: 'debited' },
  { name: 'multiple unrelated messages', lines: ['College internship announcement tomorrow.', '', '', 'Pay a registration fee at the library desk.'], level: 'needs verification', evidence: 'registration' },
  { name: 'wrapped OTP phishing', lines: ['Share your', 'OTP to prevent account suspension.'], level: 'high concern', evidence: 'OTP' },
])('real screenshot pipeline: $name', async ({ name, lines, options, level, evidence }) => {
  rateLimitStore.resetAll();
  const image = await syntheticImage(lines, options);
  const legacy = await sharp(image).rotate().flatten({ background: '#ffffff' })
    .resize({ width: 2000, height: 6000, fit: 'inside', withoutEnlargement: true }).greyscale().png().toBuffer();
  const before = await ocr.extractText(legacy);
  const response = await request(app).post('/api/analyze-image').attach('image', image, 'synthetic.png').expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const result = response.body;
  expect(result.extractedText).toContain(evidence);
  expect(result.ocrConfidence).toBeGreaterThanOrEqual(45);
  expect(result.analysisMode).toBe('ocr + rule-based');
  expect(result.riskLevel).toBe(level);
  const original = lines.join('\n');
  const direct = await analysis.analyze(result.extractedText);
  const corrected = await analysis.analyze(original);
  const assessment = value => ({ riskLevel: value.riskLevel, summary: value.summary, indicators: value.indicators, recommendedActions: value.recommendedActions });
  expect(assessment(result)).toEqual(assessment(direct));
  expect(corrected.riskLevel).toBe(level);
  ocrRows.push({ name, original, beforeText: before.text.trim(), extractedText: result.extractedText, correctedText: original, beforeError: ocrError(original, before.text), afterError: ocrError(original, result.extractedText), extractedRisk: result.riskLevel, correctedRisk: corrected.riskLevel, imageTextAssessmentParity: true });
}, 60000);
realTest('real degraded screenshot returns an extraction error without a risk category', async () => {
  const image = await sharp(await syntheticImage(['Retail sale! Up to 60% off.', 'Shop: bit.ly/SaleDemo']))
    .resize({ width: 120 }).blur(3).png().toBuffer();
  rateLimitStore.resetAll();
  const response = await request(app).post('/api/analyze-image').attach('image', image, 'synthetic-blurred.png').expect(422);
  expect(response.body.error).toContain('No clear English text');
  expect(response.body).not.toHaveProperty('riskLevel');
}, 60000);

afterAll(() => {
  if (process.env.RUN_REAL_OCR !== '1' || !ocrRows.length) return;
  const total = field => ocrRows.reduce((sum, row) => sum + row[field].edits, 0);
  const characters = ocrRows.reduce((sum, row) => sum + row.afterError.referenceCharacters, 0);
  const report = { dataset: 'Synthetic development images; English OCR only. Before uses legacy scaling, both passes use the same current OCR worker.', samples: ocrRows.length, referenceCharacters: characters, beforeEdits: total('beforeError'), afterEdits: total('afterError'), beforeCER: total('beforeError') / characters, afterCER: total('afterError') / characters, rows: ocrRows };
  fs.writeFileSync(path.join(__dirname, '../docs/ocr-evaluation.json'), JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({ syntheticOcrEvaluation: { samples: report.samples, referenceCharacters: characters, beforeEdits: report.beforeEdits, afterEdits: report.afterEdits, beforeCER: report.beforeCER, afterCER: report.afterCER } }));
});
