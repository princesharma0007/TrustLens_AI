const request = require('supertest');
const app = require('../server');
const service = require('../services/gemmaService');
const originalFetch = global.fetch;
const keys = ['GEMMA_API_KEY', 'GEMMA_API_URL', 'GEMMA_FALLBACK_ENABLED'];
const initialEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const sample = 'A/c X5559 debited INR 100.00 Dt 27-10-26 11:33:32 to MAST POINT thru UPI:871752530660. Bal INR 846.53 Not u? Fwd this SMS to 9264092640 to block UPI.-PNB';
beforeEach(() => {
  keys.forEach(key => { delete process.env[key]; });
  app.locals.textRateLimitStore?.resetAll();
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of keys) {
    if (initialEnv[key] === undefined) delete process.env[key]; else process.env[key] = initialEnv[key];
  }
  jest.restoreAllMocks();
  jest.useRealTimers();
});
function configured() {
  process.env.GEMMA_API_KEY = 'test-key';
  process.env.GEMMA_API_URL = 'https://example.invalid/analysis';
}
const canonical = {
  riskLevel: 'high concern', summary: 'Potential warning signs detected.',
  indicators: [{ type: 'OTP request', evidence: 'OTP', explanation: 'Requests authentication information.' }],
  recommendedActions: ['Do not share your OTP.'], uncertainty: 'Sender identity is unverified.',
};
test('banking SMS returns the agreed typed contract and contextual verification guidance', async () => {
  const res = await request(app).post('/api/analyze').send({ message: sample }).expect(200);
  expect(res.body).toEqual({
    riskLevel: 'needs verification', summary: expect.stringContaining('transaction alert'),
    indicators: expect.any(Array), recommendedActions: expect.any(Array),
    uncertainty: expect.any(String), analysisMode: 'rule-based',
  });
  expect(res.body.summary).toContain('not proof of fraud');
  expect(res.body.indicators).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'Verification instruction' })]));
  for (const indicator of res.body.indicators) expect(sample).toContain(indicator.evidence);
  expect(res.body.recommendedActions.join(' ')).toContain('official app');
});
test('verification handling generalizes to another transaction message', async () => {
  const input = 'Your account was credited USD 20. Contact the bank to report unrecognized activity.';
  const result = await service.analyze(input);
  expect(result.riskLevel).toBe('low concern');
  expect(result.indicators).toEqual([]);
});
test('ordinary Unicode text produces valid empty indicators', async () => {
  const res = await request(app).post('/api/analyze').send({ message: 'नमस्ते, कल मिलते हैं।' }).expect(200);
  expect(res.body.indicators).toEqual([]);
  expect(typeof res.body.uncertainty).toBe('string');
});
test.each(['direct', 'data', 'analysis'])('normalizes a valid %s Gemma adapter response', async wrapper => {
  configured();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => wrapper === 'direct' ? canonical : { [wrapper]: canonical } });
  const result = await service.analyze('Please share your OTP.');
  expect(result).toEqual({ ...canonical, analysisMode: 'gemma-4' });
});
test('normalizes legacy names/types without inventing warning findings', async () => {
  configured();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...canonical, riskLevel: 'high', indicators: [{ title: 'OTP request', evidence: 'OTP', explanation: 'Requests authentication information.' }], uncertainty: 15, riskScore: 85 }) });
  const result = await service.analyze('Please share your OTP.');
  expect(result.riskLevel).toBe('high concern');
  expect(result.indicators[0].type).toBe('OTP request');
  expect(typeof result.uncertainty).toBe('string');
  expect(result).not.toHaveProperty('riskScore');
});
test.each([{}, { ...canonical, uncertainty: null }, { ...canonical, indicators: [{ type: 'OTP', evidence: 'not in the message', explanation: 'Invalid evidence' }] }])('rejects incomplete or unsupported AI findings', async payload => {
  configured();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload });
  await expect(service.analyze('Please share your OTP.')).rejects.toMatchObject({ status: 503 });
});
test('configured AI failure is a safe error unless fallback is explicitly enabled', async () => {
  configured();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn().mockRejectedValue(new Error('PRIVATE provider detail'));
  const res = await request(app).post('/api/analyze').send({ message: 'Please share your OTP.' }).expect(503);
  expect(res.body.error).toBe('Configured AI analysis is unavailable. Please try again.');
  expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  expect(log).toHaveBeenCalledWith('Analysis request failed.');
});
test('provider timeout covers reading the response body and clears its timer', async () => {
  jest.useFakeTimers();configured();
  global.fetch = jest.fn().mockImplementation(async (url, options) => ({ ok: true, json: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')))) }));
  const promise = service.analyze('Please share your OTP.');
  const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
  await Promise.resolve();
  jest.advanceTimersByTime(5000);
  await assertion;
  expect(jest.getTimerCount()).toBe(0);
});
