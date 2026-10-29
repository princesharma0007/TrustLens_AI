const request = require('supertest');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const ocr = require('../services/ocrService');
const { rateLimitStore } = require('../middleware/imageUpload');
const message = 'Your account will be blocked in 30 minutes. Share your OTP to verify.';
let images;

beforeAll(async () => {
  const png = fs.readFileSync(path.join(__dirname, 'fixtures/message-screenshot.png'));
  images = { png, jpeg: await sharp(png).jpeg().toBuffer(), webp: await sharp(png).webp().toBuffer() };
});
beforeEach(() => {
  rateLimitStore.resetAll();
  jest.spyOn(ocr, 'extractText').mockResolvedValue({ text: message, confidence: 95 });
});
afterEach(() => jest.restoreAllMocks());
const postImage = (buffer, name = 'message.png') => request(app).post('/api/analyze-image').attach('image', buffer, name);

test.each(['png', 'jpeg', 'webp'])('decodes genuine %s and returns actual rule-based analysis of OCR text', async format => {
  const res = await postImage(images[format], `message.${format}`).expect(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.analysisMode).toBe('ocr + rule-based');
  expect(res.body.riskLevel).toBe('high concern');
  expect(res.body.indicators).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'OTP request', evidence: expect.stringContaining('Share your OTP') })]));
  expect(res.body.uncertainty).toContain('misread');
  expect(Object.keys(res.body).sort()).toEqual(['riskLevel', 'summary', 'indicators', 'recommendedActions', 'uncertainty', 'analysisMode', 'extractedText', 'ocrConfidence'].sort());
  expect(ocr.extractText).toHaveBeenCalledTimes(1);
});

test('validates actual content even if the filename claims PNG', async () => {
  await postImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).expect(415);
  expect(ocr.extractText).not.toHaveBeenCalled();
});
test('rejects unsupported actual image format', async () => {
  const gif = await sharp(images.png).gif().toBuffer();
  await postImage(gif, 'message.gif').expect(415);
});
test('fully decodes and rejects corrupted PNG content', async () => {
  await postImage(images.png.subarray(0, 50)).expect(422);
  expect(ocr.extractText).not.toHaveBeenCalled();
});
test('rejects images over 5 MB before OCR', async () => {
  await postImage(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  expect(ocr.extractText).not.toHaveBeenCalled();
});
test('accepts exactly 5 MB when image content is valid', async () => {
  const padded = Buffer.concat([images.png, Buffer.alloc(5 * 1024 * 1024 - images.png.length)]);
  await postImage(padded).expect(200);
});
test('rejects missing image and wrong multipart field', async () => {
  await request(app).post('/api/analyze-image').send({}).expect(400);
  await request(app).post('/api/analyze-image').attach('file', images.png, 'message.png').expect(400);
});
test('rejects multiple files', async () => {
  await request(app).post('/api/analyze-image').attach('image', images.png, 'a.png').attach('image', images.png, 'b.png').expect(400);
});
test('rejects excessive decoded dimensions', async () => {
  const large = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  await postImage(large).expect(422);
  expect(ocr.extractText).not.toHaveBeenCalled();
});
test.each([{ text: '', confidence: 0 }, { text: 'unreadable', confidence: 10 }])('handles unreadable or low-quality OCR', async result => {
  ocr.extractText.mockResolvedValue(result);
  const res = await postImage(images.png).expect(422);
  expect(res.body.error).toContain('No clear English text');
});
test('supports messages longer than the text form limit without truncation', async () => {
  ocr.extractText.mockResolvedValue({ text: 'word '.repeat(1100) + ' Share your OTP.', confidence: 95 });
  const res = await postImage(images.png).expect(200);
  expect(res.body.indicators.some(item => item.type === 'OTP request')).toBe(true);
});
test('rejects excessive extracted text instead of silently truncating it', async () => {
  ocr.extractText.mockResolvedValue({ text: 'x'.repeat(20001), confidence: 95 });
  await postImage(images.png).expect(422);
});
test('rejects an OCR output explicitly marked as truncated', async () => {
  ocr.extractText.mockResolvedValue({ text: 'OTP', confidence: 95, truncated: true });
  const res = await postImage(images.png).expect(422);
  expect(res.body.error).toContain('too much text');
});
test('returns safe OCR failure and does not log private contents', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  ocr.extractText.mockRejectedValue(new Error('PRIVATE extracted message'));
  const res = await postImage(images.png).expect(500);
  expect(res.body.error).toBe('Internal server error');
  expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  expect(log).toHaveBeenCalledWith('Analysis request failed.');
});
test('preserves understandable timeout errors', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ocr.extractText.mockRejectedValue(ocr.publicError(504, 'Screenshot processing timed out. Crop the message and try again.'));
  const res = await postImage(images.png).expect(504);
  expect(res.body.error).toContain('timed out');
});
test('rate limits screenshot requests', async () => {
  for (let i = 0; i < 10; i++) await request(app).post('/api/analyze-image').send({}).expect(400);
  const res = await request(app).post('/api/analyze-image').send({}).expect(429);
  expect(res.headers['retry-after']).toBeDefined();
  expect(res.headers['cache-control']).toBe('no-store');
});
test('limits OCR concurrency and recovers after a completed request', async () => {
  let finish;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  ocr.extractText.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const first = postImage(images.png).then(res => res);
  await ready;
  await postImage(images.png).expect(429);
  finish({ text: message, confidence: 95 });
  expect((await first).status).toBe(200);
  await postImage(images.png).expect(200);
});
test('homepage enables screenshot analysis only when local OCR is installed', async () => {
  const res = await request(app).get('/').expect(200);
  expect(res.text).toContain('data-analysis-available="true"');
  expect(res.text).toContain('Local English OCR');
  expect(res.headers['content-security-policy']).toContain('blob:');
  jest.spyOn(ocr, 'isAvailable').mockReturnValue(false);
  const unavailable = await request(app).get('/').expect(200);
  expect(unavailable.text).toContain('data-analysis-available="false"');
});

test('OCR preserves genuine configured Gemma mode instead of claiming rule-based processing', async () => {
  jest.spyOn(require('../services/gemmaService'), 'analyze').mockResolvedValue({
    riskLevel: 'needs verification', summary: 'A verification request needs context.',
    indicators: [], recommendedActions: ['Verify independently.'],
    uncertainty: 'Sender identity remains unverified.', analysisMode: 'gemma-4',
  });
  const res = await postImage(images.png).expect(200);
  expect(res.body.analysisMode).toBe('ocr + gemma-4');
  expect(res.body.uncertainty).toContain('OCR');
});

test.each([
  ['Retail sale! Up to 60% off.\nShop: bit.ly/SaleDemo\nYou only have 2 days!', 'needs verification'],
  ['Rs. 500 was debited from your account.', 'low concern'],
  ['Share your\nOTP to prevent account suspension.', 'high concern'],
  ['College announcement: lectures start tomorrow in Room 204.', 'low concern'],
])('passes the exact OCR output to classification and returns inspectable text: %s', async (text, level) => {
  ocr.extractText.mockResolvedValue({ text, confidence: 94 });
  const res = await postImage(images.png).expect(200);
  expect(res.body.riskLevel).toBe(level);
  expect(res.body.extractedText).toBe(text);
  expect(res.body.ocrConfidence).toBe(94);
  for (const item of res.body.indicators) expect(text).toContain(item.evidence);
});
test.each([
  { text: '', confidence: 95 }, { text: 'Retail sale', confidence: 20 },
  { text: '???', confidence: 90 }, { text: 'Retail sale', confidence: NaN },
  { text: 'Retail sale', confidence: 101 }, null,
])('unreliable extraction never reaches risk analysis', async extraction => {
  ocr.extractText.mockResolvedValue(extraction);
  const analyze = jest.spyOn(require('../services/gemmaService'), 'analyze');
  const res = await postImage(images.png).expect(422);
  expect(res.body.error).toContain('No clear English text');
  expect(res.body).not.toHaveProperty('riskLevel');
  expect(res.body).not.toHaveProperty('extractedText');
  expect(analyze).not.toHaveBeenCalled();
});
