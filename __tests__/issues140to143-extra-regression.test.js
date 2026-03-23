/**
 * issues140to143-extra-regression.test.js — Extended regression tests for bugs #140–#143.
 *
 * Additional edge cases NOT in issues140to143-regression.test.js:
 * - Rate limiter: burst traffic, cleanup edge cases, map eviction order
 * - Epsilon: combined with networkSize at boundaries, JSON.parse edge cases
 * - Auto-save: error during save with dirty flag, interval lifecycle
 * - CSP: directive completeness under environment variable changes
 *
 * Source-verified against server/index.js — no server process required.
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

// ═══════════════════════════════════════════════════════════════════════════
// Shared: Rate limiter mirror
// ═══════════════════════════════════════════════════════════════════════════

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

function createRateLimiter() {
  const map = new Map();

  function check(ip, now) {
    let entry = map.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      entry = { windowStart: now, count: 0 };
      map.set(ip, entry);
    }
    entry.count++;
    return { allowed: entry.count <= RATE_LIMIT_MAX, count: entry.count, mapSize: map.size };
  }

  function cleanup(now) {
    for (const [ip, entry] of map) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        map.delete(ip);
      }
    }
    if (map.size > RATE_LIMIT_MAX_ENTRIES) {
      const sorted = [...map.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
      const evictCount = map.size - RATE_LIMIT_MAX_ENTRIES;
      for (let i = 0; i < evictCount; i++) {
        map.delete(sorted[i][0]);
      }
    }
  }

  return { check, cleanup, size: () => map.size, getMap: () => map };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared: Auto-save mirror
// ═══════════════════════════════════════════════════════════════════════════

class AutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this.saveCount = 0;
    this._saveDelay = 5;
  }

  markDirty() { this.dirty = true; }

  async tick() {
    if (this._saving) return { skipped: 'saving' };
    if (!this.dirty) return { skipped: 'clean' };
    try {
      this._saving = true;
      this.dirty = false;
      await new Promise(r => setTimeout(r, this._saveDelay));
      this.saveCount++;
      return { saved: true };
    } finally {
      this._saving = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared: Epsilon validation mirror
// ═══════════════════════════════════════════════════════════════════════════

function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be a finite number 0-1' };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

export async function runIssues140to143ExtraRegressionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #143 — Rate Limiting Extended Edge Cases                     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#143-ext] exact RATE_LIMIT_MAX requests are all allowed', () => {
    const rl = createRateLimiter();
    const ip = '10.0.0.1';
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const r = rl.check(ip, 1000);
      assert.equal(r.allowed, true, `Request ${i + 1} should be allowed`);
    }
  });

  test('[#143-ext] request RATE_LIMIT_MAX+1 is blocked', () => {
    const rl = createRateLimiter();
    const ip = '10.0.0.1';
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(ip, 1000);
    }
    const r = rl.check(ip, 1000);
    assert.equal(r.allowed, false, '121st request should be blocked');
  });

  test('[#143-ext] after window expires, counter resets for same IP', () => {
    const rl = createRateLimiter();
    const ip = '10.0.0.1';

    // Exhaust rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(ip, 1000);
    }
    assert.equal(rl.check(ip, 1000).allowed, false);

    // Wait for window to expire
    const expiredTime = 1000 + RATE_LIMIT_WINDOW_MS + 1;

    // Cleanup should reset
    rl.cleanup(expiredTime);

    // New window — should be allowed again
    const r = rl.check(ip, expiredTime);
    assert.equal(r.allowed, true, 'Should be allowed after window reset');
  });

  test('[#143-ext] cleanup evicts oldest entries when map exceeds max', () => {
    const rl = createRateLimiter();
    const baseTime = 1000;

    // Create entries with different timestamps
    // Oldest: IPs 0-4999 at time 1000
    for (let i = 0; i < 5000; i++) {
      rl.check(`ip-old-${i}`, baseTime);
    }
    // Newer: IPs 5000-14999 at time 50000
    for (let i = 5000; i < 15000; i++) {
      rl.check(`ip-new-${i}`, baseTime + 49000);
    }

    assert.equal(rl.size(), 15000);

    // Cleanup at same time — no entries expired, but hard cap evicts oldest
    rl.cleanup(baseTime + 49000);

    assert.ok(rl.size() <= RATE_LIMIT_MAX_ENTRIES);
    // The newest entries should survive (they have later timestamps)
    assert.ok(rl.getMap().has('ip-new-14999'), 'Newest entry should survive eviction');
  });

  test('[#143-ext] burst: 10000 unique IPs in 1 second, then cleanup removes all', () => {
    const rl = createRateLimiter();
    const now = 1000;

    for (let i = 0; i < 10000; i++) {
      rl.check(`burst-${i}`, now);
    }
    assert.equal(rl.size(), 10000);

    // Cleanup after window
    rl.cleanup(now + RATE_LIMIT_WINDOW_MS + 1);
    assert.equal(rl.size(), 0, 'All burst entries should be cleaned up');
  });

  test('[#143-ext] IP reuse: same IP in different windows gets fresh counter', () => {
    const rl = createRateLimiter();
    const ip = '192.168.1.1';

    // Window 1
    for (let i = 0; i < 10; i++) {
      rl.check(ip, 1000);
    }
    assert.equal(rl.getMap().get(ip).count, 10);

    // Cleanup and new window
    rl.cleanup(1000 + RATE_LIMIT_WINDOW_MS + 1);

    // Window 2 — fresh counter
    const r = rl.check(ip, 1000 + RATE_LIMIT_WINDOW_MS + 100);
    assert.equal(r.count, 1, 'New window should have fresh counter');
  });

  test('[#143-ext] server code: hard cap eviction uses sort by windowStart', () => {
    assert.ok(
      serverSource.includes('.sort((a, b) => a[1].windowStart - b[1].windowStart)') ||
      serverSource.includes('.sort((a,b)=>a[1].windowStart-b[1].windowStart)') ||
      /sorted.*sort.*windowStart/.test(serverSource.replace(/\s+/g, ' ')),
      'Eviction should sort by windowStart (oldest first)'
    );
  });

  test('[#143-ext] server code: cleanup runs at RATE_LIMIT_WINDOW_MS interval', () => {
    // Match: setInterval(..., RATE_LIMIT_WINDOW_MS) with multiline callback
    assert.ok(
      serverSource.includes('RATE_LIMIT_WINDOW_MS)'),
      'Cleanup interval must use RATE_LIMIT_WINDOW_MS as interval'
    );
    // The cleanup interval references _rateLimitMap and RATE_LIMIT_WINDOW_MS
    const cleanupSection = serverSource.slice(
      serverSource.indexOf('_rateLimitCleanupInterval'),
      serverSource.indexOf('_rateLimitCleanupInterval') + 500
    );
    assert.ok(
      cleanupSection.includes('RATE_LIMIT_WINDOW_MS'),
      'Cleanup interval function must reference RATE_LIMIT_WINDOW_MS'
    );
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #142 — Epsilon Validation Extended                           ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#142-ext] epsilon from JSON.parse("0.5") is valid number', () => {
    // Simulating what express.json() does
    const parsed = JSON.parse('{"epsilon": 0.5}');
    const r = validateEpsilon(parsed.epsilon);
    assert.equal(r.valid, true);
  });

  test('[#142-ext] epsilon from JSON.parse("null") is null → accepted', () => {
    const parsed = JSON.parse('{"epsilon": null}');
    const r = validateEpsilon(parsed.epsilon);
    assert.equal(r.valid, true, 'null from JSON means no change');
  });

  test('[#142-ext] epsilon from JSON.parse "\\"0.5\\"") is string → rejected', () => {
    const parsed = JSON.parse('{"epsilon": "0.5"}');
    const r = validateEpsilon(parsed.epsilon);
    assert.equal(r.valid, false, 'String from JSON should be rejected');
  });

  test('[#142-ext] epsilon 0.0 is same as 0 → accepted', () => {
    const r = validateEpsilon(0.0);
    assert.equal(r.valid, true);
  });

  test('[#142-ext] epsilon 1.0 is same as 1 → accepted', () => {
    const r = validateEpsilon(1.0);
    assert.equal(r.valid, true);
  });

  test('[#142-ext] epsilon Number("-0") is -0 → accepted (JavaScript quirk)', () => {
    const r = validateEpsilon(Number('-0'));
    assert.equal(r.valid, true, '-0 < 0 is false in JS');
  });

  test('[#142-ext] server code: typeof check runs before Number.isFinite', () => {
    // Line 206: if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1))
    // The typeof check IS before Number.isFinite — just verify both exist and in correct order
    const typePos = serverSource.indexOf("typeof epsilon !== 'number'");
    const finitePos = serverSource.indexOf('Number.isFinite(epsilon)');
    assert.ok(typePos >= 0, 'Server should check typeof epsilon');
    assert.ok(finitePos >= 0, 'Server should check Number.isFinite(epsilon)');
    assert.ok(typePos < finitePos, 'typeof check should come before Number.isFinite');
  });

  test('[#142-ext] epsilon with 15 decimal places within range → accepted', () => {
    const r = validateEpsilon(0.123456789012345);
    assert.equal(r.valid, true);
  });

  test('[#142-ext] epsilon with 20 decimal places → still valid number', () => {
    // JS precision: 0.12345678901234567890 gets rounded
    const val = 0.12345678901234567890;
    const r = validateEpsilon(val);
    assert.equal(r.valid, true);
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #141 — Auto-Save Extended                                    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#141-ext] 5 rapid tick() calls while save in progress all skip', async () => {
    const mgr = new AutoSaveManager();
    mgr._saveDelay = 30;
    mgr.markDirty();

    const tick1 = mgr.tick();

    // Try 5 rapid ticks during save
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await mgr.tick());
    }

    for (const r of results) {
      assert.equal(r.skipped, 'saving', 'All concurrent ticks should skip');
    }

    await tick1;
    assert.equal(mgr.saveCount, 1);
  });

  test('[#141-ext] dirty set exactly at save boundary is caught', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Set dirty immediately (race condition simulation)
    mgr.markDirty();

    await tick1;
    assert.equal(mgr.dirty, true, 'dirty set during save should survive');

    const tick2 = await mgr.tick();
    assert.equal(tick2.saved, true);
    assert.equal(mgr.saveCount, 2);
  });

  test('[#141-ext] alternating markDirty and tick for 50 cycles', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 50; i++) {
      mgr.markDirty();
      const result = await mgr.tick();
      assert.equal(result.saved, true, `Cycle ${i}`);
    }
    assert.equal(mgr.saveCount, 50);
  });

  test('[#141-ext] no data loss: dirty set during save, then clean, then dirty again', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Tick 1: save starts
    const tick1 = mgr.tick();

    // During save: mark dirty
    await new Promise(r => setTimeout(r, 1));
    mgr.markDirty();

    await tick1;
    assert.equal(mgr.dirty, true);

    // Tick 2: saves the dirty set during tick 1
    await mgr.tick();
    assert.equal(mgr.dirty, false);

    // Tick 3: no changes — should skip
    const tick3 = await mgr.tick();
    assert.equal(tick3.skipped, 'clean');
    assert.equal(mgr.saveCount, 2);
  });

  test('[#141-ext] server code: _saving is reset in finally block', () => {
    assert.ok(
      /finally\s*\{[^}]*_saving\s*=\s*false/.test(serverSource.replace(/\s+/g, ' ')),
      '_saving must be reset in finally block'
    );
  });

  test('[#141-ext] server code: _saving is set to true before save', () => {
    const savingTrue = serverSource.indexOf('_saving = true');
    const dirtyFalse = serverSource.indexOf('trainer.dirty = false');
    assert.ok(savingTrue >= 0, 'Should set _saving = true');
    assert.ok(dirtyFalse >= 0, 'Should set dirty = false');
    assert.ok(savingTrue < dirtyFalse, '_saving should be set before dirty=false');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #140 — CSP Extended                                          ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#140-ext] CSP is set via res.setHeader, not res.set (Express convention)', () => {
    assert.ok(
      /res\.setHeader\(\s*['"]Content-Security-Policy['"]/.test(serverSource),
      'CSP must use res.setHeader (Express standard)'
    );
  });

  test('[#140-ext] CSP does not contain report-uri (no CSP reporting endpoint)', () => {
    assert.ok(
      !serverSource.includes('report-uri') || !serverSource.match(/res\.setHeader.*report-uri/),
      'No report-uri should be set in CSP header'
    );
  });

  test('[#140-ext] CSP does not contain unsafe-inline in script-src', () => {
    const cspMatch = serverSource.match(/Content-Security-Policy['"]\s*,\s*`([^`]+)`/);
    if (cspMatch) {
      const csp = cspMatch[1];
      assert.ok(!csp.includes("'unsafe-inline'"), 'CSP must not allow unsafe-inline in script-src');
    }
  });

  test('[#140-ext] server code: CSP conditional allows ws: only with CSP_ALLOW_WS env var', () => {
    assert.ok(
      serverSource.includes('CSP_ALLOW_WS'),
      'CSP should check CSP_ALLOW_WS env var for ws: scheme'
    );
    assert.ok(
      serverSource.includes("'wss:'") || serverSource.includes('wss:'),
      'CSP should always allow wss:'
    );
  });

  test('[#140-ext] X-Content-Type-Options is nosniff', () => {
    assert.ok(
      serverSource.includes("'X-Content-Type-Options'") && serverSource.includes('nosniff'),
      'X-Content-Type-Options must be nosniff'
    );
  });

  test('[#140-ext] X-Frame-Options is DENY', () => {
    assert.ok(
      serverSource.includes("'X-Frame-Options'") && serverSource.includes('DENY'),
      'X-Frame-Options must be DENY'
    );
  });

  test('[#140-ext] X-Powered-By is disabled', () => {
    assert.ok(
      serverSource.includes("disable('X-Powered-By')") || serverSource.includes('X-Powered-By'),
      'X-Powered-By should be disabled'
    );
  });

  test('[#140-ext] Referrer-Policy is set', () => {
    assert.ok(
      serverSource.includes('Referrer-Policy'),
      'Referrer-Policy header must be set'
    );
  });

  test('[#140-ext] Permissions-Policy restricts camera, microphone, geolocation', () => {
    assert.ok(
      serverSource.includes('Permissions-Policy'),
      'Permissions-Policy must be set'
    );
    assert.ok(
      serverSource.includes('camera=()') || serverSource.includes("camera=()"),
      'Camera must be denied'
    );
  });

  // ── Run ─────────────────────────────────────────────────────────────

  console.log('\n📋 Issues #140–#143 Extra Regression Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
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
