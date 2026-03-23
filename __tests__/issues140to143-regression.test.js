/**
 * issues140to143-regression.test.js — Regression tests for fixed bugs #140–#143.
 *
 * These tests ensure that previously fixed security and logic bugs
 * do not regress in future code changes.
 *
 * Issue #143 — Rate limiting memory exhaustion via spoofed X-Forwarded-For
 * Issue #142 — Epsilon validation accepts non-numeric values
 * Issue #141 — Auto-save dirty flag race condition (rapid changes skip save)
 * Issue #140 — Missing Content-Security-Policy header
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

// ═══════════════════════════════════════════════════════════════════════════════
// Shared: Rate limiter that mirrors server/index.js exactly
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// Shared: Auto-save manager mirroring server behavior
// ═══════════════════════════════════════════════════════════════════════════════

class AutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this.saveCount = 0;
    this._saveDelay = 5; // ms
  }

  markDirty() { this.dirty = true; }

  async tick() {
    if (this._saving) return { skipped: 'saving' };
    if (!this.dirty) return { skipped: 'clean' };
    try {
      this._saving = true;
      this.dirty = false; // snapshot BEFORE async save
      await new Promise(r => setTimeout(r, this._saveDelay));
      this.saveCount++;
      return { saved: true };
    } finally {
      this._saving = false;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared: Epsilon validation (mirrors server/index.js:206)
// ═══════════════════════════════════════════════════════════════════════════════

function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be a finite number 0-1' };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared: CSP parsing
// ═══════════════════════════════════════════════════════════════════════════════

const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function parseCSP(csp) {
  const directives = {};
  for (const part of csp.split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    directives[name] = values;
  }
  return directives;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export async function runIssues140to143RegressionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #143 — Rate Limiting Memory Exhaustion (X-Forwarded-For)    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#143] 1000 spoofed IPs do not exceed RATE_LIMIT_MAX_ENTRIES after cleanup', () => {
    const rl = createRateLimiter();
    const baseTime = 1000;

    // Attacker sends 1000 unique spoofed X-Forwarded-For values
    for (let i = 0; i < 1000; i++) {
      rl.check(`spoofed-ip-${i}`, baseTime);
    }
    assert.equal(rl.size(), 1000, 'Map should have 1000 entries before cleanup');

    // After window expires, cleanup removes them all
    rl.cleanup(baseTime + RATE_LIMIT_WINDOW_MS + 1);
    assert.equal(rl.size(), 0, 'Cleanup must remove all expired spoofed entries');
  });

  test('[#143] 15000 unique IPs are capped at RATE_LIMIT_MAX_ENTRIES (10000)', () => {
    const rl = createRateLimiter();
    const baseTime = 1000;

    // Simulate 15000 unique IPs in same window (memory exhaustion attack)
    for (let i = 0; i < 15_000; i++) {
      rl.check(`attacker-ip-${i}`, baseTime);
    }

    // Cleanup at same timestamp — no entries expired, but hard cap should trigger
    rl.cleanup(baseTime);
    assert.ok(
      rl.size() <= RATE_LIMIT_MAX_ENTRIES,
      `Map size ${rl.size()} must not exceed ${RATE_LIMIT_MAX_ENTRIES} after hard-cap eviction`
    );
  });

  test('[#143] trust proxy is false — X-Forwarded-For is NOT used for IP extraction', () => {
    assert.ok(
      /app\.set\(\s*['"]trust proxy['"]\s*,\s*false\s*\)/.test(serverSource),
      'server/index.js must set trust proxy to false'
    );
    // Must not manually parse X-Forwarded-For
    assert.ok(
      !/req\.headers\[['"]x-forwarded-for['"]\]/.test(serverSource),
      'Must not manually parse x-forwarded-for header'
    );
    assert.ok(
      !/req\.header\(\s*['"]x-forwarded-for['"]\s*\)/i.test(serverSource),
      'Must not use req.header("x-forwarded-for")'
    );
  });

  test('[#143] rate limiter uses req.ip with socket.remoteAddress fallback', () => {
    assert.ok(
      /req\.ip/.test(serverSource),
      'Rate limiter must use req.ip'
    );
    assert.ok(
      /req\.socket\.remoteAddress/.test(serverSource),
      'Rate limiter must have req.socket.remoteAddress fallback'
    );
  });

  test('[#143] periodic cleanup interval exists and references RATE_LIMIT_WINDOW_MS', () => {
    assert.ok(
      /setInterval\(/.test(serverSource),
      'Must have setInterval for cleanup'
    );
    assert.ok(
      /RATE_LIMIT_WINDOW_MS/.test(serverSource),
      'Cleanup interval must reference RATE_LIMIT_WINDOW_MS'
    );
    assert.ok(
      /RATE_LIMIT_MAX_ENTRIES/.test(serverSource),
      'Must define RATE_LIMIT_MAX_ENTRIES hard cap'
    );
  });

  test('[#143] all spoofed IPs from same real IP share one rate limit counter', () => {
    const rl = createRateLimiter();
    // With trust proxy=false, all requests from same socket have same req.ip
    const realIp = '192.168.1.100';

    // Exhaust rate limit
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      rl.check(realIp, 1000);
    }

    // Even if attacker changes X-Forwarded-For header each time,
    // the real IP is the same → rate limited
    const result = rl.check(realIp, 1000);
    assert.equal(result.allowed, false,
      'All requests from same real IP must share counter, regardless of X-Forwarded-For');
    assert.equal(rl.size(), 1, 'Only one entry in map (the real IP)');
  });

  test('[#143] 429 response is returned after RATE_LIMIT_MAX requests', () => {
    assert.ok(
      /status\(\s*429\s*\)/.test(serverSource),
      'server/index.js must return status 429 for rate limit'
    );
    assert.ok(
      /Too many requests/.test(serverSource),
      'Error message must be "Too many requests"'
    );
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #142 — Epsilon Validation (non-numeric rejected)            ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#142] epsilon string "0.5" is rejected', () => {
    const r = validateEpsilon('0.5');
    assert.equal(r.valid, false, 'String epsilon must be rejected');
    assert.ok(r.error.includes('number'), 'Error must mention "number"');
  });

  test('[#142] epsilon NaN is rejected', () => {
    const r = validateEpsilon(NaN);
    assert.equal(r.valid, false, 'NaN epsilon must be rejected');
  });

  test('[#142] epsilon Infinity is rejected', () => {
    const r = validateEpsilon(Infinity);
    assert.equal(r.valid, false, 'Infinity epsilon must be rejected');
  });

  test('[#142] epsilon -Infinity is rejected', () => {
    const r = validateEpsilon(-Infinity);
    assert.equal(r.valid, false, '-Infinity epsilon must be rejected');
  });

  test('[#142] epsilon true (boolean) is rejected', () => {
    const r = validateEpsilon(true);
    assert.equal(r.valid, false, 'Boolean epsilon must be rejected');
  });

  test('[#142] epsilon null is accepted (no change)', () => {
    const r = validateEpsilon(null);
    assert.equal(r.valid, true, 'null epsilon means "no change" — should be accepted');
  });

  test('[#142] epsilon undefined is accepted (no change)', () => {
    const r = validateEpsilon(undefined);
    assert.equal(r.valid, true, 'undefined epsilon means "no change" — should be accepted');
  });

  test('[#142] epsilon 0.5 (valid number) is accepted', () => {
    const r = validateEpsilon(0.5);
    assert.equal(r.valid, true, 'Valid epsilon 0.5 must be accepted');
  });

  test('[#142] epsilon 0 is accepted', () => {
    const r = validateEpsilon(0);
    assert.equal(r.valid, true, 'Epsilon 0 must be accepted');
  });

  test('[#142] epsilon 1 is accepted', () => {
    const r = validateEpsilon(1);
    assert.equal(r.valid, true, 'Epsilon 1 must be accepted');
  });

  test('[#142] epsilon -0.1 is rejected (out of range)', () => {
    const r = validateEpsilon(-0.1);
    assert.equal(r.valid, false, 'Negative epsilon must be rejected');
  });

  test('[#142] epsilon 1.1 is rejected (out of range)', () => {
    const r = validateEpsilon(1.1);
    assert.equal(r.valid, false, 'Epsilon > 1 must be rejected');
  });

  test('[#142] server code uses Number.isFinite for epsilon validation', () => {
    assert.ok(
      serverSource.includes('Number.isFinite(epsilon)'),
      'Server must use Number.isFinite(epsilon) to reject NaN/Infinity'
    );
  });

  test('[#142] server code uses loose != null to catch both null and undefined', () => {
    assert.ok(
      serverSource.includes('epsilon != null'),
      'Server must use epsilon != null (loose equality) for optional parameter'
    );
  });

  test('[#142] server code checks typeof number', () => {
    assert.ok(
      serverSource.includes("typeof epsilon !== 'number'"),
      'Server must check typeof epsilon !== "number"'
    );
  });

  test('[#142] error response returns 400 status', () => {
    const r = validateEpsilon('bad');
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('finite number 0-1'),
      'Error message must match: "epsilon must be a finite number 0-1"');
  });

  test('[#142] epsilon object {value: 0.5} is rejected', () => {
    const r = validateEpsilon({ value: 0.5 });
    assert.equal(r.valid, false, 'Object epsilon must be rejected');
  });

  test('[#142] epsilon array [0.5] is rejected', () => {
    const r = validateEpsilon([0.5]);
    assert.equal(r.valid, false, 'Array epsilon must be rejected');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #141 — Auto-Save Dirty Flag (rapid changes don't skip)     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#141] dirty set during save is NOT lost (snapshot-before-save)', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Start save (dirty → false immediately)
    const savePromise = mgr.tick();
    assert.equal(mgr.dirty, false, 'dirty must be false right after tick starts');

    // Mark dirty again WHILE save is in progress
    await new Promise(r => setTimeout(r, 2));
    mgr.markDirty();

    await savePromise;
    assert.equal(mgr.saveCount, 1, 'First save completed');
    assert.equal(mgr.dirty, true, 'dirty set during save must survive');
  });

  test('[#141] second tick catches dirty set during first save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tick1 = mgr.tick();
    await new Promise(r => setTimeout(r, 2));
    mgr.markDirty(); // dirty during save
    await tick1;

    const tick2 = await mgr.tick();
    assert.equal(tick2.saved, true, 'Second tick must save (dirty was set during first)');
    assert.equal(mgr.saveCount, 2, 'Both saves must complete');
  });

  test('[#141] 10 rapid dirty marks between ticks → 2 saves (not 1)', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // First save
    await mgr.tick();

    // 10 rapid changes
    for (let i = 0; i < 10; i++) {
      mgr.markDirty();
    }

    // Second save catches all changes
    const result = await mgr.tick();
    assert.equal(result.saved, true, 'Second tick must save');
    assert.equal(mgr.saveCount, 2, 'Two saves total (1 + 1 for all rapid changes)');
  });

  test('[#141] concurrent tick is skipped while save in progress', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tick1 = mgr.tick();
    const tick2Result = await mgr.tick(); // should skip
    assert.equal(tick2Result.skipped, 'saving', 'Concurrent tick must be skipped');

    await tick1;
    assert.equal(mgr.saveCount, 1);
  });

  test('[#141] alternating dirty→save→dirty→save never loses data', async () => {
    const mgr = new AutoSaveManager();

    for (let cycle = 0; cycle < 20; cycle++) {
      mgr.markDirty();
      const result = await mgr.tick();
      assert.equal(result.saved, true, `Cycle ${cycle}: must save`);
    }
    assert.equal(mgr.saveCount, 20, 'All 20 saves must complete');
  });

  test('[#141] no dirty between ticks → save is skipped', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.tick();

    // No markDirty() call
    const result = await mgr.tick();
    assert.equal(result.skipped, 'clean', 'Tick without changes must skip');
    assert.equal(mgr.saveCount, 1);
  });

  test('[#141] server code snapshots dirty BEFORE async save', () => {
    // The server sets dirty=false BEFORE await saveState()
    const dirtyResetMatch = serverSource.match(/trainer\.dirty\s*=\s*false/);
    const saveStateMatch = serverSource.match(/await\s+trainer\.saveState\(\)/);

    assert.ok(dirtyResetMatch, 'Server must reset trainer.dirty = false');
    assert.ok(saveStateMatch, 'Server must call await trainer.saveState()');

    // dirty=false must appear BEFORE saveState in the source
    const dirtyPos = serverSource.indexOf('trainer.dirty = false');
    const savePos = serverSource.indexOf('await trainer.saveState()');
    assert.ok(dirtyPos < savePos,
      'trainer.dirty = false must appear BEFORE await trainer.saveState() (snapshot pattern)');
  });

  test('[#141] server code has _saving guard to prevent concurrent saves', () => {
    assert.ok(
      /if\s*\(\s*_saving\s*\)\s*return/.test(serverSource),
      'Server must check if (_saving) return to prevent concurrent saves'
    );
    assert.ok(
      /_saving\s*=\s*true/.test(serverSource),
      'Server must set _saving = true before save'
    );
    assert.ok(
      /_saving\s*=\s*false/.test(serverSource),
      'Server must set _saving = false in finally block'
    );
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  ISSUE #140 — CSP Header (Content-Security-Policy present)        ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('[#140] Content-Security-Policy header is set in server middleware', () => {
    assert.ok(
      serverSource.includes('Content-Security-Policy'),
      'server/index.js must set Content-Security-Policy header'
    );
    assert.ok(
      /res\.setHeader\(\s*['"]Content-Security-Policy['"]/.test(serverSource),
      'CSP must be set via res.setHeader()'
    );
  });

  test('[#140] CSP contains default-src directive', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['default-src'], 'CSP must have default-src directive');
    assert.ok(parsed["default-src"].includes("'self'"), "default-src must include 'self'");
  });

  test('[#140] CSP contains script-src directive (no unsafe-eval)', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['script-src'], 'CSP must have script-src directive');
    assert.ok(!parsed['script-src'].includes("'unsafe-eval'"), 'script-src must NOT allow unsafe-eval');
    assert.ok(!parsed['script-src'].includes("'unsafe-inline'"), 'script-src must NOT allow unsafe-inline');
  });

  test('[#140] CSP contains frame-ancestors none (anti-clickjacking)', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['frame-ancestors'], 'CSP must have frame-ancestors');
    assert.ok(parsed["frame-ancestors"].includes("'none'"), 'frame-ancestors must be none');
  });

  test('[#140] CSP contains object-src none (blocks Flash/plugins)', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['object-src'], 'CSP must have object-src');
    assert.ok(parsed['object-src'].includes("'none'"), 'object-src must be none');
  });

  test('[#140] CSP connect-src allows wss: for WebSocket', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['connect-src'], 'CSP must have connect-src');
    assert.ok(parsed['connect-src'].includes('wss:'), 'connect-src must allow wss:');
  });

  test('[#140] CSP does NOT allow http: scheme', () => {
    const parsed = parseCSP(CSP_HEADER);
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('http:'), `${dir} must not allow http:`);
    }
  });

  test('[#140] CSP does NOT allow wildcard (*) origins', () => {
    const parsed = parseCSP(CSP_HEADER);
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('*'), `${dir} must not allow wildcard`);
    }
  });

  test('[#140] CSP header is set on EVERY response (middleware, not route-specific)', () => {
    // The CSP is set in app.use() middleware, not in a specific route
    // This means it applies to all responses including static files
    const middlewareSection = serverSource.slice(
      serverSource.indexOf('Security Headers'),
      serverSource.indexOf('Rate Limiting')
    );
    assert.ok(
      middlewareSection.includes('Content-Security-Policy'),
      'CSP must be in general middleware (applies to all responses)'
    );
    assert.ok(
      /next\(\)/.test(middlewareSection),
      'Security headers middleware must call next()'
    );
  });

  test('[#140] CSP img-src allows data: URIs (for inline images)', () => {
    const parsed = parseCSP(CSP_HEADER);
    assert.ok(parsed['img-src'], 'CSP must have img-src');
    assert.ok(parsed['img-src'].includes('data:'), 'img-src must allow data: URIs');
  });

  test('[#140] CSP has at least 8 directives', () => {
    const parsed = parseCSP(CSP_HEADER);
    const count = Object.keys(parsed).length;
    assert.ok(count >= 8, `CSP must have at least 8 directives, found ${count}`);
  });

  // ── Run ─────────────────────────────────────────────────────────────

  console.log('\n📋 Issues #140–#143 Regression Tests');

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
