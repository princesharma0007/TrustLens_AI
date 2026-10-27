
const request = require('supertest');
const app = require('../src/server');

describe('POST /api/analyze', () => {
  // Restore spies and mocks after each test
  afterEach(() => jest.restoreAllMocks());

  test('successful analysis returns expected shape', async () => {
    const res = await request(app)
      .post('/api/analyze')
      .send({
        message: 'Your account will be blocked in 30 minutes. Verify now!'
      })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('analysis');

    const a = res.body.analysis;

    expect(a).toHaveProperty('riskLevel');
    expect(a).toHaveProperty('riskScore');
    expect(a).toHaveProperty('summary');
    expect(a).toHaveProperty('indicators');
    expect(Array.isArray(a.indicators)).toBe(true);
    expect(a).toHaveProperty('recommendedActions');
    expect(a).toHaveProperty('model');
    expect(a).toHaveProperty('disclaimer');
  });

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
    const long = 'a'.repeat(2001);

    const res = await request(app)
      .post('/api/analyze')
      .send({ message: long })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  test('malformed JSON yields 400 with safe response', async () => {
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
  });

  test('service error returns 500 with safe message', async () => {
    jest
      .spyOn(require('../src/services/gemmaService'), 'analyze')
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
  });
});
