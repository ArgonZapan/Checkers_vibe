/**
 * hunter-tw-ws-origin-rate.test.js — WebSocket origin validation + rate limit edge cases
 *
 * Gap: existing tests cover rate limit cleanup but NOT:
 * - _isAllowedWsOrigin logic (WebSocket origin validation from server/index.js)
 * - Rate limit with new IP when map is at capacity (OOM guard)
 * - Rate limit window boundary exact timing
 *
 * Pure JS — no server, no HTTP.
 */

import assert from 'node:assert/strict';

// ── WebSocket origin validation (from server/index.js) ──────────────────

function _isAllowedWsOrigin(origin, corsOrigin, corsOriginList) {
  if (!origin) return true; // same-origin or non-browser (no Origin header)
  if (corsOrigin === '*') return false; // wildcard CORS ≠ wildcard WS
  return corsOriginList.some(allowed => origin === allowed);
}

// ── Rate limiting (from server/index.js) ────────────────────────────────

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
  // OOM guard: evict oldest if map is full and this is a new IP
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    if (!entry && rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      let oldestIp = null;
      let oldestTime = Infinity;
      for (const [k, v] of rateLimitMap) {
        if (v.windowStart < oldestTime) {
          oldestTime = v.windowStart;
          oldestIp = k;
        }
      }
      if (oldestIp) rateLimitMap.delete(oldestIp);
    }
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return { allowed: false, status: 429 };
  }
  return { allowed: true, status: 200 };
}

export async function runHunterTwWsOriginRateTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // WebSocket origin validation
  // ═══════════════════════════════════════════════════════════════════════

  test('ws origin: no origin header → allowed (same-origin)', () => {
    assert.equal(_isAllowedWsOrigin(null, 'http://localhost:3000', ['http://localhost:3000']), true);
    assert.equal(_isAllowedWsOrigin(undefined, 'http://localhost:3000', ['http://localhost:3000']), true);
    assert.equal(_isAllowedWsOrigin('', 'http://localhost:3000', ['http://localhost:3000']), true);
  });

  test('ws origin: CORS_ORIGIN=* blocks all WS origins', () => {
    assert.equal(_isAllowedWsOrigin('http://evil.com', '*', []), false);
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', '*', []), false);
  });

  test('ws origin: exact match → allowed', () => {
    const list = ['http://localhost:3000'];
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', 'http://localhost:3000', list), true);
  });

  test('ws origin: non-matching origin → rejected', () => {
    const list = ['http://localhost:3000'];
    assert.equal(_isAllowedWsOrigin('http://evil.com', 'http://localhost:3000', list), false);
  });

  test('ws origin: multiple allowed origins — first matches', () => {
    const list = ['http://localhost:3000', 'http://localhost:5173'];
    assert.equal(_isAllowedWsOrigin('http://localhost:3000', 'http://localhost:3000,http://localhost:5173', list), true);
  });

  test('ws origin: multiple allowed origins — second matches', () => {
    const list = ['http://localhost:3000', 'http://localhost:5173'];
    assert.equal(_isAllowedWsOrigin('http://localhost:5173', 'http://localhost:3000,http://localhost:5173', list), true);
  });

  test('ws origin: multiple allowed origins — none match', () => {
    const list = ['http://localhost:3000', 'http://localhost:5173'];
    assert.equal(_isAllowedWsOrigin('http://attacker.com', 'http://localhost:3000,http://localhost:5173', list), false);
  });

  test('ws origin: subdomain is NOT allowed (strict match)', () => {
    const list = ['http://example.com'];
    assert.equal(_isAllowedWsOrigin('http://sub.example.com', 'http://example.com', list), false,
      'subdomain should not match parent domain');
  });

  test('ws origin: port difference → rejected', () => {
    const list = ['http://localhost:3000'];
    assert.equal(_isAllowedWsOrigin('http://localhost:8080', 'http://localhost:3000', list), false);
  });

  test('ws origin: https vs http → rejected', () => {
    const list = ['http://localhost:3000'];
    assert.equal(_isAllowedWsOrigin('https://localhost:3000', 'http://localhost:3000', list), false);
  });

  test('ws origin: empty allowed list → all rejected (except no-origin)', () => {
    assert.equal(_isAllowedWsOrigin('http://anything.com', '*', []), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rate limit: window boundary
  // ═══════════════════════════════════════════════════════════════════════

  test('rate limit: request exactly at MAX is allowed', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now, count: RATE_LIMIT_MAX });
    const r = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(r.allowed, true, 'count=120 should be allowed (not > 120)');
    assert.equal(r.status, 200);
  });

  test('rate limit: request at MAX+1 is rejected', () => {
    const map = new Map();
    const now = Date.now();
    map.set('1.1.1.1', { windowStart: now, count: RATE_LIMIT_MAX });
    // Make one more request to push to MAX+1
    checkRateLimit(map, '1.1.1.1', now); // count becomes 121
    const r = checkRateLimit(map, '1.1.1.1', now); // count becomes 122
    assert.equal(r.allowed, false);
    assert.equal(r.status, 429);
  });

  test('rate limit: new window after expiry resets count', () => {
    const map = new Map();
    const old = Date.now() - RATE_LIMIT_WINDOW_MS - 1000;
    map.set('1.1.1.1', { windowStart: old, count: RATE_LIMIT_MAX + 10 });
    const now = Date.now();
    const r = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(r.allowed, true, 'expired window should reset');
    assert.equal(r.status, 200);
    assert.equal(map.get('1.1.1.1').count, 1, 'count should start fresh at 1');
  });

  test('rate limit: entry exactly at window boundary starts new window', () => {
    const map = new Map();
    const boundaryTime = Date.now() - RATE_LIMIT_WINDOW_MS;
    map.set('1.1.1.1', { windowStart: boundaryTime, count: RATE_LIMIT_MAX });
    const now = Date.now();
    // now - boundaryTime = RATE_LIMIT_WINDOW_MS, which is NOT > RATE_LIMIT_WINDOW_MS
    // So the entry is still within window
    const r = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(r.allowed, true, 'boundary entry is still within window');
  });

  test('rate limit: entry 1ms past boundary starts new window', () => {
    const map = new Map();
    const pastBoundary = Date.now() - RATE_LIMIT_WINDOW_MS - 1;
    map.set('1.1.1.1', { windowStart: pastBoundary, count: RATE_LIMIT_MAX + 100 });
    const now = Date.now();
    const r = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(r.allowed, true, 'expired entry should reset');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rate limit: OOM guard (map at capacity)
  // ═══════════════════════════════════════════════════════════════════════

  test('rate limit: new IP when map at capacity evicts oldest', () => {
    const map = new Map();
    const now = Date.now();
    // Fill map to capacity
    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES; i++) {
      map.set(`ip-${i}`, { windowStart: now - i, count: 1 });
    }
    assert.equal(map.size, RATE_LIMIT_MAX_ENTRIES);

    // New IP should evict oldest (ip-(RATE_LIMIT_MAX_ENTRIES-1) has smallest windowStart)
    const r = checkRateLimit(map, 'new-ip', now);
    assert.equal(r.allowed, true, 'new IP should be allowed after eviction');
    assert.equal(map.size, RATE_LIMIT_MAX_ENTRIES, 'map size should stay at max');
    assert.ok(map.has('new-ip'), 'new IP should be in map');
  });

  test('rate limit: existing IP at capacity does not evict', () => {
    const map = new Map();
    const now = Date.now();
    // Fill to capacity including our test IP
    map.set('1.1.1.1', { windowStart: now, count: 1 });
    for (let i = 1; i < RATE_LIMIT_MAX_ENTRIES; i++) {
      map.set(`ip-${i}`, { windowStart: now - i, count: 1 });
    }
    assert.equal(map.size, RATE_LIMIT_MAX_ENTRIES);

    // Existing IP re-request should not trigger eviction
    const r = checkRateLimit(map, '1.1.1.1', now);
    assert.equal(r.allowed, true);
    assert.equal(map.get('1.1.1.1').count, 2, 'count should increment');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rate limit: cleanup
  // ═══════════════════════════════════════════════════════════════════════

  test('cleanup: removes only expired entries', () => {
    const map = new Map();
    const now = Date.now();
    map.set('expired-1', { windowStart: now - RATE_LIMIT_WINDOW_MS - 5000, count: 50 });
    map.set('expired-2', { windowStart: now - RATE_LIMIT_WINDOW_MS - 1, count: 100 });
    map.set('active-1', { windowStart: now - RATE_LIMIT_WINDOW_MS + 1000, count: 10 });
    map.set('active-2', { windowStart: now, count: 5 });
    cleanupRateLimit(map);
    assert.equal(map.has('expired-1'), false);
    assert.equal(map.has('expired-2'), false);
    assert.equal(map.has('active-1'), true);
    assert.equal(map.has('active-2'), true);
  });

  test('cleanup: empty map → no error', () => {
    const map = new Map();
    cleanupRateLimit(map);
    assert.equal(map.size, 0);
  });

  test('cleanup: over max entries evicts oldest', () => {
    const map = new Map();
    const now = Date.now();
    // Add RATE_LIMIT_MAX_ENTRIES + 100 entries with varying windowStart
    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES + 100; i++) {
      map.set(`ip-${i}`, { windowStart: now - (RATE_LIMIT_MAX_ENTRIES - i), count: 1 });
    }
    cleanupRateLimit(map);
    assert.ok(map.size <= RATE_LIMIT_MAX_ENTRIES, `map should be at most ${RATE_LIMIT_MAX_ENTRIES}, got ${map.size}`);
    // Oldest entries (smallest windowStart) should be evicted
    assert.equal(map.has('ip-0'), false, 'oldest entry should be evicted');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rate limit: first request for new IP
  // ═══════════════════════════════════════════════════════════════════════

  test('rate limit: first request creates entry with count=1', () => {
    const map = new Map();
    const now = Date.now();
    const r = checkRateLimit(map, '10.0.0.1', now);
    assert.equal(r.allowed, true);
    const entry = map.get('10.0.0.1');
    assert.equal(entry.count, 1);
    assert.equal(entry.windowStart, now);
  });

  test('rate limit: sequential requests increment count', () => {
    const map = new Map();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      checkRateLimit(map, '10.0.0.1', now);
    }
    assert.equal(map.get('10.0.0.1').count, 10);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Run
  // ═══════════════════════════════════════════════════════════════════════

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\nhunter-tw-ws-origin-rate: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
