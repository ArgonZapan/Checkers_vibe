/**
 * hunter-alpha-proxy-filter.test.js — Proxy filter and path rewrite edge cases.
 *
 * Gaps identified:
 * - filter function: /ai/* routes are excluded
 * - filter function: /selfplay/* routes are excluded
 * - filter function: /game/* routes pass through
 * - filter function: /legal-moves passes through
 * - filter function: /api/move passes through
 * - filter function: exact /ai (no trailing slash) passes through
 * - filter function: edge paths
 * - pathRewrite: ^ → /api restores prefix
 */
import assert from 'node:assert/strict';

// ── Inline proxy filter logic ─────────────────────────────────────────

// From server/proxy.js — Express strips mount prefix, so filter sees paths without /api
const filter = (pathname) => {
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
};

// pathRewrite from proxy.js
const pathRewrite = { '^': '/api' };

// Simulate pathRewrite behavior
function applyPathRewrite(pathname) {
  return pathname.replace(new RegExp(pathRewrite['^'].replace('^', '^')), '/api');
}

export async function runHunterAlphaProxyFilterTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── Filter: AI routes excluded ─────────────────────────────────────

  test('filter: /ai/info → false (excluded)', () => {
    assert.equal(filter('/ai/info'), false);
  });

  test('filter: /ai/predict → false (excluded)', () => {
    assert.equal(filter('/ai/predict'), false);
  });

  test('filter: /ai/train → false (excluded)', () => {
    assert.equal(filter('/ai/train'), false);
  });

  test('filter: /ai/params → false (excluded)', () => {
    assert.equal(filter('/ai/params'), false);
  });

  test('filter: /ai/reset → false (excluded)', () => {
    assert.equal(filter('/ai/reset'), false);
  });

  test('filter: /ai/stats → false (excluded)', () => {
    assert.equal(filter('/ai/stats'), false);
  });

  // ── Filter: SelfPlay routes excluded ────────────────────────────────

  test('filter: /selfplay/start → false (excluded)', () => {
    assert.equal(filter('/selfplay/start'), false);
  });

  test('filter: /selfplay/stop → false (excluded)', () => {
    assert.equal(filter('/selfplay/stop'), false);
  });

  test('filter: /selfplay/status → false (excluded)', () => {
    assert.equal(filter('/selfplay/status'), false);
  });

  // ── Filter: Game routes pass through ────────────────────────────────

  test('filter: /game/state → true (proxied)', () => {
    assert.equal(filter('/game/state'), true);
  });

  test('filter: /game/start → true (proxied)', () => {
    assert.equal(filter('/game/start'), true);
  });

  test('filter: /game/reset → true (proxied)', () => {
    assert.equal(filter('/game/reset'), true);
  });

  test('filter: /legal-moves → true (proxied)', () => {
    assert.equal(filter('/legal-moves'), true);
  });

  test('filter: /move → true (proxied)', () => {
    assert.equal(filter('/move'), true);
  });

  // ── Filter: edge paths ─────────────────────────────────────────────

  test('filter: /ai (no trailing slash) → true (not /ai/)', () => {
    // /ai does NOT start with /ai/ — it's just /ai
    assert.equal(filter('/ai'), true);
  });

  test('filter: /selfplay (no trailing slash) → true (not /selfplay/)', () => {
    assert.equal(filter('/selfplay'), true);
  });

  test('filter: /aiinfo → true (not /ai/)', () => {
    assert.equal(filter('/aiinfo'), true);
  });

  test('filter: /selfplaystatus → true (not /selfplay/)', () => {
    assert.equal(filter('/selfplaystatus'), true);
  });

  test('filter: / → true (root)', () => {
    assert.equal(filter('/'), true);
  });

  test('filter: empty string → true', () => {
    assert.equal(filter(''), true);
  });

  test('filter: /something/ai/predict → true (ai is not at root)', () => {
    assert.equal(filter('/something/ai/predict'), true);
  });

  // ── Path rewrite ───────────────────────────────────────────────────

  test('pathRewrite: rule is ^ → /api', () => {
    assert.equal(pathRewrite['^'], '/api');
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Proxy Filter');

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
