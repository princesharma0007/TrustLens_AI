const service = require('../services/analysisService');
const gemma = require('../services/gemmaService');
afterEach(() => jest.restoreAllMocks());
test('one canonical normalization handles Unicode spaces and OCR soft wraps', () => {
  expect(service.normalizeText('  Ｓhare your\nＯＴＰ\t now.\r\n\r\nHello. ')).toBe('Share your OTP now.\n\nHello.');
});
test('identical canonical text produces identical risk reports', async () => {
  const first = await service.analyze('Share your\nOTP now.');
  expect(await service.analyze('Share your OTP now.')).toEqual(first);
});
test('separated messages never combine employment and unrelated payment claims', async () => {
  const spy = jest.spyOn(gemma, 'analyze');
  const result = await service.analyze('College internship announcement tomorrow.\n\nPay a registration fee at the library desk.');
  expect(spy).toHaveBeenCalledTimes(2);
  expect(result.riskLevel).toBe('needs verification');
  expect(result.indicators.some(item => item.type === 'Advance-fee offer')).toBe(false);
});
test.each(require('./fixtures/security-evaluation.json'))('labelled evaluation: $id', async ({ message, expected }) => {
  expect((await service.analyze(message)).riskLevel).toBe(expected);
});
test.each(['कभी OTP साझा न करें।', 'अपना OTP किसी को न बताएं।'])('Hindi protective advice is not credential theft: %s', async message => {
  expect((await service.analyze(message)).riskLevel).not.toBe('high concern');
});
test('negative URL intelligence never reduces credential theft to green', async () => {
  const urls = require('../services/urlAnalysisService');
  jest.spyOn(urls, 'analyzeUrls').mockResolvedValue([{ url: 'https://retailer.com', status: 'no_known_threat', reputationStatus: 'no_known_threat', signals: [], provider: 'google-web-risk', reason: 'no_match' }]);
  expect((await service.analyze('Share your OTP at https://retailer.com')).riskLevel).toBe('high concern');
});
test('confirmed URL match raises high concern without claiming Gemma', async () => {
  const urls = require('../services/urlAnalysisService');
  jest.spyOn(urls, 'analyzeUrls').mockResolvedValue([{ url: 'https://retailer.com', status: 'known_malicious', reputationStatus: 'known_malicious', signals: [], provider: 'google-web-risk', reason: 'threat_match' }]);
  const result = await service.analyze('Hi, lunch tomorrow. Visit https://retailer.com');
  expect(result.riskLevel).toBe('high concern');
  expect(result.indicators.some(item => item.type === 'Threat-intelligence match')).toBe(true);
  expect(result.analysisMode).toBe('rule-based');
});
test('normalization preserves URL path identity and Unicode hostname evidence', () => {
  expect(service.normalizeText('Ｓhare https://example.com/ＡBC')).toBe('Share https://example.com/ＡBC');
});
