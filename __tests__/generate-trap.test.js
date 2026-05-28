'use strict';

const { makeRes } = require('./helpers');

/**
 * Tests for api/generate-trap.js
 * Dynamic Trap Question Generator
 */

const handler = require('../api/generate-trap');


const VALID_BODY = {
  last_answers: [
    'I built a scalable microservices architecture using Node.js and Kubernetes.',
    'My approach to performance optimization involves profiling, caching, and async processing.'
  ],
  role: 'Senior Engineer',
  resume_snippet: '5 years at TechCorp building distributed systems',
  suspicion_notes: 'Uniformly polished answers, no specific error details'
};

// ── OPTIONS ─────────────────────────────────────────────────────────────────
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

// ── Method Not Allowed ──────────────────────────────────────────────────────
describe('unsupported method', () => {
  test('GET returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'GET', body: {} }, res);
    expect(res._status).toBe(405);
    expect(res._body.detail).toMatch(/Method not allowed/i);
  });

  test('DELETE returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', body: {} }, res);
    expect(res._status).toBe(405);
  });
});

// ── Input validation ─────────────────────────────────────────────────────────
describe('input validation', () => {
  test('missing last_answers returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/last_answers required/i);
  });

  test('empty last_answers array returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { last_answers: [] } }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/last_answers required/i);
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

// ── Groq API error ────────────────────────────────────────────────────────────
describe('Groq API errors', () => {
  beforeEach(() => { process.env.GROQ_API_KEY = 'gsk_test'; });
  afterEach(() => { delete process.env.GROQ_API_KEY; });

  test('returns 500 on Groq error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Model overloaded' } })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Model overloaded/i);
  });

  test('returns 500 when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/timeout/i);
  });

  test('returns fallback question when JSON parse fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Not valid JSON at all!' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.question).toBeDefined();
    expect(res._body.trap_type).toBe('specificity');
  });
});

// ── Successful response ───────────────────────────────────────────────────────
describe('successful response', () => {
  const mockTrap = {
    question: "What was the exact Kubernetes error you got when scaling failed?",
    trap_type: "specificity",
    target: "Checks if candidate has real hands-on experience"
  };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockTrap) } }]
      })
    });
  });

  afterEach(() => { delete process.env.GROQ_API_KEY; });

  test('returns 200 with trap question', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.question).toBeDefined();
    expect(res._body.trap_type).toBe('specificity');
  });

  test('uses default role when not provided', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { last_answers: VALID_BODY.last_answers } }, res);
    expect(res._status).toBe(200);
  });

  test('uses default resume_snippet when not provided', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { last_answers: VALID_BODY.last_answers, role: 'Engineer' } }, res);
    expect(res._status).toBe(200);
  });

  test('extracts JSON wrapped in extra text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Here is the trap:\n' + JSON.stringify(mockTrap) + '\n---' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.question).toBeDefined();
  });
});

// ── ALLOWED_ORIGIN ────────────────────────────────────────────────────────────
describe('ALLOWED_ORIGIN env var', () => {
  test('uses custom ALLOWED_ORIGIN when set', async () => {
    process.env.ALLOWED_ORIGIN = 'https://custom.test.com';
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('https://custom.test.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});
