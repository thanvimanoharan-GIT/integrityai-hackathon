'use strict';

const { makeRes } = require('./helpers');

/**
 * Tests for api/generate-questions.js
 * Smart Question Engine — Groq / Llama 3.3
 */

const handler = require('../api/generate-questions');


// Valid resume text (long enough + contains resume signals)
const VALID_RESUME = `
John Doe — Software Engineer
Email: john@example.com | Phone: 555-1234
LinkedIn: linkedin.com/in/johndoe | GitHub: github.com/johndoe

SUMMARY
Experienced software engineer with 5 years of experience building scalable web applications.

EXPERIENCE
Senior Developer — TechCorp (2020–Present)
- Built and managed microservices using Node.js and AWS
- Led a team of 4 engineers; improved performance by 35%
- Managed CI/CD pipelines with Jenkins and Docker

Software Engineer — StartupXYZ (2018–2020)
- Developed React frontend and Express backend
- Designed PostgreSQL schemas and managed deployments

EDUCATION
Bachelor of Computer Science — University of Example (2018)

SKILLS
JavaScript, TypeScript, Node.js, React, AWS, Docker, Kubernetes, PostgreSQL, MongoDB
`.repeat(3); // repeat to make it long enough

// ── CORS / OPTIONS ──────────────────────────────────────────────────────────
describe('OPTIONS preflight', () => {
  test('returns 200', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._status).toBe(200);
  });

  test('sets CORS Allow-Origin header', async () => {
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBeDefined();
  });
});

// ── Method Not Allowed ──────────────────────────────────────────────────────
describe('unsupported method', () => {
  test('PUT returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'PUT', body: {} }, res);
    expect(res._status).toBe(405);
    expect(res._body.detail).toMatch(/Method not allowed/i);
  });

  test('DELETE returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', body: {} }, res);
    expect(res._status).toBe(405);
  });
});

// ── GET health check ────────────────────────────────────────────────────────
describe('GET health check', () => {
  test('returns version info', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Hello' } }] })
    });
    process.env.GROQ_API_KEY = 'test-key-12345';
    const res = makeRes();
    await handler({ method: 'GET', body: {}, query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._body.version).toBe('VERCEL-2');
    expect(res._body.key_set).toBe(true);
    delete process.env.GROQ_API_KEY;
  });

  test('GET with no API key shows key_set false', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('no key'));
    delete process.env.GROQ_API_KEY;
    const res = makeRes();
    await handler({ method: 'GET', body: {}, query: {} }, res);
    expect(res._status).toBe(200);
    expect(res._body.key_set).toBe(false);
  });
});

// ── POST input validation ───────────────────────────────────────────────────
describe('POST input validation', () => {
  test('missing resume_text returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/too short/i);
  });

  test('resume_text shorter than 80 chars returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: 'Short text' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/too short/i);
  });

  test('text long enough but no resume signals returns 400', async () => {
    const res = makeRes();
    const nonResume = 'A'.repeat(100); // 100 chars, no resume keywords
    await handler({ method: 'POST', body: { resume_text: nonResume } }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/doesn't appear to be a resume/i);
  });
});

// ── POST — missing API key ──────────────────────────────────────────────────
describe('POST missing GROQ_API_KEY', () => {
  test('returns 500 when GROQ_API_KEY not set', async () => {
    delete process.env.GROQ_API_KEY;
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/GROQ_API_KEY/i);
  });
});

// ── POST — Groq API error ───────────────────────────────────────────────────
describe('POST Groq API error', () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test123';
  });
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  test('returns 500 when Groq responds with error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Rate limit exceeded/i);
  });

  test('returns 500 when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Network error/i);
  });

  test('returns 500 when Groq returns non-JSON content', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'No JSON here at all' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Unexpected response format/i);
  });
});

// ── POST — successful response ──────────────────────────────────────────────
describe('POST successful response', () => {
  const mockResult = {
    candidate_name: 'John Doe',
    candidate_summary: 'Strong candidate.',
    risk_flags: [],
    questions: [
      { id: 1, category: 'technical', trap_type: null, difficulty: 'medium', question: 'Tell me about Node.js', why_it_matters: 'x', red_flags: 'y', follow_up: 'z' },
      { id: 2, category: 'technical', trap_type: 'fake_tool', difficulty: 'hard', question: 'Tell me about FakeTool', why_it_matters: 'x', red_flags: 'y', follow_up: 'z' }
    ],
    interviewer_tips: 'Watch for vague answers.',
    career_analysis: { total_companies: 2, average_tenure_months: 24, job_hopping_risk: 'low', project_continuity_risk: 'low', job_hopping_summary: 'Stable career', career_gaps: [], overall_career_red_flags: [] }
  };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test123';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResult) } }]
      })
    });
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
  });

  test('returns 200 with parsed questions', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(200);
    expect(res._body.candidate_name).toBe('John Doe');
    expect(Array.isArray(res._body.questions)).toBe(true);
  });

  test('normalises trap_type questions to category=trap', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    const trapQ = res._body.questions.find(q => q.trap_type === 'fake_tool');
    expect(trapQ.category).toBe('trap');
  });

  test('wraps JSON inside extra text (index/lastIndex extraction)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Here is the result: ' + JSON.stringify(mockResult) + '\nEnd.' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: { resume_text: VALID_RESUME } }, res);
    expect(res._status).toBe(200);
    expect(res._body.candidate_name).toBe('John Doe');
  });
});

// ── ALLOWED_ORIGIN ──────────────────────────────────────────────────────────
describe('ALLOWED_ORIGIN env var', () => {
  test('uses custom ALLOWED_ORIGIN', async () => {
    process.env.ALLOWED_ORIGIN = 'https://my-app.example.com';
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('https://my-app.example.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});
