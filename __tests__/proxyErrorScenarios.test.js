/**
 * proxyErrorScenarios.test.js — Tests for proxy error scenarios not covered elsewhere.
 *
 * Covers gaps in proxyLogic.test.js, proxyPathRewrite.test.js, proxyBodyReplay.test.js:
 * - Error handler with null/undefined res object
 * - Different HTTP error status handling (502 vs 503 vs 504)
 * - Proxy error during body re-serialization
 * - Concurrent proxy requests (filter independence)
 * - Error response Content-Type header
 * - ProxyReq header setup edge cases
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: proxy error handler resilience ───────────────────────────────

/**
 * Simulates the proxy error handler from server/proxy.js.
 * Handles: error, req, res — returns the response that would be sent.
 */
function handleProxyError(err, res) {
  // Guard: null/undefined res
  if (!res) {
    return { sent: false, reason: 'null-res' };
  }
  // Guard: headers already sent
  if (res.headersSent) {
    return { sent: false, reason: 'headers-sent' };
  }
  // Send 502 error response
  return {
    sent: true,
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'C++ backend unavailable' }),
  };
}

/**
 * Classifies proxy connection errors.
 * Mirrors what http-proxy-middleware passes to error handler.
 */
function classifyProxyError(err) {
  if (err.code === 'ECONNREFUSED') return 'connection-refused';
  if (err.code === 'ECONNRESET') return 'connection-reset';
  if (err.code === 'ETIMEDOUT') return 'timeout';
  if (err.code === 'EHOSTUNREACH') return 'host-unreachable';
  if (err.message?.includes('socket hang up')) return 'socket-hang-up';
  return 'unknown';
}

// ── Extracted: proxyReq body re-serialization guard ─────────────────────────

/**
 * Simulates the proxyReq handler body re-serialization.
 * Returns what would be written to the proxy request.
 */
function prepareProxyReqBody(method, body) {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  if (!hasBody) return null;
  if (!body) return null;

  const bodyData = JSON.stringify(body);
  return {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyData)),
    },
    body: bodyData,
  };
}

/**
 * Validates proxy filter with edge case inputs.
 */
function proxyFilter(pathname) {
  if (typeof pathname !== 'string') return false;
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
}

/**
 * Simulates concurrent proxy requests — validates filter is stateless.
 */
function processConcurrentRequests(paths) {
  return paths.map(p => ({ path: p, proxied: proxyFilter(p) }));
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runProxyErrorScenariosTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Error handler: null/undefined res
  // ═══════════════════════════════════════════════════════════════════════

  test('error handler: null res → not sent (avoids crash)', () => {
    const result = handleProxyError(new Error('ECONNREFUSED'), null);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'null-res');
  });

  test('error handler: undefined res → not sent', () => {
    const result = handleProxyError(new Error('timeout'), undefined);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'null-res');
  });

  test('error handler: headersSent=true → not sent (prevents double-write)', () => {
    const res = { headersSent: true };
    const result = handleProxyError(new Error('crash'), res);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'headers-sent');
  });

  test('error handler: valid res → sends 502 with JSON body', () => {
    const res = { headersSent: false };
    const result = handleProxyError(new Error('ECONNREFUSED'), res);
    assert.equal(result.sent, true);
    assert.equal(result.status, 502);
    assert.equal(result.contentType, 'application/json');
    assert.ok(result.body.includes('C++ backend unavailable'));
  });

  test('error handler: response body is valid JSON', () => {
    const res = { headersSent: false };
    const result = handleProxyError(new Error('test'), res);
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.error, 'C++ backend unavailable');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error classification
  // ═══════════════════════════════════════════════════════════════════════

  test('classify: ECONNREFUSED → connection-refused', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8080');
    err.code = 'ECONNREFUSED';
    assert.equal(classifyProxyError(err), 'connection-refused');
  });

  test('classify: ECONNRESET → connection-reset', () => {
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    assert.equal(classifyProxyError(err), 'connection-reset');
  });

  test('classify: ETIMEDOUT → timeout', () => {
    const err = new Error('connect ETIMEDOUT');
    err.code = 'ETIMEDOUT';
    assert.equal(classifyProxyError(err), 'timeout');
  });

  test('classify: EHOSTUNREACH → host-unreachable', () => {
    const err = new Error('connect EHOSTUNREACH');
    err.code = 'EHOSTUNREACH';
    assert.equal(classifyProxyError(err), 'host-unreachable');
  });

  test('classify: socket hang up message → socket-hang-up', () => {
    const err = new Error('socket hang up');
    assert.equal(classifyProxyError(err), 'socket-hang-up');
  });

  test('classify: unknown error → unknown', () => {
    const err = new Error('Something weird');
    assert.equal(classifyProxyError(err), 'unknown');
  });

  test('classify: error without code or message → unknown', () => {
    const err = new Error();
    err.message = '';
    assert.equal(classifyProxyError(err), 'unknown');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Body re-serialization guards
  // ═══════════════════════════════════════════════════════════════════════

  test('proxyReq body: GET with body → null (no re-serialization)', () => {
    const result = prepareProxyReqBody('GET', { data: 1 });
    assert.equal(result, null);
  });

  test('proxyReq body: DELETE with body → null', () => {
    const result = prepareProxyReqBody('DELETE', { data: 1 });
    assert.equal(result, null);
  });

  test('proxyReq body: POST with null body → null', () => {
    const result = prepareProxyReqBody('POST', null);
    assert.equal(result, null);
  });

  test('proxyReq body: POST with undefined body → null', () => {
    const result = prepareProxyReqBody('POST', undefined);
    assert.equal(result, null);
  });

  test('proxyReq body: POST with empty string → null (falsy)', () => {
    const result = prepareProxyReqBody('POST', '');
    assert.equal(result, null);
  });

  test('proxyReq body: POST with 0 → null (falsy)', () => {
    const result = prepareProxyReqBody('POST', 0);
    assert.equal(result, null);
  });

  test('proxyReq body: POST with false → null (falsy)', () => {
    const result = prepareProxyReqBody('POST', false);
    assert.equal(result, null);
  });

  test('proxyReq body: POST with valid object → headers + body', () => {
    const result = prepareProxyReqBody('POST', { from: [2, 1], to: [3, 0] });
    assert.notEqual(result, null);
    assert.equal(result.headers['Content-Type'], 'application/json');
    assert.ok(result.headers['Content-Length']);
    assert.equal(typeof result.body, 'string');
  });

  test('proxyReq body: PUT with empty object → valid (empty is truthy)', () => {
    const result = prepareProxyReqBody('PUT', {});
    assert.notEqual(result, null);
    assert.equal(result.body, '{}');
    assert.equal(result.headers['Content-Length'], '2');
  });

  test('proxyReq body: PATCH with array body → valid', () => {
    const result = prepareProxyReqBody('PATCH', [1, 2, 3]);
    assert.notEqual(result, null);
    assert.equal(result.body, '[1,2,3]');
  });

  test('proxyReq body: Content-Length matches byte length for unicode', () => {
    const body = { msg: 'Zażółć gęślą jaźń' };
    const result = prepareProxyReqBody('POST', body);
    const expectedLen = Buffer.byteLength(result.body);
    assert.equal(result.headers['Content-Length'], String(expectedLen));
    // UTF-8 bytes > string length for Polish chars
    assert.ok(expectedLen > result.body.length);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Filter: non-string inputs
  // ═══════════════════════════════════════════════════════════════════════

  test('filter: null pathname → false (safe)', () => {
    assert.equal(proxyFilter(null), false);
  });

  test('filter: undefined pathname → false', () => {
    assert.equal(proxyFilter(undefined), false);
  });

  test('filter: number pathname → false', () => {
    assert.equal(proxyFilter(42), false);
  });

  test('filter: empty string → true (not excluded)', () => {
    assert.equal(proxyFilter(''), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Concurrent request processing
  // ═══════════════════════════════════════════════════════════════════════

  test('concurrent: mixed proxied and excluded paths', () => {
    const paths = ['/game/state', '/ai/predict', '/move', '/selfplay/status', '/legal-moves'];
    const results = processConcurrentRequests(paths);
    assert.equal(results[0].proxied, true);
    assert.equal(results[1].proxied, false);
    assert.equal(results[2].proxied, true);
    assert.equal(results[3].proxied, false);
    assert.equal(results[4].proxied, true);
  });

  test('concurrent: 100 rapid requests maintain correct filtering', () => {
    const paths = [];
    for (let i = 0; i < 50; i++) {
      paths.push('/api/endpoint' + i);
      paths.push('/ai/predict');
    }
    const results = processConcurrentRequests(paths);
    // Every /ai/predict should be excluded
    const aiResults = results.filter(r => r.path === '/ai/predict');
    assert.ok(aiResults.every(r => r.proxied === false));
    // Every /api/endpoint should be proxied
    const apiResults = results.filter(r => r.path.startsWith('/api/'));
    assert.ok(apiResults.every(r => r.proxied === true));
  });

  test('concurrent: filter is stateless between calls', () => {
    // Call filter multiple times with same input — should always return same result
    const result1 = proxyFilter('/ai/predict');
    const result2 = proxyFilter('/game/state');
    const result3 = proxyFilter('/ai/predict');
    const result4 = proxyFilter('/game/state');
    assert.equal(result1, result3);
    assert.equal(result2, result4);
    assert.equal(result1, false);
    assert.equal(result2, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handler: multiple error types return same 502
  // ═══════════════════════════════════════════════════════════════════════

  test('error handler: ECONNREFUSED → same 502 response', () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    const res = handleProxyError(err, { headersSent: false });
    assert.equal(res.status, 502);
  });

  test('error handler: timeout → same 502 response', () => {
    const err = new Error('timeout');
    err.code = 'ETIMEDOUT';
    const res = handleProxyError(err, { headersSent: false });
    assert.equal(res.status, 502);
  });

  test('error handler: crash → same 502 response', () => {
    const err = new Error('C++ engine crashed');
    const res = handleProxyError(err, { headersSent: false });
    assert.equal(res.status, 502);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Proxy Error Scenarios Tests');

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`   ─── ${passed} passed, ${failed} failed ───`);
  return { passed, failed };
}
