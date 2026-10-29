const request = require('supertest');
const app = require('../server');
const service = require('../services/gemmaService');
const rules = require('../services/ruleAnalysisService');
const { LEVELS, classify } = require('../services/riskClassification');
const evaluation = require('./fixtures/risk-evaluation.json');
const keys = ['GEMMA_API_KEY', 'GEMMA_API_URL', 'GEMMA_FALLBACK_ENABLED'];
let saved, originalFetch;
beforeEach(() => {
  saved = keys.map(key => process.env[key]); keys.forEach(key => delete process.env[key]);
  originalFetch = global.fetch; app.locals.textRateLimitStore.resetAll();
});
afterEach(() => {
  keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  global.fetch = originalFetch;
});
test.each(evaluation)('$id returns $expected through the real text API', async ({ message, expected }) => {
  const res = await request(app).post('/api/analyze').send({ message }).expect(200);
  expect(res.body.riskLevel).toBe(expected);
  expect(res.body.analysisMode).toBe('rule-based');
  expect(res.body.uncertainty).toContain('not Gemma AI');
  for (const item of res.body.indicators) expect(message).toContain(item.evidence);
  if (expected === LEVELS.LOW) expect(res.body.indicators).toEqual([]);
});
test('classification prioritizes strong evidence over routine context', () => {
  expect(classify({ routine: true, moderate: true, strong: true })).toBe(LEVELS.HIGH);
  expect(classify({})).toBe(LEVELS.UNKNOWN);
});
test.each([
  ['Your internship offer requires a registration fee of Rs. 500.', LEVELS.HIGH],
  ['Your UPI PIN is required to receive this refund.', LEVELS.HIGH],
  ['Pay a processing fee of INR 100 to claim your lottery prize.', LEVELS.HIGH],
  ['Hello, see you at lunch tomorrow. Share your OTP.', LEVELS.HIGH],
  ['Never share your OTP; enter your UPI PIN to receive a refund.', LEVELS.HIGH],
  ['Never share your OTP, send your PIN now.', LEVELS.HIGH],
  ['College announcement: pay a registration fee for this internship.', LEVELS.HIGH],
  ['Your account was debited INR 100. Transfer money immediately to restore your account.', LEVELS.HIGH],
  ['Hi, lunch tomorrow. Download this app.', LEVELS.UNKNOWN],
  ['Your OTP is 123456. Never share your OTP.', LEVELS.UNKNOWN],
  ['Your account was debited INR 100. Never share your OTP.', LEVELS.LOW],
  ['Account xyz 123456 INR 500', LEVELS.UNKNOWN],
  ['Please approve this UPI collect request.', LEVELS.MEDIUM],
  ['नमस्ते, कल मिलते हैं।', LEVELS.UNKNOWN],
])('context and conflict handling: %s', (message, level) => {
  const result = rules.analyze(message); expect(result.riskLevel).toBe(level);
  result.indicators.forEach(item => expect(message).toContain(item.evidence));
});
test.each(['low', 'low concern'])('normalizes explicit provider %s with valid empty findings', async riskLevel => {
  process.env.GEMMA_API_KEY = 'test'; process.env.GEMMA_API_URL = 'https://example.invalid';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ riskLevel, summary: 'Routine message.', indicators: [], recommendedActions: [], uncertainty: 'Not verified.' }) });
  expect((await service.analyze('Hi, see you at lunch tomorrow.')).riskLevel).toBe(LEVELS.LOW);
});
test('contradictory provider low classification is rejected, never green', async () => {
  process.env.GEMMA_API_KEY = 'test'; process.env.GEMMA_API_URL = 'https://example.invalid';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ riskLevel: 'low concern', summary: 'Routine.', indicators: [], recommendedActions: [], uncertainty: 'Not verified.' }) });
  await expect(service.analyze('Share your OTP.')).rejects.toMatchObject({ status: 503 });
});
test('provider low classification with warning findings is rejected', async () => {
  process.env.GEMMA_API_KEY = 'test'; process.env.GEMMA_API_URL = 'https://example.invalid';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ riskLevel: 'low concern', summary: 'Routine.', indicators: [{ type: 'Warning', evidence: 'Hi', explanation: 'A warning.' }], recommendedActions: [], uncertainty: 'Not verified.' }) });
  await expect(service.analyze('Hi, see you at lunch tomorrow.')).rejects.toMatchObject({ status: 503 });
});
