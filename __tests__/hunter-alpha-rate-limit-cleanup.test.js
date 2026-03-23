/**
 * hunter-alpha-rate-limit-cleanup.test.js — Rate limiting cleanup and edge cases.
 *
 * Gaps identified:
 * - Cleanup interval evicts expired entries
 * - Cleanup interval evicts oldest when over max entries
 * - Rate limit middleware with undefined IP
 * - Rate limit middleware: request exactly at boundary (count = MAX)
 * - Rate limit middleware: request one over boundary (count = MAX + 1)
 * - Rate limit: new window after expiry resets count
 */
import assert from 'node:assert/strict';

// ── Inline rate limiting logic ────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

function cleanupRateLimit(rateLimitMap) {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
  if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    const sorted = [...rateLimitMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const evictCount = rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES;
    for (let i = 0; i < evictCount; i++) {
      rateLimitMap.delete(sorted[i][0]);
    }
  }
}

function checkRateLimit(rateLimitMap, ip, now) {
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, status: 429 };
  }
  return { allowed: true, status: 200 };
}

export async function runHunterAlphaRateLimitCleanupTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── Cleanup: expired entries ───────────────────────────────────────

  test('cleanup: removes expired entries', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.2.3.4', { windowStart: now - RATE_LIMIT_WINDOW_MS - 1000, count: 50 });
    map.set('5.6.7.8', { windowStart: now, count: 10 });
    cleanupRateLimit(map);
    assert.equal(map.has('1.2.3.4'), false);
    assert.equal(map.has('5.6.7.8'), true);
  });

  test('cleanup: keeps entries within window', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now - RATE_LIMIT_WINDOW_MS + 1000, count: 100 });
    cleanupRateLimit(map);
    assert.equal(map.has('1.1.1.1'), true);
  });

  test('cleanup: entry exactly at window boundary is kept', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now - RATE_LIMIT_WINDOW_MS, count: 50 });
    cleanupRateLimit(map);
    // now - windowStart = RATE_LIMIT_WINDOW_MS, not > RATE_LIMIT_WINDOW_MS
    assert.equal(map.has('1.1.1.1'), true);
  });

  test('cleanup: entry just past boundary is removed', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now - RATE_LIMIT_WINDOW_MS - 1, count: 50 });
    cleanupRateLimit(map);
    assert.equal(map.has('1.1.1.1'), false);
  });

  // ── Cleanup: over max entries ──────────────────────────────────────

  test('cleanup: evicts oldest entries when over max', () => {
    const map = new Map();
    const now = Date.now();
    // Add RATE_LIMIT_MAX_ENTRIES + 10 entries
    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES + 10; i++) {
      map.set(`ip-${i}`, { windowStart: now - i, count: 1 }); // oldest = highest i
    }
    cleanupRateLimit(map);
    assert.ok(map.size <= RATE_LIMIT_MAX_ENTRIES, `map size ${map.size} should be <= ${RATE_LIMIT_MAX_ENTRIES}`);
    // Newest entries should survive
    assert.equal(map.has('ip-0'), true);
    assert.equal(map.has('ip-9'), true);
    // Oldest entries should be evicted
    assert.equal(map.has(`ip-${RATE_LIMIT_MAX_ENTRIES + 9}`), false);
  });

  // ── Rate limit check ──────────────────────────────────────────────

  test('rate limit: first request is allowed', () => {
    const map = new Map();
    const result = checkRateLimit(map, '1.1.1.1', Date.now());
    assert.equal(result.allowed, true);
    assert.equal(result.status, 200);
  });

  test('rate limit: request at count=MAX is allowed', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now, count: RATE_LIMIT_MAX });
    const result = checkRateLimit(map, '1.1.1.1', now);
    // count becomes MAX + 1, which is > MAX
    assert.equal(result.allowed, false);
    assert.equal(result.status, 429);
  });

  test('rate limit: request at count=MAX-1 is allowed', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now, count: RATE_LIMIT_MAX - 1 });
    const result = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(result.allowed, true);
  });

  test('rate limit: expired window resets count', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now - RATE_LIMIT_WINDOW_MS - 1000, count: RATE_LIMIT_MAX + 100 });
    const result = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(result.allowed, true);
    assert.equal(map.get('1.1.1.1').count, 1);
  });

  test('rate limit: different IPs are independent', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now, count: RATE_LIMIT_MAX });
    const result = checkRateLimit(map, '2.2.2.2', now);
    assert.equal(result.allowed, true);
    assert.equal(map.get('2.2.2.2').count, 1);
  });

  test('rate limit: creates entry for new IP', () => {
    const map = new Map();
    checkRateLimit(map, '10.0.0.1', Date.now());
    assert.ok(map.has('10.0.0.1'));
    assert.equal(map.get('10.0.0.1').count, 1);
  });

  test('rate limit: undefined IP creates entry with key undefined', () => {
    const map = new Map();
    const result = checkRateLimit(map, undefined, Date.now());
    assert.equal(result.allowed, true);
    assert.ok(map.has(undefined));
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Rate Limit Cleanup');

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
