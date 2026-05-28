'use strict';

const { makeRes } = require('./helpers');

/**
 * Tests for api/signal.js
 * Session Signal Bus — consent, gaze, tab-switch, transcript relay
 */

// We need to reload the module for each test suite to get a fresh sessions Map
let handler;

function makeReqRes(method, body = {}, query = {}) {
  const headers = {};
  const res = {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    end() { return this; },
    json(body) { this._body = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  const req = { method, body, query };
  return { req, res };
}

beforeEach(() => {
  // Re-require to get a fresh in-memory sessions Map each time
  jest.resetModules();
  handler = require('../api/signal');
});

// ── CORS / OPTIONS ──────────────────────────────────────────────────────────
describe('OPTIONS preflight', () => {
  test('returns 200 with no body', async () => {
    const { req, res } = makeReqRes('OPTIONS', {}, {});
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  test('sets CORS headers', async () => {
    const { req, res } = makeReqRes('OPTIONS', {}, {});
    await handler(req, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBeDefined();
    expect(res._headers['Access-Control-Allow-Methods']).toMatch(/POST/);
  });
});

// ── Method Not Allowed ──────────────────────────────────────────────────────
describe('unsupported method', () => {
  // signal.js checks session before method — must provide session to reach 405
  test('PUT with session returns 405', async () => {
    const { req, res } = makeReqRes('PUT', {}, { session: 'sess-put' });
    await handler(req, res);
    expect(res._status).toBe(405);
    expect(res._body.detail).toMatch(/Method not allowed/i);
  });

  test('DELETE with session returns 405', async () => {
    const { req, res } = makeReqRes('DELETE', {}, { session: 'sess-del' });
    await handler(req, res);
    expect(res._status).toBe(405);
  });
});

// ── Missing session ─────────────────────────────────────────────────────────
describe('missing session parameter', () => {
  test('POST without session returns 400', async () => {
    const { req, res } = makeReqRes('POST', { type: 'consent_given' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/session required/i);
  });

  test('GET without session returns 400', async () => {
    const { req, res } = makeReqRes('GET', {}, {});
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(res._body.detail).toMatch(/session required/i);
  });
});

// ── POST — generic flag type ────────────────────────────────────────────────
describe('POST generic flag', () => {
  test('stores a generic flag and returns ok', async () => {
    const { req, res } = makeReqRes('POST', { session: 'sess1', type: 'tab_switch' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });
});

// ── POST — transcript_chunk ─────────────────────────────────────────────────
describe('POST transcript_chunk', () => {
  test('stores a chunk and returns ok', async () => {
    const { req, res } = makeReqRes('POST', {
      session: 'sess2',
      type: 'transcript_chunk',
      text: 'Hello world answer here'
    });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  test('ignores whitespace-only chunk', async () => {
    const { req, res } = makeReqRes('POST', {
      session: 'sess3',
      type: 'transcript_chunk',
      text: '   '
    });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });
});

// ── POST — transcript_snapshot ──────────────────────────────────────────────
describe('POST transcript_snapshot', () => {
  test('stores snapshot fields', async () => {
    const { req, res } = makeReqRes('POST', {
      session: 'sess4',
      type: 'transcript_snapshot',
      text: 'Full transcript so far',
      gaze_count: 3,
      longest_silence_ms: 4500
    });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  test('snapshot without gaze/silence uses defaults', async () => {
    const { req, res } = makeReqRes('POST', {
      session: 'sess5',
      type: 'transcript_snapshot',
      text: 'Partial transcript'
    });
    await handler(req, res);
    expect(res._status).toBe(200);
  });

  test('piggybacked consent_given is stored', async () => {
    jest.resetModules();
    handler = require('../api/signal');
    const sid = 'sess6';

    // POST snapshot with consent piggybacked
    const { req: req1, res: res1 } = makeReqRes('POST', {
      session: sid,
      type: 'transcript_snapshot',
      text: 'Some text',
      consent_given: true
    });
    await handler(req1, res1);

    // GET and verify consent_given is present
    const { req: req2, res: res2 } = makeReqRes('GET', {}, { session: sid });
    await handler(req2, res2);
    expect(res2._status).toBe(200);
    expect(res2._body.consent_given).toBe(true);
  });
});

// ── GET — returns data with cursor ──────────────────────────────────────────
describe('GET session data', () => {
  test('returns empty session for unknown session id', async () => {
    const { req, res } = makeReqRes('GET', {}, { session: 'nonexistent' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._body.transcript_snapshot).toBe('');
    expect(res._body.transcript_chunks).toEqual([]);
    expect(res._body.next_cursor).toBe(0);
  });

  test('returns stored chunks with cursor pagination', async () => {
    jest.resetModules();
    handler = require('../api/signal');
    const sid = 'sess7';

    // Post 3 chunks
    for (let i = 0; i < 3; i++) {
      const { req, res } = makeReqRes('POST', {
        session: sid, type: 'transcript_chunk', text: `chunk ${i}`
      });
      await handler(req, res);
    }

    // GET all
    const { req: gReq, res: gRes } = makeReqRes('GET', {}, { session: sid, cursor: '0' });
    await handler(gReq, gRes);
    expect(gRes._status).toBe(200);
    expect(gRes._body.transcript_chunks).toHaveLength(3);
    expect(gRes._body.next_cursor).toBe(3);
  });

  test('cursor skips already-seen chunks', async () => {
    jest.resetModules();
    handler = require('../api/signal');
    const sid = 'sess8';

    for (let i = 0; i < 4; i++) {
      const { req, res } = makeReqRes('POST', {
        session: sid, type: 'transcript_chunk', text: `msg ${i}`
      });
      await handler(req, res);
    }

    // Get from cursor=2 — should return only 2 new chunks
    const { req: gReq, res: gRes } = makeReqRes('GET', {}, { session: sid, cursor: '2' });
    await handler(gReq, gRes);
    expect(gRes._body.transcript_chunks).toHaveLength(2);
    expect(gRes._body.next_cursor).toBe(4);
  });

  test('returns snapshot fields in GET response', async () => {
    jest.resetModules();
    handler = require('../api/signal');
    const sid = 'sess9';

    await handler(makeReqRes('POST', {
      session: sid,
      type: 'transcript_snapshot',
      text: 'This is the full transcript',
      gaze_count: 5,
      longest_silence_ms: 8000
    }).req, makeReqRes('POST', {}).res);

    const { req, res } = makeReqRes('GET', {}, { session: sid });
    await handler(req, res);
    expect(res._body.transcript_snapshot).toBe('This is the full transcript');
    expect(res._body.snapshot_gaze).toBe(5);
    expect(res._body.snapshot_silence_ms).toBe(8000);
  });

  test('chunks cap at 500 entries', async () => {
    jest.resetModules();
    handler = require('../api/signal');
    const sid = 'sess10';

    for (let i = 0; i < 502; i++) {
      const { req, res } = makeReqRes('POST', {
        session: sid, type: 'transcript_chunk', text: `chunk ${i}`
      });
      await handler(req, res);
    }

    const { req, res } = makeReqRes('GET', {}, { session: sid, cursor: '0' });
    await handler(req, res);
    // Cap is 500
    expect(res._body.transcript_chunks.length).toBeLessThanOrEqual(500);
  });
});

// ── ALLOWED_ORIGIN env var ──────────────────────────────────────────────────
describe('ALLOWED_ORIGIN env var', () => {
  test('uses custom ALLOWED_ORIGIN when set', async () => {
    process.env.ALLOWED_ORIGIN = 'https://custom-origin.example.com';
    jest.resetModules();
    handler = require('../api/signal');
    const { req, res } = makeReqRes('OPTIONS', {}, {});
    await handler(req, res);
    expect(res._headers['Access-Control-Allow-Origin']).toBe('https://custom-origin.example.com');
    delete process.env.ALLOWED_ORIGIN;
  });
});
