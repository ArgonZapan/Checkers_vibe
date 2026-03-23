/**
 * proxyLogic.test.js — Tests for proxy body serialization and error handling logic.
 *
 * The filter function is already tested in wsHandlerLogic.test.js.
 * This covers the remaining proxy.js logic:
 * - proxyReq body re-serialization for POST/PUT/PATCH
 * - Error handler response formatting
 * - GET request log suppression
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: proxy body serialization logic ───────────────────────────────

/**
 * Determines if a request method should have its body re-serialized.
 * Mirrors proxy.js: const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
 */
function methodHasBody(method) {
  return ['POST', 'PUT', 'PATCH'].includes(method);
}

/**
 * Determines if a GET request should be logged.
 * Mirrors proxy.js: if (req.method !== 'GET') { console.log(...) }
 */
function shouldLogRequest(method) {
  return method !== 'GET';
}

/**
 * Formats the error response body.
 * Mirrors proxy.js error handler: { error: 'C++ backend unavailable' }
 */
function formatProxyError() {
  return { error: 'C++ backend unavailable' };
}

/**
 * Serializes body data for proxy forwarding.
 * Mirrors proxy.js: const bodyData = JSON.stringify(req.body);
 */
function serializeBody(body) {
  if (!body) return null;
  return JSON.stringify(body);
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runProxyLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── methodHasBody ─────────────────────────────────────────────────────

  test('methodHasBody: POST → true', () => {
    assert.equal(methodHasBody('POST'), true);
  });

  test('methodHasBody: PUT → true', () => {
    assert.equal(methodHasBody('PUT'), true);
  });

  test('methodHasBody: PATCH → true', () => {
    assert.equal(methodHasBody('PATCH'), true);
  });

  test('methodHasBody: GET → false', () => {
    assert.equal(methodHasBody('GET'), false);
  });

  test('methodHasBody: DELETE → false', () => {
    assert.equal(methodHasBody('DELETE'), false);
  });

  test('methodHasBody: HEAD → false', () => {
    assert.equal(methodHasBody('HEAD'), false);
  });

  test('methodHasBody: OPTIONS → false', () => {
    assert.equal(methodHasBody('OPTIONS'), false);
  });

  test('methodHasBody: lowercase post → false (case-sensitive)', () => {
    assert.equal(methodHasBody('post'), false);
  });

  // ── shouldLogRequest ──────────────────────────────────────────────────

  test('shouldLogRequest: GET → false (suppress spam)', () => {
    assert.equal(shouldLogRequest('GET'), false);
  });

  test('shouldLogRequest: POST → true', () => {
    assert.equal(shouldLogRequest('POST'), true);
  });

  test('shouldLogRequest: PUT → true', () => {
    assert.equal(shouldLogRequest('PUT'), true);
  });

  test('shouldLogRequest: DELETE → true', () => {
    assert.equal(shouldLogRequest('DELETE'), true);
  });

  // ── Error response ────────────────────────────────────────────────────

  test('formatProxyError: returns correct error structure', () => {
    const err = formatProxyError();
    assert.deepEqual(err, { error: 'C++ backend unavailable' });
  });

  test('formatProxyError: JSON serializable', () => {
    const err = formatProxyError();
    const json = JSON.stringify(err);
    assert.equal(typeof json, 'string');
    assert.ok(json.includes('C++ backend unavailable'));
  });

  // ── Body serialization ────────────────────────────────────────────────

  test('serializeBody: null → null', () => {
    assert.equal(serializeBody(null), null);
  });

  test('serializeBody: undefined → null', () => {
    assert.equal(serializeBody(undefined), null);
  });

  test('serializeBody: empty object → valid JSON', () => {
    const result = serializeBody({});
    assert.equal(result, '{}');
  });

  test('serializeBody: object with data → correct JSON', () => {
    const result = serializeBody({ from: [2, 1], to: [3, 0] });
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.from, [2, 1]);
    assert.deepEqual(parsed.to, [3, 0]);
  });

  test('serializeBody: nested object → correct JSON', () => {
    const body = { move: { from: [0, 0], to: [1, 1], captures: [[0, 0]] } };
    const result = serializeBody(body);
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed.move.captures, [[0, 0]]);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Proxy Logic Tests');

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
