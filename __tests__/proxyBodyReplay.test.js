/**
 * proxyBodyReplay.test.js — Tests for proxy body re-serialization and Content-Length.
 *
 * Covers the proxyReq handler in server/proxy.js:
 * - POST body re-serialized with correct Content-Length
 * - Content-Length set to Buffer.byteLength (not string.length)
 * - Unicode content handled correctly
 * - Non-body methods (GET, DELETE) don't write body
 * - Error handler checks res.headersSent
 * - pathRewrite restores /api prefix
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: proxy body re-serialization logic (mirrors server/proxy.js) ──

/**
 * Check if a method should include a body.
 */
function methodHasBody(method) {
  return ['POST', 'PUT', 'PATCH'].includes(method);
}

/**
 * Serialize body to JSON and compute Content-Length.
 * Mirrors the proxyReq handler in proxy.js.
 */
function prepareProxyBody(body) {
  if (!body) return null;
  const bodyData = JSON.stringify(body);
  return {
    bodyData,
    contentLength: Buffer.byteLength(bodyData),
    contentType: 'application/json',
  };
}

/**
 * Check if error handler should write response (mirrors proxy error handler).
 */
function shouldWriteErrorResponse(res) {
  return res && !res.headersSent;
}

/**
 * Path rewrite: restore /api prefix (mirrors pathRewrite: { '^': '/api' }).
 */
function rewritePath(pathname) {
  // Express strips '/api' mount prefix, so we restore it
  return '/api' + pathname;
}

/**
 * Proxy filter: exclude AI and selfplay routes.
 */
function proxyFilter(pathname) {
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runProxyBodyReplayTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Content-Length calculation
  // ═══════════════════════════════════════════════════════════════════════

  test('Content-Length: set to Buffer.byteLength, not string.length', () => {
    const body = { message: 'Zażółć gęślą jaźń' };
    const result = prepareProxyBody(body);
    // string.length counts UTF-16 code units, Buffer.byteLength counts UTF-8 bytes
    // Polish chars like ą, ć, ź, ń are 2 bytes each in UTF-8
    assert.ok(result.contentLength > result.bodyData.length,
      'UTF-8 byte length should be > string length for non-ASCII');
    assert.equal(result.contentLength, Buffer.byteLength(result.bodyData));
  });

  test('Content-Length: ASCII body has equal length', () => {
    const body = { from: [2, 1], to: [3, 2] };
    const result = prepareProxyBody(body);
    assert.equal(result.contentLength, Buffer.byteLength(result.bodyData));
  });

  test('Content-Length: emoji content uses multi-byte UTF-8', () => {
    const body = { message: '🎮🎯🏆' };
    const result = prepareProxyBody(body);
    // Each emoji is 4 bytes in UTF-8
    assert.ok(result.contentLength > result.bodyData.length);
    assert.equal(result.contentLength, Buffer.byteLength(result.bodyData));
  });

  test('Content-Length: empty object is 2 bytes', () => {
    const result = prepareProxyBody({});
    assert.equal(result.contentLength, 2); // "{}"
  });

  test('Content-Length: null body returns null', () => {
    assert.equal(prepareProxyBody(null), null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Body serialization
  // ═══════════════════════════════════════════════════════════════════════

  test('serialize body: move with from/to/captures roundtrips correctly', () => {
    const body = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    const result = prepareProxyBody(body);
    const parsed = JSON.parse(result.bodyData);
    assert.deepEqual(parsed.from, [2, 1]);
    assert.deepEqual(parsed.to, [4, 3]);
    assert.deepEqual(parsed.captures, [[3, 2]]);
  });

  test('serialize body: deeply nested object preserves structure', () => {
    const body = { a: { b: { c: { d: 42 } } } };
    const result = prepareProxyBody(body);
    const parsed = JSON.parse(result.bodyData);
    assert.equal(parsed.a.b.c.d, 42);
  });

  test('serialize body: array body wraps correctly', () => {
    const body = [1, 2, 3];
    const result = prepareProxyBody(body);
    assert.deepEqual(JSON.parse(result.bodyData), [1, 2, 3]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Method body check
  // ═══════════════════════════════════════════════════════════════════════

  test('methodHasBody: POST → true', () => {
    assert.ok(methodHasBody('POST'));
  });

  test('methodHasBody: PUT → true', () => {
    assert.ok(methodHasBody('PUT'));
  });

  test('methodHasBody: PATCH → true', () => {
    assert.ok(methodHasBody('PATCH'));
  });

  test('methodHasBody: GET → false', () => {
    assert.ok(!methodHasBody('GET'));
  });

  test('methodHasBody: DELETE → false', () => {
    assert.ok(!methodHasBody('DELETE'));
  });

  test('methodHasBody: OPTIONS → false', () => {
    assert.ok(!methodHasBody('OPTIONS'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handler: headersSent check
  // ═══════════════════════════════════════════════════════════════════════

  test('error handler: headersSent=false → should write response', () => {
    const res = { headersSent: false };
    assert.ok(shouldWriteErrorResponse(res));
  });

  test('error handler: headersSent=true → should NOT write response', () => {
    const res = { headersSent: true };
    assert.ok(!shouldWriteErrorResponse(res));
  });

  test('error handler: null res → should NOT write response', () => {
    assert.ok(!shouldWriteErrorResponse(null));
  });

  test('error handler: undefined res → should NOT write response', () => {
    assert.ok(!shouldWriteErrorResponse(undefined));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Path rewrite: restore /api prefix
  // ═══════════════════════════════════════════════════════════════════════

  test('pathRewrite: /game/state → /api/game/state', () => {
    assert.equal(rewritePath('/game/state'), '/api/game/state');
  });

  test('pathRewrite: /move → /api/move', () => {
    assert.equal(rewritePath('/move'), '/api/move');
  });

  test('pathRewrite: /legal-moves → /api/legal-moves', () => {
    assert.equal(rewritePath('/legal-moves'), '/api/legal-moves');
  });

  test('pathRewrite: / → /api/', () => {
    assert.equal(rewritePath('/'), '/api/');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Proxy filter: exclude AI and selfplay routes
  // ═══════════════════════════════════════════════════════════════════════

  test('proxyFilter: /game/state → proxied', () => {
    assert.ok(proxyFilter('/game/state'));
  });

  test('proxyFilter: /ai/info → NOT proxied', () => {
    assert.ok(!proxyFilter('/ai/info'));
  });

  test('proxyFilter: /selfplay/start → NOT proxied', () => {
    assert.ok(!proxyFilter('/selfplay/start'));
  });

  test('proxyFilter: /ai/predict → NOT proxied', () => {
    assert.ok(!proxyFilter('/ai/predict'));
  });

  test('proxyFilter: /selfplay/status → NOT proxied', () => {
    assert.ok(!proxyFilter('/selfplay/status'));
  });

  test('proxyFilter: /move → proxied', () => {
    assert.ok(proxyFilter('/move'));
  });

  test('proxyFilter: /legal-moves → proxied', () => {
    assert.ok(proxyFilter('/legal-moves'));
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Proxy Body Re-serialization Tests');

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
