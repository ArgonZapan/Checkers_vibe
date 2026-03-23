/**
 * proxyPathRewrite.test.js — Tests for proxy path rewrite and route filter logic.
 *
 * Covers gaps in server/proxy.js not addressed by proxyLogic.test.js:
 * - pathRewrite: '^': '/api' — restoring /api prefix for C++ backend
 * - filter: more route edge cases (case sensitivity, partial matches, trailing slashes)
 * - Combined filter + rewrite scenarios
 * - Error handler: response already sent guard
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: proxy filter (mirrors server/proxy.js) ───────────────────────

function proxyFilter(pathname) {
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
}

// ── Extracted: pathRewrite logic ────────────────────────────────────────────
// Mirrors: pathRewrite: { '^': '/api' }
// Express strips '/api' mount prefix, so filter sees '/game/state' etc.
// The rewrite restores '/api' prefix for C++ backend.

function proxyPathRewrite(pathname) {
  // Rewrite rule: prepend '/api' to all filtered paths
  return '/api' + pathname;
}

// ── Extracted: error handler logic ──────────────────────────────────────────

function createErrorHandler() {
  let headersSent = false;

  function setErrorHandler(fn) {
    // Store for testing
    createErrorHandler._handler = fn;
  }

  return {
    setErrorHandler,
    setHeadersSent: (v) => { headersSent = v; },
    getHeadersSent: () => headersSent,
  };
}

function formatErrorResponse(headersSent) {
  if (headersSent) return null; // can't send response
  return {
    status: 502,
    body: { error: 'C++ backend unavailable' },
  };
}

// ── Extracted: proxyReq body re-serialization conditions ────────────────────

function shouldReserializeBody(method, body) {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  return hasBody && !!body;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runProxyPathRewriteTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // proxyFilter — route matching
  // ═══════════════════════════════════════════════════════════════════════

  test('filter: /game/state → true (proxy to C++)', () => {
    assert.equal(proxyFilter('/game/state'), true);
  });

  test('filter: /ai/predict → false (handled by Node)', () => {
    assert.equal(proxyFilter('/ai/predict'), false);
  });

  test('filter: /ai/info → false', () => {
    assert.equal(proxyFilter('/ai/info'), false);
  });

  test('filter: /selfplay/start → false', () => {
    assert.equal(proxyFilter('/selfplay/start'), false);
  });

  test('filter: /selfplay/status → false', () => {
    assert.equal(proxyFilter('/selfplay/status'), false);
  });

  test('filter: /ai → true (no trailing slash — not /ai/)', () => {
    assert.equal(proxyFilter('/ai'), true);
  });

  test('filter: /selfplay → true (no trailing slash)', () => {
    assert.equal(proxyFilter('/selfplay'), true);
  });

  test('filter: /aixxx → true (not /ai/ prefix)', () => {
    assert.equal(proxyFilter('/aixxx'), true);
  });

  test('filter: /selfplayxxx → true (not /selfplay/ prefix)', () => {
    assert.equal(proxyFilter('/selfplayxxx'), true);
  });

  test('filter: /AI/predict → true (case-sensitive, uppercase not matched)', () => {
    assert.equal(proxyFilter('/AI/predict'), true);
  });

  test('filter: /SELFPLAY/start → true (case-sensitive)', () => {
    assert.equal(proxyFilter('/SELFPLAY/start'), true);
  });

  test('filter: /game/reset → true', () => {
    assert.equal(proxyFilter('/game/reset'), true);
  });

  test('filter: /legal-moves → true', () => {
    assert.equal(proxyFilter('/legal-moves'), true);
  });

  test('filter: /move → true', () => {
    assert.equal(proxyFilter('/move'), true);
  });

  test('filter: / → true (root path)', () => {
    assert.equal(proxyFilter('/'), true);
  });

  test('filter: empty string → true', () => {
    assert.equal(proxyFilter(''), true);
  });

  test('filter: /ai/train/batch → false (nested under /ai/)', () => {
    assert.equal(proxyFilter('/ai/train/batch'), false);
  });

  test('filter: /selfplay/control/stop → false (nested)', () => {
    assert.equal(proxyFilter('/selfplay/control/stop'), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // pathRewrite — restoring /api prefix
  // ═══════════════════════════════════════════════════════════════════════

  test('pathRewrite: /game/state → /api/game/state', () => {
    assert.equal(proxyPathRewrite('/game/state'), '/api/game/state');
  });

  test('pathRewrite: /game/start → /api/game/start', () => {
    assert.equal(proxyPathRewrite('/game/start'), '/api/game/start');
  });

  test('pathRewrite: /legal-moves → /api/legal-moves', () => {
    assert.equal(proxyPathRewrite('/legal-moves'), '/api/legal-moves');
  });

  test('pathRewrite: /move → /api/move', () => {
    assert.equal(proxyPathRewrite('/move'), '/api/move');
  });

  test('pathRewrite: /game/reset → /api/game/reset', () => {
    assert.equal(proxyPathRewrite('/game/reset'), '/api/game/reset');
  });

  test('pathRewrite: / → /api/', () => {
    assert.equal(proxyPathRewrite('/'), '/api/');
  });

  test('pathRewrite: root with query → /api/?foo=bar', () => {
    assert.equal(proxyPathRewrite('/?foo=bar'), '/api/?foo=bar');
  });

  test('pathRewrite: deep path → /api/game/history/move/5', () => {
    assert.equal(proxyPathRewrite('/game/history/move/5'), '/api/game/history/move/5');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined: filter + rewrite
  // ═══════════════════════════════════════════════════════════════════════

  test('combined: filtered /game/state → rewrite to /api/game/state', () => {
    const pathname = '/game/state';
    assert.equal(proxyFilter(pathname), true);
    assert.equal(proxyPathRewrite(pathname), '/api/game/state');
  });

  test('combined: blocked /ai/predict → no rewrite needed', () => {
    const pathname = '/ai/predict';
    assert.equal(proxyFilter(pathname), false);
    // Rewrite would still work but filter blocks it first
  });

  test('combined: blocked /selfplay/status → no rewrite needed', () => {
    const pathname = '/selfplay/status';
    assert.equal(proxyFilter(pathname), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handler — response guard
  // ═══════════════════════════════════════════════════════════════════════

  test('error handler: headers not sent → send 502', () => {
    const response = formatErrorResponse(false);
    assert.notEqual(response, null);
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { error: 'C++ backend unavailable' });
  });

  test('error handler: headers already sent → skip response', () => {
    const response = formatErrorResponse(true);
    assert.equal(response, null);
  });

  test('error handler: response body is JSON serializable', () => {
    const response = formatErrorResponse(false);
    const json = JSON.stringify(response.body);
    assert.equal(typeof json, 'string');
    assert.ok(json.includes('C++ backend unavailable'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Body re-serialization conditions
  // ═══════════════════════════════════════════════════════════════════════

  test('shouldReserializeBody: POST with body → true', () => {
    assert.equal(shouldReserializeBody('POST', { data: 1 }), true);
  });

  test('shouldReserializeBody: PUT with body → true', () => {
    assert.equal(shouldReserializeBody('PUT', { data: 1 }), true);
  });

  test('shouldReserializeBody: PATCH with body → true', () => {
    assert.equal(shouldReserializeBody('PATCH', { data: 1 }), true);
  });

  test('shouldReserializeBody: GET with body → false (GET not in list)', () => {
    assert.equal(shouldReserializeBody('GET', { data: 1 }), false);
  });

  test('shouldReserializeBody: DELETE with body → false', () => {
    assert.equal(shouldReserializeBody('DELETE', { data: 1 }), false);
  });

  test('shouldReserializeBody: POST with null body → false', () => {
    assert.equal(shouldReserializeBody('POST', null), false);
  });

  test('shouldReserializeBody: POST with undefined body → false', () => {
    assert.equal(shouldReserializeBody('POST', undefined), false);
  });

  test('shouldReserializeBody: POST with empty object → true (truthy)', () => {
    assert.equal(shouldReserializeBody('POST', {}), true);
  });

  test('shouldReserializeBody: POST with empty string body → false (falsy)', () => {
    assert.equal(shouldReserializeBody('POST', ''), false);
  });

  test('shouldReserializeBody: POST with 0 body → false (falsy)', () => {
    assert.equal(shouldReserializeBody('POST', 0), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // proxyReq headers setup
  // ═══════════════════════════════════════════════════════════════════════

  test('body serialization: Content-Length computed correctly', () => {
    const body = { from: [2, 1], to: [3, 0] };
    const bodyData = JSON.stringify(body);
    const contentLength = Buffer.byteLength(bodyData);
    assert.ok(contentLength > 0);
    assert.equal(contentLength, Buffer.byteLength('{"from":[2,1],"to":[3,0]}'));
  });

  test('body serialization: unicode body has correct byte length', () => {
    const body = { msg: 'Zażółć' };
    const bodyData = JSON.stringify(body);
    const byteLen = Buffer.byteLength(bodyData);
    const charLen = bodyData.length;
    // Unicode chars take more bytes than characters
    assert.ok(byteLen >= charLen, `byteLen=${byteLen} should >= charLen=${charLen}`);
  });

  test('body serialization: large body serializes correctly', () => {
    const body = { board: new Array(64).fill(0), moves: new Array(50).fill({ from: 0, to: 1 }) };
    const json = JSON.stringify(body);
    const parsed = JSON.parse(json);
    assert.equal(parsed.board.length, 64);
    assert.equal(parsed.moves.length, 50);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Proxy Path Rewrite & Extended Logic Tests');

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
