/**
 * cppFetchLogic.test.js — Tests for cppFetch error handling and timeout logic.
 *
 * Covers the cppFetch function in server/index.js:
 * - Timeout handling (AbortError)
 * - Connection error handling (ECONNREFUSED, ECONNRESET)
 * - Non-OK response handling
 * - JSON body serialization for POST requests
 * - Default headers
 *
 * Extracted logic — no server or C++ engine required.
 */

import assert from 'node:assert/strict';

// ── Extracted: cppFetch response/error classification ──────────────────────

/**
 * Classifies a cppFetch error into a user-facing error message.
 * Mirrors the catch block in server/index.js cppFetch.
 */
function classifyCppFetchError(err, timeoutMs, method, path) {
  if (err.name === 'AbortError') {
    return {
      type: 'timeout',
      message: `C++ engine timeout (${timeoutMs}ms) — engine may be crashed`,
    };
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
    return {
      type: 'connection',
      message: `C++ engine unreachable — ${err.code}`,
    };
  }
  return {
    type: 'unknown',
    message: err.message || 'Unknown error',
  };
}

/**
 * Builds the request options for cppFetch.
 * Mirrors the fetch call in server/index.js cppFetch.
 */
function buildCppFetchOptions(method, body) {
  const opts = {
    headers: { 'Content-Type': 'application/json' },
  };
  if (method) opts.method = method;
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  return opts;
}

/**
 * Checks if a response status is OK (200-299).
 */
function isResponseOk(status) {
  return status >= 200 && status < 300;
}

/**
 * Formats an error log message for non-OK responses.
 * Mirrors: `[cppFetch] ${method} ${path} → ${status}`
 * (response body is no longer logged to prevent leaking internal details)
 */
function formatErrorLog(method, path, status) {
  const m = method || 'GET';
  return `[cppFetch] ${m} ${path} → ${status}`;
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runCppFetchLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Error classification
  // ═══════════════════════════════════════════════════════════════════════

  test('AbortError → timeout type', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const result = classifyCppFetchError(err, 5000, 'GET', '/api/game/state');
    assert.equal(result.type, 'timeout');
    assert.ok(result.message.includes('5000ms'));
    assert.ok(result.message.includes('crashed'));
  });

  test('AbortError with custom timeout', () => {
    const err = new Error();
    err.name = 'AbortError';
    const result = classifyCppFetchError(err, 10000, 'POST', '/api/move');
    assert.equal(result.type, 'timeout');
    assert.ok(result.message.includes('10000ms'));
  });

  test('ECONNREFUSED → connection type', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8080');
    err.code = 'ECONNREFUSED';
    const result = classifyCppFetchError(err, 5000, 'GET', '/api/legal-moves');
    assert.equal(result.type, 'connection');
    assert.ok(result.message.includes('ECONNREFUSED'));
    assert.ok(result.message.includes('unreachable'));
  });

  test('ECONNRESET → connection type', () => {
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    const result = classifyCppFetchError(err, 5000, 'POST', '/api/move');
    assert.equal(result.type, 'connection');
    assert.ok(result.message.includes('ECONNRESET'));
  });

  test('unknown error → unknown type with original message', () => {
    const err = new Error('Something unexpected');
    const result = classifyCppFetchError(err, 5000, 'GET', '/test');
    assert.equal(result.type, 'unknown');
    assert.equal(result.message, 'Something unexpected');
  });

  test('error without message → unknown type', () => {
    const err = new Error();
    err.message = '';
    const result = classifyCppFetchError(err, 5000, 'GET', '/test');
    assert.equal(result.type, 'unknown');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Request options building
  // ═══════════════════════════════════════════════════════════════════════

  test('GET request has Content-Type header', () => {
    const opts = buildCppFetchOptions();
    assert.equal(opts.headers['Content-Type'], 'application/json');
    assert.equal(opts.method, undefined);
    assert.equal(opts.body, undefined);
  });

  test('POST with object body → JSON string', () => {
    const opts = buildCppFetchOptions('POST', { from: [2, 1], to: [3, 0] });
    assert.equal(opts.method, 'POST');
    assert.equal(typeof opts.body, 'string');
    assert.deepEqual(JSON.parse(opts.body), { from: [2, 1], to: [3, 0] });
  });

  test('POST with empty object body', () => {
    const opts = buildCppFetchOptions('POST', {});
    assert.equal(opts.method, 'POST');
    assert.equal(opts.body, '{}');
  });

  test('POST with string body stays string', () => {
    const opts = buildCppFetchOptions('POST', '{"already":"string"}');
    assert.equal(opts.body, '{"already":"string"}');
  });

  test('method without body → no body property', () => {
    const opts = buildCppFetchOptions('GET');
    assert.equal(opts.method, 'GET');
    assert.equal(opts.body, undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Response status check
  // ═══════════════════════════════════════════════════════════════════════

  test('status 200 → ok', () => {
    assert.equal(isResponseOk(200), true);
  });

  test('status 201 → ok', () => {
    assert.equal(isResponseOk(201), true);
  });

  test('status 204 → ok', () => {
    assert.equal(isResponseOk(204), true);
  });

  test('status 299 → ok', () => {
    assert.equal(isResponseOk(299), true);
  });

  test('status 400 → not ok', () => {
    assert.equal(isResponseOk(400), false);
  });

  test('status 404 → not ok', () => {
    assert.equal(isResponseOk(404), false);
  });

  test('status 500 → not ok', () => {
    assert.equal(isResponseOk(500), false);
  });

  test('status 503 → not ok', () => {
    assert.equal(isResponseOk(503), false);
  });

  test('status 199 → not ok', () => {
    assert.equal(isResponseOk(199), false);
  });

  test('status 300 → not ok', () => {
    assert.equal(isResponseOk(300), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error log formatting
  // ═══════════════════════════════════════════════════════════════════════

  test('error log does NOT include body (sanitized)', () => {
    const log = formatErrorLog('POST', '/api/move', 500, 'Internal Server Error');
    assert.equal(log, '[cppFetch] POST /api/move → 500');
  });

  test('error log without body', () => {
    const log = formatErrorLog('GET', '/api/game/state', 404, '');
    assert.equal(log, '[cppFetch] GET /api/game/state → 404');
  });

  test('error log with null method defaults to GET', () => {
    const log = formatErrorLog(null, '/api/test', 503, 'Service Unavailable');
    assert.equal(log, '[cppFetch] GET /api/test → 503');
  });

  test('error log never includes body regardless of length', () => {
    const longBody = 'x'.repeat(500);
    const log = formatErrorLog('POST', '/api/move', 500, longBody);
    assert.ok(!log.includes('x'), 'log should not contain any body content');
    assert.equal(log, '[cppFetch] POST /api/move → 500');
  });

  test('error log with short body → still excluded', () => {
    const body = 'x'.repeat(200);
    const log = formatErrorLog('POST', '/api/test', 500, body);
    assert.ok(!log.includes('x'), 'log should not contain body content');
  });

  test('error log with 201 char body → excluded', () => {
    const body = 'x'.repeat(201);
    const log = formatErrorLog('POST', '/api/test', 500, body);
    assert.equal(log, '[cppFetch] POST /api/test → 500');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 cppFetch Logic Tests');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
