/**
 * wsSetSpeed.test.js — Tests for WebSocket "setSpeed" handler validation.
 *
 * Tests the validation logic from server/index.js socket.on('setSpeed'):
 *   if (typeof ms !== 'number' || ms < 0 || ms > 60000 || Number.isNaN(ms)) { reject }
 *   const clamped = Math.max(0, Math.min(ms, 10000));
 */
import assert from 'node:assert/strict';
import { validateSetSpeed } from './wsValidation.js';

export async function runWsSetSpeedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Valid values ──────────────────────────────────────────────────

  test('accept 0', () => {
    const r = validateSetSpeed(0);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 0);
  });

  test('accept 500', () => {
    const r = validateSetSpeed(500);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 500);
  });

  test('accept 10000 (max clamped)', () => {
    const r = validateSetSpeed(10000);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 10000);
  });

  // ── Negative values ───────────────────────────────────────────────

  test('reject -1', () => {
    const r = validateSetSpeed(-1);
    assert.equal(r.valid, false);
  });

  test('reject -100', () => {
    const r = validateSetSpeed(-100);
    assert.equal(r.valid, false);
  });

  test('reject -Infinity', () => {
    const r = validateSetSpeed(-Infinity);
    assert.equal(r.valid, false);
  });

  // ── Values > 10000 (rejected) ─────────────────────────────────────

  test('reject 60001', () => {
    const r = validateSetSpeed(60001);
    assert.equal(r.valid, false);
  });

  test('reject 100000', () => {
    const r = validateSetSpeed(100000);
    assert.equal(r.valid, false);
  });

  test('reject Infinity', () => {
    const r = validateSetSpeed(Infinity);
    assert.equal(r.valid, false);
  });

  // ── Values > 10000 are rejected (not clamped) ────────────────────

  test('reject 10001', () => {
    const r = validateSetSpeed(10001);
    assert.equal(r.valid, false);
  });

  test('reject 50000', () => {
    const r = validateSetSpeed(50000);
    assert.equal(r.valid, false);
  });

  test('reject 60000', () => {
    const r = validateSetSpeed(60000);
    assert.equal(r.valid, false);
  });

  // ── String input ──────────────────────────────────────────────────

  test('reject string "500"', () => {
    const r = validateSetSpeed('500');
    assert.equal(r.valid, false);
  });

  test('reject string "fast"', () => {
    const r = validateSetSpeed('fast');
    assert.equal(r.valid, false);
  });

  test('reject empty string ""', () => {
    const r = validateSetSpeed('');
    assert.equal(r.valid, false);
  });

  // ── null / undefined ──────────────────────────────────────────────

  test('reject null', () => {
    const r = validateSetSpeed(null);
    assert.equal(r.valid, false);
  });

  test('reject undefined', () => {
    const r = validateSetSpeed(undefined);
    assert.equal(r.valid, false);
  });

  // ── NaN ───────────────────────────────────────────────────────────

  test('reject NaN', () => {
    const r = validateSetSpeed(NaN);
    assert.equal(r.valid, false);
  });

  // ── Other types ───────────────────────────────────────────────────

  test('reject boolean true', () => {
    const r = validateSetSpeed(true);
    assert.equal(r.valid, false);
  });

  test('reject object { ms: 500 }', () => {
    const r = validateSetSpeed({ ms: 500 });
    assert.equal(r.valid, false);
  });

  test('reject array [500]', () => {
    const r = validateSetSpeed([500]);
    assert.equal(r.valid, false);
  });

  // ── Side-effect consistency (server/index.js behavior) ────────────
  // Real handler: clamped=0 → aiMoveDelayMs=0, normalModeDelayMs NOT updated
  //               clamped>0 → both updated

  test('handler simulation: clamped=0 updates aiMoveDelayMs only', () => {
    const CONFIG = { server: { aiMoveDelayMs: 500, normalModeDelayMs: 500 } };
    const r = validateSetSpeed(0);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 0);
    // Simulate real handler side-effect
    CONFIG.server.aiMoveDelayMs = r.clamped;
    if (r.clamped > 0) CONFIG.server.normalModeDelayMs = r.clamped;
    assert.equal(CONFIG.server.aiMoveDelayMs, 0);
    assert.equal(CONFIG.server.normalModeDelayMs, 500, 'normalModeDelayMs should NOT change when clamped=0');
  });

  test('handler simulation: clamped=100 updates both', () => {
    const CONFIG = { server: { aiMoveDelayMs: 500, normalModeDelayMs: 500 } };
    const r = validateSetSpeed(100);
    assert.equal(r.valid, true);
    CONFIG.server.aiMoveDelayMs = r.clamped;
    if (r.clamped > 0) CONFIG.server.normalModeDelayMs = r.clamped;
    assert.equal(CONFIG.server.aiMoveDelayMs, 100);
    assert.equal(CONFIG.server.normalModeDelayMs, 100);
  });

  test('handler simulation: clamped=10000 updates both', () => {
    const CONFIG = { server: { aiMoveDelayMs: 0, normalModeDelayMs: 0 } };
    const r = validateSetSpeed(10000);
    assert.equal(r.valid, true);
    CONFIG.server.aiMoveDelayMs = r.clamped;
    if (r.clamped > 0) CONFIG.server.normalModeDelayMs = r.clamped;
    assert.equal(CONFIG.server.aiMoveDelayMs, 10000);
    assert.equal(CONFIG.server.normalModeDelayMs, 10000);
  });

  test('handler simulation: set to 0 then back to 500 restores normalModeDelayMs', () => {
    const CONFIG = { server: { aiMoveDelayMs: 300, normalModeDelayMs: 300 } };
    // Set to 0
    let r = validateSetSpeed(0);
    CONFIG.server.aiMoveDelayMs = r.clamped;
    if (r.clamped > 0) CONFIG.server.normalModeDelayMs = r.clamped;
    assert.equal(CONFIG.server.aiMoveDelayMs, 0);
    assert.equal(CONFIG.server.normalModeDelayMs, 300, 'normalModeDelayMs frozen at 300');
    // Set back to 500
    r = validateSetSpeed(500);
    CONFIG.server.aiMoveDelayMs = r.clamped;
    if (r.clamped > 0) CONFIG.server.normalModeDelayMs = r.clamped;
    assert.equal(CONFIG.server.aiMoveDelayMs, 500);
    assert.equal(CONFIG.server.normalModeDelayMs, 500);
  });

  test('handler simulation: rejected value changes nothing', () => {
    const CONFIG = { server: { aiMoveDelayMs: 200, normalModeDelayMs: 200 } };
    const r = validateSetSpeed(-5);
    assert.equal(r.valid, false);
    // Real handler would return early — no side effects
    assert.equal(CONFIG.server.aiMoveDelayMs, 200);
    assert.equal(CONFIG.server.normalModeDelayMs, 200);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket setSpeed Validation Tests');

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
