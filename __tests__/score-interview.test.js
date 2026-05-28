'use strict';

const { makeRes } = require('./helpers');

/**
 * Tests for api/score-interview.js
 * Interview Scorer — full report with resume cross-referencing
 */

const handler = require('../api/score-interview');


// Transcript with 50+ words to pass the insufficient guard
const LONG_TRANSCRIPT = `
I have been working as a software engineer for over five years.
During my time at TechCorp I built scalable microservices using Node.js and AWS Lambda.
One specific challenge was handling concurrent requests with Redis and optimising database queries.
I personally fixed a memory leak in our Express middleware that was causing 30% latency spikes.
The team had six engineers and we used Jira for sprint planning.
`.trim();

const VALID_BODY = {
  transcript: LONG_TRANSCRIPT,
  candidate_name: 'Jane Smith',
  role: 'Senior Engineer',
  tab_switches: 2,
  gaze_deviations: 3,
  duration_seconds: 1800,
  resume_text: 'Jane Smith — 5 years experience at TechCorp as Senior Engineer. Skills: Node.js, AWS, Redis.',
  trap_questions: ['Tell me about CloudNative Forge — do you use it?'],
  career_analysis: {
    total_companies: 2,
    average_tenure_months: 30,
    job_hopping_risk: 'low',
    job_hopping_summary: 'Stable career trajectory',
    career_gaps: [],
    overall_career_red_flags: []
  }
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

  test('PUT returns 405', async () => {
    const res = makeRes();
    await handler({ method: 'PUT', body: {} }, res);
    expect(res._status).toBe(405);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────
describe('input validation', () => {
  test('missing transcript returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: {} }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/too short/i);
  });

  test('transcript shorter than 20 chars returns 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { transcript: 'Too short' } }, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/too short/i);
  });
});

// ── Insufficient transcript guard ─────────────────────────────────────────────
describe('insufficient transcript guard', () => {
  const SHORT_TRANSCRIPT = 'I am a developer with some experience in things and stuff here';
  // 12 words — below the 50-word threshold

  test('transcript with <50 words returns re-interview recommendation', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, transcript: SHORT_TRANSCRIPT } }, res);
    expect(res._status).toBe(200);
    expect(res._body.recommendation).toBe('re-interview');
    expect(res._body.integrity_score).toBe(50);
  });

  test('[No speech was recorded] triggers re-interview', async () => {
    const longEnoughButNoSpeech = '[No speech was recorded] '.repeat(10);
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, transcript: longEnoughButNoSpeech } }, res);
    expect(res._status).toBe(200);
    expect(res._body.recommendation).toBe('re-interview');
  });
});

// ── Missing API key ───────────────────────────────────────────────────────────
describe('missing GROQ_API_KEY', () => {
  test('returns 500 when GROQ_API_KEY not set', async () => {
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

  test('returns 500 on Groq error response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Rate limit exceeded/i);
  });

  test('returns 500 when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
  });

  test('returns 500 when Groq returns non-JSON format', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'No valid JSON here' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(500);
    expect(res._body.detail).toMatch(/Unexpected AI response format/i);
  });
});

// ── Successful response ───────────────────────────────────────────────────────
describe('successful response', () => {
  const mockReport = {
    integrity_score: 78,
    risk_level: 'low',
    recommendation: 'proceed',
    recommendation_reason: 'Candidate demonstrates authentic knowledge with specific examples.',
    flags: [],
    notable_quotes: [],
    resume_vs_interview_summary: 'Claims consistent with resume.',
    tool_observations: {
      tools_on_resume_used_in_interview: ['Node.js', 'AWS'],
      tools_not_on_resume: [],
      tools_note: 'No tool depth concerns'
    },
    overall_assessment: 'Candidate appears authentic with genuine technical depth.'
  };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'gsk_test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockReport) } }]
      })
    });
  });

  afterEach(() => { delete process.env.GROQ_API_KEY; });

  test('returns 200 with integrity report', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.integrity_score).toBe(78);
    expect(res._body.recommendation).toBe('proceed');
  });

  test('works without optional fields', async () => {
    const res = makeRes();
    const minBody = { transcript: LONG_TRANSCRIPT };
    await handler({ method: 'POST', body: minBody }, res);
    expect(res._status).toBe(200);
  });

  test('extracts JSON wrapped in extra text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Here is your report:\n' + JSON.stringify(mockReport) + '\nAnalysis complete.' } }]
      })
    });
    const res = makeRes();
    await handler({ method: 'POST', body: VALID_BODY }, res);
    expect(res._status).toBe(200);
    expect(res._body.integrity_score).toBe(78);
  });

  test('truncates very long transcript (>2500 words)', async () => {
    const capturedBody = [];
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody.push(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(mockReport) } }] })
      });
    });
    const hugeTranscript = Array(3000).fill('word').join(' ');
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, transcript: hugeTranscript } }, res);
    expect(res._status).toBe(200);
    const userMsg = capturedBody[0].messages[1].content;
    expect(userMsg).toMatch(/\[transcript truncated\]/);
  });

  test('truncates very long resume (>800 words)', async () => {
    const capturedBody = [];
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody.push(JSON.parse(opts.body));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(mockReport) } }] })
      });
    });
    const hugeResume = Array(1000).fill('skill').join(' ');
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, resume_text: hugeResume } }, res);
    expect(res._status).toBe(200);
    const userMsg = capturedBody[0].messages[1].content;
    expect(userMsg).toMatch(/\[resume truncated\]/);
  });

  test('handles missing career_analysis gracefully', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, career_analysis: undefined } }, res);
    expect(res._status).toBe(200);
  });

  test('handles no trap_questions gracefully', async () => {
    const res = makeRes();
    await handler({ method: 'POST', body: { ...VALID_BODY, trap_questions: undefined } }, res);
    expect(res._status).toBe(200);
  });
});

// ── ALLOWED_ORIGIN ────────────────────────────────────────────────────────────
describe('ALLOWED_ORIGIN env var', () => {
  test('uses custom ALLOWED_ORIGIN', async () => {
    process.env.ALLOWED_ORIGIN = 'https://custom-app.example.com';
    const res = makeRes();
    await handler({ method: 'OPTIONS', body: {} }, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('https://custom-app.example.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});
