// tests/api.test.js
const request = require('supertest');
const app = require('../server');
const originalFetch = global.fetch;
const providerKeys = ['GEMMA_API_KEY', 'GEMMA_API_URL', 'GEMMA_FALLBACK_ENABLED'];
const originalEnv = Object.fromEntries(providerKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  providerKeys.forEach(key => { delete process.env[key]; });
  app.locals.textRateLimitStore.resetAll();
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of providerKeys) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  jest.restoreAllMocks();
});

describe('POST /api/analyze', () => {
  // Restore spies and mocks after each test
  afterEach(() => jest.restoreAllMocks());

  // ---- Successful rule‑based analysis ----
  test('successful analysis returns expected shape', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({
        message: 'Your account will be blocked in 30 minutes. Verify now!'
      })
      .expect('Content-Type', /json/)
      .expect(200);

    const a = res.body;
    expect(Object.keys(a).sort()).toEqual([
      'riskLevel', 'summary', 'indicators', 'recommendedActions', 'uncertainty', 'analysisMode'
    ].sort());
    expect(['low concern', 'high concern', 'needs verification', 'unclear']).toContain(a.riskLevel);
    expect(a.summary).toEqual(expect.any(String));
    expect(a.indicators.length).toBeGreaterThan(0);
    a.indicators.forEach(indicator => {
      expect(indicator).toEqual({
        type: expect.any(String), evidence: expect.any(String), explanation: expect.any(String)
      });
    });
    expect(Array.isArray(a.recommendedActions)).toBe(true);
    expect(a.analysisMode).toBe('rule-based');
    expect(a.uncertainty).toContain('not Gemma AI');
  });

  // ---- Validation / error cases ----
  test('missing message yields 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({})
      .expect('Content-Type', /json/)
      .expect(400);

    expect(res.body).toMatchObject({
      success: false,
      error: 'Invalid request payload'
    });
  });

  test('empty message yields 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ message: '' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  test('whitespace-only message yields 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ message: '   ' })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid request payload');
  });

  test('non-string message yields 400', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({ message: 123 })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  test('oversized message yields 400', async () => {
    const long = 'a'.repeat(5001);

    const res = await request(app)
      .post('/api/analyze')
      .send({ message: long })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  test('malformed JSON yields 400 with safe response', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/analyze')
      .set('Content-Type', 'application/json')
      .send('{"message":"test"')
      .expect(400);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid JSON payload'
    });
    expect(JSON.stringify(res.body)).not.toContain('SyntaxError');
    expect(JSON.stringify(res.body)).not.toContain('stack');
    expect(log).not.toHaveBeenCalled();
  });

  test('service error returns 500 with safe message', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest
      .spyOn(require('../services/gemmaService'), 'analyze')
      .mockImplementation(() => {
        throw new Error('Service failure');
      });

    const res = await request(app)
      .post('/api/analyze')
      .send({ message: 'Please analyze this message' })
      .expect('Content-Type', /json/)
      .expect(500);
    expect(res.body).toEqual({
      success: false,
      error: 'Internal server error'
    });
    const responseText = JSON.stringify(res.body);
    expect(responseText).not.toContain('Service failure');
    expect(responseText).not.toContain('Error:');
    expect(responseText).not.toContain('stack');
    expect(log).toHaveBeenCalledWith('Analysis request failed.');
  });
});


describe('Homepage integration', () => {
  test('renders the EJS homepage and partials', async () => {
    const res = await request(app).get('/').expect('Content-Type', /html/).expect(200);
    expect(res.text).toContain('Think Before');
    expect(res.text).toContain('id="analyzer-form"');
    expect(res.text).toContain('aria-label="Main navigation"');
    expect(res.text).toContain('site-footer');
    expect(res.text).not.toContain('<%');
  });

  test.each(['/css/style.css', '/js/main.js'])('serves %s', async asset => {
    await request(app).get(asset).expect(200);
  });

  test.each(['a'.repeat(5000), 'अ'.repeat(5000), '\u0001'.repeat(5000)])(
    'accepts a 5,000-character message within the JSON size limit', async message => {
      const res = await request(app).post('/api/analyze').send({ message }).expect(200);
      expect(res.body.analysisMode).toBe('rule-based');
    }
  );

  test('trims messages before passing them to the service', async () => {
    const service = require('../services/gemmaService');
    const spy = jest.spyOn(service, 'analyze');
    try {
      await request(app).post('/api/analyze').send({ message: '  hello  ' }).expect(200);
      expect(spy).toHaveBeenCalledWith('hello');
    } finally { spy.mockRestore(); }
  });

  test('missing JSON body returns a validation error', async () => {
    await request(app).post('/api/analyze').expect(400);
  });

  test('oversized JSON returns 413 without logging private text', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await request(app).post('/api/analyze').send({ message: 'x'.repeat(70000) }).expect(413);
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  // ---- Gemma 4 integration (mocked) ----
  test('real Gemma inference path returns gemma-4 analysisMode', async () => {
    process.env.GEMMA_API_KEY = 'test-key';
    process.env.GEMMA_API_URL = 'https://example.com/gemma';

    const gemmaResponse = {
      riskLevel: 'high',
      riskScore: 85,
      summary: 'Mocked Gemma summary',
      indicators: [{ title: 'OTP request', evidence: 'OTP', explanation: 'Requests authentication information.' }],
      recommendedActions: ['action1'],
      uncertainty: 15
    };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => gemmaResponse
    });
    global.fetch = mockFetch;

    const res = await request(app)
      .post('/api/analyze')
      .send({ message: 'Please share your OTP.' })
      .expect('Content-Type', /json/)
      .expect(200);

    const a = res.body;
    expect(a.analysisMode).toBe('gemma-4');
    expect(a.riskLevel).toBe('high concern');
    expect(typeof a.uncertainty).toBe('string');
    expect(a.indicators[0].type).toBe('OTP request');

    delete process.env.GEMMA_API_KEY;
    delete process.env.GEMMA_API_URL;
  });

  test('explicitly enabled Gemma fallback on error returns rule-based', async () => {
    process.env.GEMMA_FALLBACK_ENABLED = 'true';
    process.env.GEMMA_API_KEY = 'test-key';
    process.env.GEMMA_API_URL = 'https://example.com/gemma';

    const mockFetch = jest.fn().mockRejectedValue(new Error('network error'));
    global.fetch = mockFetch;

    const res = await request(app)
      .post('/api/analyze')
      .send({ message: 'fallback test' })
      .expect('Content-Type', /json/)
      .expect(200);

    const a = res.body;
    expect(a.analysisMode).toBe('rule-based');
    expect(a.uncertainty).toContain('explicitly enabled rule-based fallback');

    delete process.env.GEMMA_API_KEY;
    delete process.env.GEMMA_API_URL;
  });
});

  // ---- Rate limiter test ----
  test('rate limiting returns 429 after 10 requests per minute', async () => {
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/analyze')
        .send({ message: 'test message' });
      if (i < 10) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(429);
        expect(res.body).toMatchObject({ success: false, error: 'Too many requests' });
      }
    }
  });
