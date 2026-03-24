/**
 * proxyContentType.test.js — Tests for proxy body handling with various content types.
 *
 * Covers the proxyReq handler in server/proxy.js:
 * - JSON body re-serialization with correct headers
 * - Content-Type set to application/json for body methods
 * - Content-Length computed with Buffer.byteLength (UTF-8)
 * - Non-body methods (GET, DELETE, HEAD) don't write body
 * - Unicode/special characters in body
 * - Large body handling
 * - Empty body vs null body vs undefined body
 * - pathRewrite correctness
 * - proxyFilter for route exclusion
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: proxy handler logic (mirrors server/proxy.js) ───────────────

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);
const METHODS_WITHOUT_BODY = new Set(['GET', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Simulate proxyReq handler.
 * Returns what would be sent to the proxy target.
 */
function simulateProxyReq(method, url, body) {
  const result = {
    method,
    url,
    headers: {},
    bodyWritten: false,
    bodyData: null,
    contentLength: null,
  };

  const hasBody = METHODS_WITH_BODY.has(method);
  if (hasBody && body !== undefined && body !== null) {
    const bodyData = JSON.stringify(body);
    result.headers['Content-Type'] = 'application/json';
    result.headers['Content-Length'] = Buffer.byteLength(bodyData);
    result.bodyWritten = true;
    result.bodyData = bodyData;
    result.contentLength = Buffer.byteLength(bodyData);
  }

  return result;
}

/**
 * Path rewrite: restore /api prefix.
 */
function rewritePath(originalPath) {
  return '/api' + originalPath;
}

/**
 * Proxy filter: exclude AI and selfplay routes.
 * Express strips /api mount prefix, so filter sees paths without /api.
 */
function shouldProxy(pathname) {
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
}

/**
 * Error handler logic: should we write an error response?
 */
function shouldWriteError(res) {
  return res && !res.headersSent;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runProxyContentTypeTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Body methods: POST/PUT/PATCH write body
  // ═══════════════════════════════════════════════════════════════════════

  test('POST with JSON body → Content-Type + Content-Length set', () => {
    const r = simulateProxyReq('POST', '/api/move', { from: [2, 1], to: [3, 2] });
    assert.equal(r.headers['Content-Type'], 'application/json');
    assert.ok(r.headers['Content-Length'] > 0);
    assert.equal(r.bodyWritten, true);
  });

  test('PUT with JSON body → body written', () => {
    const r = simulateProxyReq('PUT', '/api/board/set', { board: [] });
    assert.equal(r.bodyWritten, true);
    assert.equal(r.headers['Content-Type'], 'application/json');
  });

  test('PATCH with JSON body → body written', () => {
    const r = simulateProxyReq('PATCH', '/api/config', { speed: 100 });
    assert.equal(r.bodyWritten, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Non-body methods: GET/DELETE/HEAD don't write body
  // ═══════════════════════════════════════════════════════════════════════

  test('GET → no body written', () => {
    const r = simulateProxyReq('GET', '/api/game/state', null);
    assert.equal(r.bodyWritten, false);
    assert.equal(r.bodyData, null);
  });

  test('DELETE → no body written', () => {
    const r = simulateProxyReq('DELETE', '/api/game/reset', null);
    assert.equal(r.bodyWritten, false);
  });

  test('HEAD → no body written', () => {
    const r = simulateProxyReq('HEAD', '/api/game/state', null);
    assert.equal(r.bodyWritten, false);
  });

  test('OPTIONS → no body written', () => {
    const r = simulateProxyReq('OPTIONS', '/api/game/state', null);
    assert.equal(r.bodyWritten, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST with null/undefined body → no body written
  // ═══════════════════════════════════════════════════════════════════════

  test('POST with null body → no body written', () => {
    const r = simulateProxyReq('POST', '/api/move', null);
    assert.equal(r.bodyWritten, false);
  });

  test('POST with undefined body → no body written', () => {
    const r = simulateProxyReq('POST', '/api/move', undefined);
    assert.equal(r.bodyWritten, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Content-Length: Buffer.byteLength vs string.length
  // ═══════════════════════════════════════════════════════════════════════

  test('Content-Length: ASCII body → Buffer.byteLength == string.length', () => {
    const r = simulateProxyReq('POST', '/api/move', { from: [2, 1] });
    assert.equal(r.contentLength, Buffer.byteLength(r.bodyData));
    // For pure ASCII, byteLength == string length
    assert.equal(r.contentLength, r.bodyData.length);
  });

  test('Content-Length: Polish chars → Buffer.byteLength > string.length', () => {
    const r = simulateProxyReq('POST', '/api/chat', { message: 'Zażółć gęślą jaźń' });
    assert.ok(r.contentLength > r.bodyData.length, 'UTF-8 multi-byte should increase byte count');
    assert.equal(r.contentLength, Buffer.byteLength(r.bodyData));
  });

  test('Content-Length: emoji → 4 bytes per emoji', () => {
    const r = simulateProxyReq('POST', '/api/chat', { message: '🎮' });
    // "🎮" is 4 bytes in UTF-8, string.length is 2 (surrogate pair)
    assert.ok(r.contentLength > r.bodyData.length);
  });

  test('Content-Length: CJK characters → 3 bytes each', () => {
    const r = simulateProxyReq('POST', '/api/chat', { message: '将棋' });
    // Each CJK char is 3 bytes in UTF-8
    assert.ok(r.contentLength > r.bodyData.length);
  });

  test('Content-Length: empty object → 2 bytes ("{}")', () => {
    const r = simulateProxyReq('POST', '/api/move', {});
    assert.equal(r.contentLength, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Body roundtrip: serialize → parse preserves data
  // ═══════════════════════════════════════════════════════════════════════

  test('roundtrip: move with captures preserves all fields', () => {
    const body = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    const r = simulateProxyReq('POST', '/api/move', body);
    const parsed = JSON.parse(r.bodyData);
    assert.deepEqual(parsed.from, [2, 1]);
    assert.deepEqual(parsed.to, [4, 3]);
    assert.deepEqual(parsed.captures, [[3, 2]]);
  });

  test('roundtrip: nested object preserves structure', () => {
    const body = { config: { speed: { fast: 0, normal: 200 } } };
    const r = simulateProxyReq('POST', '/api/config', body);
    const parsed = JSON.parse(r.bodyData);
    assert.equal(parsed.config.speed.fast, 0);
    assert.equal(parsed.config.speed.normal, 200);
  });

  test('roundtrip: array body preserves order', () => {
    const body = [3, 1, 4, 1, 5, 9, 2, 6];
    const r = simulateProxyReq('POST', '/api/data', body);
    const parsed = JSON.parse(r.bodyData);
    assert.deepEqual(parsed, [3, 1, 4, 1, 5, 9, 2, 6]);
  });

  test('roundtrip: boolean and null values preserved', () => {
    const body = { gameOver: true, winner: null, moves: 0 };
    const r = simulateProxyReq('POST', '/api/state', body);
    const parsed = JSON.parse(r.bodyData);
    assert.equal(parsed.gameOver, true);
    assert.equal(parsed.winner, null);
    assert.equal(parsed.moves, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Path rewrite
  // ═══════════════════════════════════════════════════════════════════════

  test('pathRewrite: /game/state → /api/game/state', () => {
    assert.equal(rewritePath('/game/state'), '/api/game/state');
  });

  test('pathRewrite: /move → /api/move', () => {
    assert.equal(rewritePath('/move'), '/api/move');
  });

  test('pathRewrite: / → /api/', () => {
    assert.equal(rewritePath('/'), '/api/');
  });

  test('pathRewrite: /board/set → /api/board/set', () => {
    assert.equal(rewritePath('/board/set'), '/api/board/set');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Proxy filter: route exclusion
  // ═══════════════════════════════════════════════════════════════════════

  test('proxyFilter: /game/state → proxied', () => {
    assert.ok(shouldProxy('/game/state'));
  });

  test('proxyFilter: /move → proxied', () => {
    assert.ok(shouldProxy('/move'));
  });

  test('proxyFilter: /legal-moves → proxied', () => {
    assert.ok(shouldProxy('/legal-moves'));
  });

  test('proxyFilter: /ai/info → NOT proxied', () => {
    assert.ok(!shouldProxy('/ai/info'));
  });

  test('proxyFilter: /ai/predict → NOT proxied', () => {
    assert.ok(!shouldProxy('/ai/predict'));
  });

  test('proxyFilter: /selfplay/start → NOT proxied', () => {
    assert.ok(!shouldProxy('/selfplay/start'));
  });

  test('proxyFilter: /selfplay/status → NOT proxied', () => {
    assert.ok(!shouldProxy('/selfplay/status'));
  });

  test('proxyFilter: /ai/train → NOT proxied', () => {
    assert.ok(!shouldProxy('/ai/train'));
  });

  test('proxyFilter: /selfplay/stop → NOT proxied', () => {
    assert.ok(!shouldProxy('/selfplay/stop'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handler: headersSent check
  // ═══════════════════════════════════════════════════════════════════════

  test('errorHandler: headersSent=false → write 502', () => {
    const res = { headersSent: false };
    assert.ok(shouldWriteError(res));
  });

  test('errorHandler: headersSent=true → skip write', () => {
    const res = { headersSent: true };
    assert.ok(!shouldWriteError(res));
  });

  test('errorHandler: null res → skip write', () => {
    assert.ok(!shouldWriteError(null));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Large body handling
  // ═══════════════════════════════════════════════════════════════════════

  test('large body: 8x8 board array serializes correctly', () => {
    const board = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => (r + c) % 2 === 0 ? null : { color: 'white', king: false })
    );
    const r = simulateProxyReq('POST', '/api/board/set', { board });
    assert.equal(r.bodyWritten, true);
    const parsed = JSON.parse(r.bodyData);
    assert.equal(parsed.board.length, 8);
    assert.equal(parsed.board[0].length, 8);
  });

  test('large body: Content-Length matches actual byte count', () => {
    const largeBody = { data: 'x'.repeat(10000) };
    const r = simulateProxyReq('POST', '/api/data', largeBody);
    assert.equal(r.contentLength, Buffer.byteLength(r.bodyData));
    assert.ok(r.contentLength > 10000);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Proxy Content Type Tests');

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
