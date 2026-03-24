/**
 * rateLimit-spoofed-xff.test.js — Tests for rate limiting behavior when
 * attackers attempt to bypass limits using spoofed X-Forwarded-For headers.
 *
 * The server sets `trust proxy = false`, so Express ignores X-Forwarded-For
 * and uses req.socket.remoteAddress. This test suite verifies:
 * 1. Spoofed X-Forwarded-For does NOT create separate rate limit buckets
 * 2. trust proxy = false is properly enforced in source code
 * 3. Rate limiter tracks by real IP, not by spoofed header
 * 4. Multiple spoofed IPs from same real connection → same bucket
 * 5. No manual parsing of X-Forwarded-For header anywhere
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

// ── Extracted: rate limiter (mirrors server/index.js) ───────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function createRateLimiter() {
  const map = new Map();

  // Simulates Express middleware with trust proxy = false
  // req.ip = req.socket.remoteAddress (real IP, not X-Forwarded-For)
  function check(ip, now = Date.now()) {
    let entry = map.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = { windowStart: now, count: 0 };
      map.set(ip, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= RATE_LIMIT_MAX,
      count: entry.count,
      remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
      ip,
    };
  }

  function size() { return map.size; }
  function getEntry(ip) { return map.get(ip); }

  return { check, size, getEntry, map };
}

// Simulates Express behavior with trust proxy = false
function getRealIp(req) {
  // With trust proxy = false, Express ignores X-Forwarded-For entirely
  // req.ip = req.socket.remoteAddress
  return req.socket.remoteAddress;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runRateLimitSpoofedXffTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Source code: trust proxy = false is set
  // ═══════════════════════════════════════════════════════════════════════

  test('source: app.set("trust proxy", false) is present', () => {
    assert.ok(
      /app\.set\(\s*['"]trust proxy['"]\s*,\s*false\s*\)/.test(serverSource),
      'Must set trust proxy to false'
    );
  });

  test('source: trust proxy is NOT true', () => {
    assert.equal(
      /app\.set\(\s*['"]trust proxy['"]\s*,\s*true\s*\)/.test(serverSource),
      false,
      'trust proxy must NOT be true'
    );
  });

  test('source: trust proxy is NOT a number (e.g. 1)', () => {
    assert.equal(
      /app\.set\(\s*['"]trust proxy['"]\s*,\s*\d+\s*\)/.test(serverSource),
      false,
      'trust proxy must NOT be a number'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Source code: no manual X-Forwarded-For parsing
  // ═══════════════════════════════════════════════════════════════════════

  test('source: rate limiter does NOT read x-forwarded-for header', () => {
    const rateLimitSection = serverSource.slice(
      serverSource.indexOf('const _rateLimitMap'),
      serverSource.indexOf('app.use(express.json')
    );
    assert.ok(
      !/req\.headers?\[['"]x-forwarded-for['"]\]/i.test(rateLimitSection),
      'Rate limiter must not parse x-forwarded-for directly'
    );
    assert.ok(
      !/req\.header\(\s*['"]x-forwarded-for['"]\s*\)/i.test(rateLimitSection),
      'Rate limiter must not use req.header("x-forwarded-for")'
    );
    assert.ok(
      !/split\(\s*['"],['"]\s*\)/.test(rateLimitSection),
      'Rate limiter should not split comma-separated proxy chains'
    );
  });

  test('source: rate limiter uses req.ip (affected by trust proxy setting)', () => {
    assert.ok(
      /req\.ip/.test(serverSource),
      'Rate limiter should use req.ip'
    );
  });

  test('source: rate limiter has remoteAddress fallback', () => {
    assert.ok(
      /req\.socket\.remoteAddress/.test(serverSource),
      'Rate limiter should have req.socket.remoteAddress fallback'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Simulate: spoofed X-Forwarded-For does NOT bypass rate limit
  // ═══════════════════════════════════════════════════════════════════════

  test('spoofed X-Forwarded-For with trust=false → real IP is rate limited', () => {
    const rl = createRateLimiter();
    const realIp = '192.168.1.100';

    // Attacker exhausts limit on real IP
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp);
    }

    // Attacker sends request with spoofed X-Forwarded-For
    // With trust=false, Express uses real IP regardless of header
    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '1.2.3.4' },
    };
    const ip = getRealIp(req);
    const result = rl.check(ip);

    assert.equal(result.allowed, false, 'Should be blocked — same real IP');
    assert.equal(ip, realIp, 'IP should be real address, not spoofed');
  });

  test('attacker rotates 1000 different X-Forwarded-For values → still blocked', () => {
    const rl = createRateLimiter();
    const realIp = '10.0.0.50';

    // Exhaust limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp);
    }

    // Try 1000 different spoofed IPs in X-Forwarded-For
    for (let i = 0; i < 1000; i++) {
      const spoofedIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const req = {
        socket: { remoteAddress: realIp },
        headers: { 'x-forwarded-for': spoofedIp },
      };
      const ip = getRealIp(req);
      const result = rl.check(ip);
      assert.equal(result.allowed, false, `Spoofed ${spoofedIp} should not bypass — real IP still limited`);
    }

    // Only 1 entry in the map (the real IP)
    assert.equal(rl.size(), 1, 'Should have exactly 1 rate limit entry');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Multiple connections from same real IP share the same bucket
  // ═══════════════════════════════════════════════════════════════════════

  test('same real IP with different X-Forwarded-For → same bucket', () => {
    const rl = createRateLimiter();
    const realIp = '172.16.0.1';

    // 60 requests with spoofed IP A
    for (let i = 0; i < 60; i++) {
      const req = { socket: { remoteAddress: realIp }, headers: { 'x-forwarded-for': '8.8.8.8' } };
      rl.check(getRealIp(req));
    }

    // 60 requests with spoofed IP B
    for (let i = 0; i < 60; i++) {
      const req = { socket: { remoteAddress: realIp }, headers: { 'x-forwarded-for': '1.1.1.1' } };
      rl.check(getRealIp(req));
    }

    // 1 more → should be blocked (121st request from same real IP)
    const req = { socket: { remoteAddress: realIp }, headers: { 'x-forwarded-for': '9.9.9.9' } };
    const result = rl.check(getRealIp(req));
    assert.equal(result.allowed, false, '121st request should be blocked');
    assert.equal(result.count, 121);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Different real IPs are properly isolated
  // ═══════════════════════════════════════════════════════════════════════

  test('different real IPs have independent rate limit buckets', () => {
    const rl = createRateLimiter();

    // Exhaust limit for IP A
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check('10.0.0.1');
    }
    const r1 = rl.check('10.0.0.1');
    assert.equal(r1.allowed, false, 'IP A should be blocked');

    // IP B should still have full budget
    const r2 = rl.check('10.0.0.2');
    assert.equal(r2.allowed, true, 'IP B should be allowed');
    assert.equal(r2.count, 1, 'IP B count starts at 1');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. X-Forwarded-For chain format (multiple proxies)
  // ═══════════════════════════════════════════════════════════════════════

  test('X-Forwarded-For with proxy chain "ip1, ip2, ip3" → ignored', () => {
    const rl = createRateLimiter();
    const realIp = '192.168.1.1';

    // Exhaust limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp);
    }

    // Attacker sends proxy chain header
    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '4.4.4.4, 5.5.5.5, 6.6.6.6' },
    };
    const ip = getRealIp(req);
    const result = rl.check(ip);

    assert.equal(result.allowed, false, 'Proxy chain header should not bypass');
    assert.equal(ip, realIp, 'Should use real IP, not header');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. IPv6 spoofing
  // ═══════════════════════════════════════════════════════════════════════

  test('IPv6 X-Forwarded-For with IPv4 real IP → real IP used', () => {
    const rl = createRateLimiter();
    const realIp = '192.168.1.50';

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp);
    }

    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
    };
    const ip = getRealIp(req);
    const result = rl.check(ip);

    assert.equal(result.allowed, false);
    assert.equal(ip, realIp);
  });

  test('IPv6 real IP with IPv4 spoofed X-Forwarded-For → real IPv6 used', () => {
    const rl = createRateLimiter();
    const realIp = '::ffff:192.168.1.1';

    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp);
    }

    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '8.8.8.8' },
    };
    const ip = getRealIp(req);
    const result = rl.check(ip);

    assert.equal(result.allowed, false);
    assert.equal(ip, realIp);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Empty / missing X-Forwarded-For
  // ═══════════════════════════════════════════════════════════════════════

  test('no X-Forwarded-For header → works normally (real IP used)', () => {
    const rl = createRateLimiter();
    const realIp = '10.0.0.1';

    const req = {
      socket: { remoteAddress: realIp },
      headers: {},
    };
    const ip = getRealIp(req);
    assert.equal(ip, realIp);

    const result = rl.check(ip);
    assert.equal(result.allowed, true);
  });

  test('empty X-Forwarded-For header → real IP used', () => {
    const rl = createRateLimiter();
    const realIp = '10.0.0.2';

    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '' },
    };
    const ip = getRealIp(req);
    assert.equal(ip, realIp);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Window reset allows new requests
  // ═══════════════════════════════════════════════════════════════════════

  test('after window expires, same real IP gets fresh budget (even with spoofed header)', () => {
    const rl = createRateLimiter();
    const realIp = '10.0.0.100';
    const t0 = 1000;

    // Exhaust at t=1000
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp, t0);
    }
    assert.equal(rl.check(realIp, t0).allowed, false);

    // After window (t=1000 + 60001), fresh budget
    const t1 = t0 + RATE_LIMIT_WINDOW_MS + 1;
    const req = {
      socket: { remoteAddress: realIp },
      headers: { 'x-forwarded-for': '99.99.99.99' },
    };
    const result = rl.check(getRealIp(req), t1);
    assert.equal(result.allowed, true, 'New window should grant fresh budget');
    assert.equal(result.count, 1);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Rate Limit — Spoofed X-Forwarded-For Tests');

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
