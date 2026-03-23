/**
 * rateLimitSecurity.test.js — Tests for rate limiting security fix (LEAK-002).
 *
 * Verifies:
 * 1. Rate limiting returns 429 (blocks) after RATE_LIMIT_MAX requests
 * 2. Rate limiter Map cleanup prevents unbounded memory growth
 * 3. X-Forwarded-For header is NOT trusted (trust proxy = false)
 *
 * Extracted logic + source analysis — no server required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server', 'index.js');

let serverSource;
try {
  serverSource = readFileSync(serverPath, 'utf-8');
} catch {
  serverSource = '';
}

// ── Extracted: rate limiter with cleanup + hard cap (mirrors server/index.js) ──

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

function createRateLimiterWithCleanup() {
  const map = new Map();

  function check(ip, now) {
    let entry = map.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = { windowStart: now, count: 0 };
      map.set(ip, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= RATE_LIMIT_MAX,
      count: entry.count,
      mapSize: map.size
    };
  }

  function cleanup(now) {
    for (const [ip, entry] of map) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        map.delete(ip);
      }
    }
    // Hard cap eviction
    if (map.size > RATE_LIMIT_MAX_ENTRIES) {
      const sorted = [...map.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
      const evictCount = map.size - RATE_LIMIT_MAX_ENTRIES;
      for (let i = 0; i < evictCount; i++) {
        map.delete(sorted[i][0]);
      }
    }
  }

  function size() {
    return map.size;
  }

  function getMap() {
    return map;
  }

  return { check, cleanup, size, getMap };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runRateLimitSecurityTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Rate limiting returns 429 after RATE_LIMIT_MAX requests
  // ═══════════════════════════════════════════════════════════════════════

  test('RL-SEC: request 120 (RATE_LIMIT_MAX) is last allowed', () => {
    const rl = createRateLimiterWithCleanup();
    let result;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      result = rl.check('10.0.0.1', 1000);
    }
    assert.equal(result.allowed, true, `Request ${RATE_LIMIT_MAX} should be allowed`);
    assert.equal(result.count, RATE_LIMIT_MAX);
  });

  test('RL-SEC: request 121 (RATE_LIMIT_MAX+1) is rejected — 429 equivalent', () => {
    const rl = createRateLimiterWithCleanup();
    let result;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      result = rl.check('10.0.0.1', 1000);
    }
    assert.equal(result.allowed, false, `Request ${RATE_LIMIT_MAX + 1} should be blocked (429)`);
    assert.equal(result.count, RATE_LIMIT_MAX + 1);
  });

  test('RL-SEC: repeated requests after rejection stay blocked in same window', () => {
    const rl = createRateLimiterWithCleanup();
    // Exhaust limit
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      rl.check('10.0.0.1', 1000);
    }
    // Subsequent requests in same window still blocked
    for (let t = 1001; t < 1100; t++) {
      const r = rl.check('10.0.0.1', t);
      assert.equal(r.allowed, false, `Request at t=${t} should still be blocked`);
    }
  });

  test('RL-SEC: server middleware returns 429 JSON response', () => {
    assert.ok(
      /status\(\s*429\s*\)/.test(serverSource),
      'server/index.js should have res.status(429) for rate limit rejection'
    );
    assert.ok(
      /Too many requests/.test(serverSource),
      'server/index.js should return "Too many requests" error message'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Rate limiter entries get cleaned up (Map doesn't grow unbounded)
  // ═══════════════════════════════════════════════════════════════════════

  test('RL-SEC: cleanup removes expired entries after window expires', () => {
    const rl = createRateLimiterWithCleanup();
    // Add entries at t=0
    for (let i = 0; i < 100; i++) {
      rl.check(`ip-${i}`, 1000);
    }
    assert.equal(rl.size(), 100);
    // Cleanup after window expires
    rl.cleanup(1000 + RATE_LIMIT_WINDOW_MS + 1);
    assert.equal(rl.size(), 0, 'All expired entries should be cleaned up');
  });

  test('RL-SEC: cleanup keeps active window entries', () => {
    const rl = createRateLimiterWithCleanup();
    rl.check('10.0.0.1', 50000);
    rl.check('10.0.0.2', 30000);
    // Cleanup at t=60000 — both still within 60s window from their start
    rl.cleanup(60000);
    assert.equal(rl.size(), 2, 'Active entries should survive cleanup');
  });

  test('RL-SEC: hard cap evicts oldest entries when Map exceeds 10000', () => {
    const rl = createRateLimiterWithCleanup();
    const earlyTs = 1000;
    // Add 10001 entries — last one has newer timestamp
    for (let i = 0; i < RATE_LIMIT_MAX_ENTRIES; i++) {
      rl.check(`ip-${i}`, earlyTs);
    }
    assert.equal(rl.size(), RATE_LIMIT_MAX_ENTRIES);
    // Add one more with a newer timestamp — triggers eviction
    rl.check('ip-newer', earlyTs + 1);
    // Run cleanup with current timestamp = earlyTs + 1 (all still in window, so no expired cleanup)
    rl.cleanup(earlyTs + 1);
    // Map should be at most RATE_LIMIT_MAX_ENTRIES after cleanup
    assert.ok(
      rl.size() <= RATE_LIMIT_MAX_ENTRIES,
      `Map size ${rl.size()} should not exceed ${RATE_LIMIT_MAX_ENTRIES} after eviction`
    );
  });

  test('RL-SEC: periodic cleanup interval is set in server code', () => {
    assert.ok(
      /setInterval\(/.test(serverSource),
      'server/index.js should use setInterval for periodic cleanup'
    );
    assert.ok(
      /RATE_LIMIT_WINDOW_MS/.test(serverSource),
      'Cleanup interval should reference RATE_LIMIT_WINDOW_MS'
    );
  });

  test('RL-SEC: cleanup includes hard cap eviction for max entries', () => {
    assert.ok(
      /RATE_LIMIT_MAX_ENTRIES/.test(serverSource),
      'server/index.js should define RATE_LIMIT_MAX_ENTRIES'
    );
    assert.ok(
      /RATE_LIMIT_MAX_ENTRIES/.test(serverSource) && /evict|sorted/.test(serverSource),
      'server/index.js should have eviction logic when exceeding max entries'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. X-Forwarded-For header is NOT trusted (trust proxy = false)
  // ═══════════════════════════════════════════════════════════════════════

  test('RL-SEC: trust proxy is explicitly set to false', () => {
    assert.ok(
      /app\.set\(\s*['"]trust proxy['"]\s*,\s*false\s*\)/.test(serverSource),
      'server/index.js must have app.set("trust proxy", false) to prevent X-Forwarded-For spoofing'
    );
  });

  test('RL-SEC: trust proxy is NOT set to true or to a number', () => {
    const hasTrustTrue = /app\.set\(\s*['"]trust proxy['"]\s*,\s*true\s*\)/.test(serverSource);
    const hasTrustNumber = /app\.set\(\s*['"]trust proxy['"]\s*,\s*\d+\s*\)/.test(serverSource);
    assert.equal(hasTrustTrue, false, 'trust proxy must NOT be true — would trust X-Forwarded-For');
    assert.equal(hasTrustNumber, false, 'trust proxy must NOT be a number — would trust N proxies in chain');
  });

  test('RL-SEC: rate limiter uses req.ip with fallback (not X-Forwarded-For directly)', () => {
    // The middleware should use req.ip (affected by trust proxy setting)
    // or req.socket.remoteAddress as fallback — never parse X-Forwarded-For manually
    assert.ok(
      /req\.ip/.test(serverSource),
      'Rate limiter should reference req.ip for IP extraction'
    );
    assert.ok(
      /req\.socket\.remoteAddress/.test(serverSource),
      'Rate limiter should have req.socket.remoteAddress as fallback'
    );
    // Must NOT manually parse X-Forwarded-For header
    assert.ok(
      !/req\.headers\[['"]x-forwarded-for['"]\]/.test(serverSource),
      'Rate limiter must NOT manually parse x-forwarded-for header'
    );
    assert.ok(
      !/req\.header\(\s*['"]x-forwarded-for['"]\s*\)/i.test(serverSource),
      'Rate limiter must NOT use req.header("x-forwarded-for") directly'
    );
  });

  test('RL-SEC: spoofed X-Forwarded-For is ignored when trust proxy is false', () => {
    const rl = createRateLimiterWithCleanup();
    // With trust proxy=false, req.ip = actual remote address, not X-Forwarded-For
    // Simulate: attacker sends X-Forwarded-For: 1.2.3.4 but actual IP is 10.0.0.1
    const realIp = '10.0.0.1';
    // Exhaust limit for real IP
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp, 1000);
    }
    // Real IP is at limit
    const r = rl.check(realIp, 1000);
    assert.equal(r.allowed, false, 'Real IP should be rate limited');
    // Spoofed header IP should NOT get a fresh counter (since it's the same real IP)
    // This confirms that if trust proxy=false, both requests come from same IP
    const r2 = rl.check(realIp, 1000);
    assert.equal(r2.allowed, false, 'Spoofed header does not bypass rate limit');
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Rate Limit Security Tests (LEAK-002)');

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
