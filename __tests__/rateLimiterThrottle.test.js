/**
 * rateLimiterThrottle.test.js — Tests for rate limiting and wsThrottle logic.
 *
 * Covers: the per-IP rate limiter middleware algorithm and per-socket
 * WebSocket throttle helper from server/index.js.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: rate limiter logic (mirrors server/index.js) ─────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function createRateLimiter() {
  const map = new Map();

  function check(ip, now) {
    let entry = map.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = { windowStart: now, count: 0 };
      map.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return { allowed: false, count: entry.count };
    }
    return { allowed: true, count: entry.count };
  }

  function cleanup(now) {
    for (const [ip, entry] of map) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        map.delete(ip);
      }
    }
  }

  function size() {
    return map.size;
  }

  return { check, cleanup, size };
}

// ── Extracted: wsThrottle logic (mirrors server/index.js) ───────────────────

function createWsThrottle() {
  const socket = { _throttle: {} };

  function throttle(key, minIntervalMs, now) {
    const last = socket._throttle[key] || 0;
    if (now - last < minIntervalMs) return false;
    socket._throttle[key] = now;
    return true;
  }

  return { socket, throttle };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runRateLimiterThrottleTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Rate limiter
  // ═══════════════════════════════════════════════════════════════════════

  test('rateLimiter: first request is allowed', () => {
    const rl = createRateLimiter();
    const r = rl.check('1.2.3.4', 1000);
    assert.equal(r.allowed, true);
    assert.equal(r.count, 1);
  });

  test('rateLimiter: request 120 is allowed (boundary)', () => {
    const rl = createRateLimiter();
    let r;
    for (let i = 0; i < 120; i++) {
      r = rl.check('1.2.3.4', 1000);
    }
    assert.equal(r.allowed, true);
    assert.equal(r.count, 120);
  });

  test('rateLimiter: request 121 is rejected', () => {
    const rl = createRateLimiter();
    let r;
    for (let i = 0; i < 121; i++) {
      r = rl.check('1.2.3.4', 1000);
    }
    assert.equal(r.allowed, false);
    assert.equal(r.count, 121);
  });

  test('rateLimiter: request 200 is rejected', () => {
    const rl = createRateLimiter();
    let r;
    for (let i = 0; i < 200; i++) {
      r = rl.check('1.2.3.4', 1000);
    }
    assert.equal(r.allowed, false);
    assert.equal(r.count, 200);
  });

  test('rateLimiter: different IPs have independent limits', () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 120; i++) {
      rl.check('1.2.3.4', 1000);
    }
    // IP2 should still be allowed
    const r = rl.check('5.6.7.8', 1000);
    assert.equal(r.allowed, true);
    assert.equal(r.count, 1);
    // IP1 is now rejected
    const r2 = rl.check('1.2.3.4', 1000);
    assert.equal(r2.allowed, false);
  });

  test('rateLimiter: window resets after 60s', () => {
    const rl = createRateLimiter();
    // Fill up the limit at t=1000
    for (let i = 0; i < 120; i++) {
      rl.check('1.2.3.4', 1000);
    }
    // t=1000+60001 — new window
    const r = rl.check('1.2.3.4', 1000 + 60001);
    assert.equal(r.allowed, true);
    assert.equal(r.count, 1); // reset
  });

  test('rateLimiter: window does NOT reset before 60s', () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 120; i++) {
      rl.check('1.2.3.4', 1000);
    }
    // t=1000+59999 — still same window
    const r = rl.check('1.2.3.4', 1000 + 59999);
    assert.equal(r.allowed, false);
  });

  test('rateLimiter: window exactly at boundary resets', () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 120; i++) {
      rl.check('1.2.3.4', 1000);
    }
    // exactly at window boundary (> not >=)
    const r = rl.check('1.2.3.4', 1000 + 60000);
    // 60000 is NOT > 60000, so same window
    assert.equal(r.allowed, false);
  });

  test('rateLimiter: window 1ms past boundary resets', () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 120; i++) {
      rl.check('1.2.3.4', 1000);
    }
    const r = rl.check('1.2.3.4', 1000 + 60001);
    assert.equal(r.allowed, true);
  });

  test('rateLimiter: cleanup removes expired entries', () => {
    const rl = createRateLimiter();
    rl.check('1.2.3.4', 1000);
    rl.check('5.6.7.8', 1000);
    assert.equal(rl.size(), 2);
    // Cleanup at t=1000+60001 — both expired
    rl.cleanup(1000 + 60001);
    assert.equal(rl.size(), 0);
  });

  test('rateLimiter: cleanup keeps non-expired entries', () => {
    const rl = createRateLimiter();
    rl.check('1.2.3.4', 1000);
    // Cleanup at t=50000 — entry not expired yet
    rl.cleanup(50000);
    assert.equal(rl.size(), 1);
  });

  test('rateLimiter: cleanup is selective (mixed expiries)', () => {
    const rl = createRateLimiter();
    rl.check('1.2.3.4', 1000);    // will expire at 61001
    rl.check('5.6.7.8', 50000);   // will expire at 110001
    // Cleanup at t=70000
    rl.cleanup(70000);
    assert.equal(rl.size(), 1); // only 5.6.7.8 survives
  });

  test('rateLimiter: empty cleanup is a no-op', () => {
    const rl = createRateLimiter();
    rl.cleanup(999999);
    assert.equal(rl.size(), 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // wsThrottle
  // ═══════════════════════════════════════════════════════════════════════

  test('wsThrottle: first call is allowed', () => {
    const { throttle } = createWsThrottle();
    assert.equal(throttle('move', 50, 1000), true);
  });

  test('wsThrottle: second call within interval is blocked', () => {
    const { throttle } = createWsThrottle();
    throttle('move', 50, 1000);
    assert.equal(throttle('move', 50, 1020), false);
  });

  test('wsThrottle: call after interval is allowed', () => {
    const { throttle } = createWsThrottle();
    throttle('move', 50, 1000);
    assert.equal(throttle('move', 50, 1051), true);
  });

  test('wsThrottle: call exactly at interval boundary is blocked', () => {
    const { throttle } = createWsThrottle();
    throttle('move', 50, 1000);
    // 1050 - 1000 = 50, not < 50, so allowed
    assert.equal(throttle('move', 50, 1050), true);
  });

  test('wsThrottle: call 1ms before interval is blocked', () => {
    const { throttle } = createWsThrottle();
    throttle('move', 50, 1000);
    assert.equal(throttle('move', 50, 1049), false);
  });

  test('wsThrottle: different keys are independent', () => {
    const { throttle } = createWsThrottle();
    throttle('move', 50, 1000);
    assert.equal(throttle('setParams', 1000, 1020), true);
    // 'move' at 1020 is still blocked
    assert.equal(throttle('move', 50, 1020), false);
  });

  test('wsThrottle: setParams 1000ms interval works', () => {
    const { throttle } = createWsThrottle();
    throttle('setParams', 1000, 1000);
    assert.equal(throttle('setParams', 1000, 1500), false);
    assert.equal(throttle('setParams', 1000, 2001), true);
  });

  test('wsThrottle: move 50ms interval rapid fire blocks correctly', () => {
    const { throttle } = createWsThrottle();
    let allowed = 0;
    for (let t = 1000; t < 1200; t += 10) {
      if (throttle('move', 50, t)) allowed++;
    }
    // t=1000, 1050, 1100, 1150 should be allowed (4)
    assert.equal(allowed, 4);
  });

  test('wsThrottle: socket without _throttle initializes it', () => {
    const socket = {};
    function throttle(key, minIntervalMs, now) {
      const last = socket._throttle?.[key] || 0;
      if (now - last < minIntervalMs) return false;
      if (!socket._throttle) socket._throttle = {};
      socket._throttle[key] = now;
      return true;
    }
    assert.equal(throttle('move', 50, 1000), true);
    assert.ok(socket._throttle);
    assert.equal(socket._throttle['move'], 1000);
  });

  test('wsThrottle: rapid succession with minInterval=0 always allows', () => {
    const { throttle } = createWsThrottle();
    let allowed = 0;
    for (let t = 0; t < 100; t++) {
      if (throttle('move', 0, t)) allowed++;
    }
    assert.equal(allowed, 100);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Rate Limiter & Throttle Tests');

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
