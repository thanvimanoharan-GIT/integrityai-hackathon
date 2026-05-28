'use strict';

/**
 * Shared test utilities for IntegrityAI API tests
 */

/**
 * Creates a mock Express-style response object.
 * All test files import this instead of defining their own copy.
 */
function makeRes() {
  return {
    _status: null,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    end()        { return this; },
    json(body)   { this._body = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
}

module.exports = { makeRes };
