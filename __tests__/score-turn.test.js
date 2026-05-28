'use strict';

const { makeRes } = require('./helpers');

/**
 * Tests for api/score-turn.js
 * Live Turn Scorer — scores a single candidate answer
 */

const handler = require('../api/score-turn');


const VALID_BODY = {
  answer_text: 'I used Redis for caching and Kubernetes for orchestration. The main challenge was managing rolling deployments without downtime.',
  turn_number: 3,
  latency_ms: 4500,
  longest_silence_ms: 2000,
  gaze_deviations: 1
};

// ── OPTIONS ──────────────────────────────────────────────────────────────────
describe('OPTIONS preflight', () => {
  test('returns 200', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._status).toBe(200);
  });

  test('sets CORS headers', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBeDefined();
    expect(res._headers['Access-Control-Allow-Methods']).toMatch(/POST/);
  });
});

// ── Method Not Allowed ────────────────────────────────────────────────────────
describe('unsupported method', () => {
  test('GET returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res._status).toBe(405);
    expect(res._body.detail).toMatch(/Method not allowed/i);
  });

  test('PATCH returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'PATCH', body: {} }, res);
    expect(res._status).toBe(405);
  });
});

// ── Short answer guard ────────────────────────────────────────────────────────
describe('short answer guard', () => {
  test('missing answer_text returns 200 with score 0', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(0);
    expect(res._body.flag).toBe('none');
  });

  test('answer_text with 4 chars returns 200 with score 0', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { answer_text: 'Hi!' } }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(0);
    expect(res._body.flag).toBe('none');
  });

  test('whitespace-only answer returns 200 with score 0', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { answer_text: '    ' } }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(0);
  });
});

// ── Missing API key ───────────────────────────────────────────────────────────
describe('missing GROQ_API_KEY', () => {
  test('returns 500', async () => {
    delete process.env.GROQ_API_KEY;
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/GROQ_API_KEY/i);
  });
});

// ── Groq API errors ───────────────────────────────────────────────────────────
describe('Groq API errors', () => {
  beforeEach(() => { process.env.GROQ_API_KEY = 'gsk_test'; });
  afterEach(() => { delete process.env.GROQ_API_KEY; });

  test('returns 500 when Groq responds with error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'Service unavailable' } })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Service unavailable/i);
  });

  test('returns 500 when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/connection refused/i);
  });

  test('returns fallback when JSON parse fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Cannot parse this as JSON' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(30);
    expect(res._body.flag).toBe('none');
  });
});

// ── Successful response ───────────────────────────────────────────────────────
describe('successful response', () => {
  const mockScore = {
    suspicion_score: 42,
    flag: 'no_specifics',
    note: 'Answer lacks specific error messages or verifiable details.'
  };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockScore) } }]
      })
    });
  });

  afterEach(() => { delete process.env.GROQ_API_KEY; });

  test('returns 200 with suspicion score', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(42);
    expect(res._body.flag).toBe('no_specifics');
  });

  test('works with only answer_text (no timing/gaze)', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { answer_text: VALID_BODY.answer_text } }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(42);
  });

  test('includes timing context when latency and silence provided', async () => {
    const capturedBody = [];
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody.push(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(mockScore) } }] })
      });
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    const userMsg = capturedBody[0].messages[1].content;
    expect(userMsg).toMatch(/TIMING DATA/);
  });

  test('includes gaze context when gaze_deviations > 0', async () => {
    const capturedBody = [];
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody.push(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(mockScore) } }] })
      });
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, gaze_deviations: 5 } }, res);
    const userMsg = capturedBody[0].messages[1].content;
    expect(userMsg).toMatch(/GAZE DATA/);
  });

  test('no gaze context when gaze_deviations is 0', async () => {
    const capturedBody = [];
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody.push(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(mockScore) } }] })
      });
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, gaze_deviations: 0 } }, res);
    const userMsg = capturedBody[0].messages[1].content;
    expect(userMsg).not.toMatch(/GAZE DATA/);
  });

  test('extracts JSON wrapped in extra text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Score result: ' + JSON.stringify(mockScore) } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.suspicion_score).toBe(42);
  });
});

// ── ALLOWED_ORIGIN ────────────────────────────────────────────────────────────
describe('ALLOWED_ORIGIN env var', () => {
  test('uses custom ALLOWED_ORIGIN', async () => {
    process.env.ALLOWED_ORIGIN = 'https://my-custom.example.com';
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('https://my-custom.example.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});
