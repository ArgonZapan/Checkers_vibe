/**
 * setSpeedModeValidation.test.js — Tests for the setSpeedMode WebSocket handler.
 *
 * Source logic (server/index.js):
 *   socket.on('setSpeedMode', (mode) => {
 *     if (mode === 'fast' || mode === 'normal') {
 *       CONFIG.server.speedMode = mode;
 *     }
 *   });
 *
 * Only 'fast' and 'normal' are accepted. Everything else is silently ignored.
 * Covers: invalid modes, non-string input, null, undefined, empty string.
 */

import assert from 'node:assert/strict';

// ── Extracted validation logic (mirrors server/index.js) ──────────────────

function isValidSpeedMode(mode) {
  return mode === 'fast' || mode === 'normal';
}

// ── Test runner ───────────────────────────────────────────────────────────

export async function runSetSpeedModeValidationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Valid modes
  // ═══════════════════════════════════════════════════════════════════════

  test('accept "fast"', () => {
    assert.equal(isValidSpeedMode('fast'), true);
  });

  test('accept "normal"', () => {
    assert.equal(isValidSpeedMode('normal'), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Invalid string modes
  // ═══════════════════════════════════════════════════════════════════════

  test('reject "turbo"', () => {
    assert.equal(isValidSpeedMode('turbo'), false);
  });

  test('reject "slow"', () => {
    assert.equal(isValidSpeedMode('slow'), false);
  });

  test('reject "FAST" (uppercase)', () => {
    assert.equal(isValidSpeedMode('FAST'), false);
  });

  test('reject "NORMAL" (uppercase)', () => {
    assert.equal(isValidSpeedMode('NORMAL'), false);
  });

  test('reject "Fast" (mixed case)', () => {
    assert.equal(isValidSpeedMode('Fast'), false);
  });

  test('reject empty string ""', () => {
    assert.equal(isValidSpeedMode(''), false);
  });

  test('reject " fast" (leading space)', () => {
    assert.equal(isValidSpeedMode(' fast'), false);
  });

  test('reject "fast " (trailing space)', () => {
    assert.equal(isValidSpeedMode('fast '), false);
  });

  test('reject "normal " (trailing space)', () => {
    assert.equal(isValidSpeedMode('normal '), false);
  });

  test('reject arbitrary string "banana"', () => {
    assert.equal(isValidSpeedMode('banana'), false);
  });

  test('reject numeric string "1"', () => {
    assert.equal(isValidSpeedMode('1'), false);
  });

  test('reject numeric string "0"', () => {
    assert.equal(isValidSpeedMode('0'), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Non-string types
  // ═══════════════════════════════════════════════════════════════════════

  test('reject null', () => {
    assert.equal(isValidSpeedMode(null), false);
  });

  test('reject undefined', () => {
    assert.equal(isValidSpeedMode(undefined), false);
  });

  test('reject number 1', () => {
    assert.equal(isValidSpeedMode(1), false);
  });

  test('reject number 0', () => {
    assert.equal(isValidSpeedMode(0), false);
  });

  test('reject number -1', () => {
    assert.equal(isValidSpeedMode(-1), false);
  });

  test('reject NaN', () => {
    assert.equal(isValidSpeedMode(NaN), false);
  });

  test('reject boolean true', () => {
    assert.equal(isValidSpeedMode(true), false);
  });

  test('reject boolean false', () => {
    assert.equal(isValidSpeedMode(false), false);
  });

  test('reject object { mode: "fast" }', () => {
    assert.equal(isValidSpeedMode({ mode: 'fast' }), false);
  });

  test('reject array ["fast"]', () => {
    assert.equal(isValidSpeedMode(['fast']), false);
  });

  test('reject Symbol', () => {
    assert.equal(isValidSpeedMode(Symbol('fast')), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Simulate setSpeedMode handler behavior
  // ═══════════════════════════════════════════════════════════════════════

  test('handler simulation: valid mode updates speedMode', () => {
    const config = { server: { speedMode: 'normal' } };
    const mode = 'fast';
    if (isValidSpeedMode(mode)) config.server.speedMode = mode;
    assert.equal(config.server.speedMode, 'fast');
  });

  test('handler simulation: invalid mode does NOT change speedMode', () => {
    const config = { server: { speedMode: 'normal' } };
    const mode = 'turbo';
    if (isValidSpeedMode(mode)) config.server.speedMode = mode;
    assert.equal(config.server.speedMode, 'normal', 'speedMode should remain unchanged');
  });

  test('handler simulation: null does NOT change speedMode', () => {
    const config = { server: { speedMode: 'fast' } };
    const mode = null;
    if (isValidSpeedMode(mode)) config.server.speedMode = mode;
    assert.equal(config.server.speedMode, 'fast', 'speedMode should remain unchanged');
  });

  test('handler simulation: undefined does NOT change speedMode', () => {
    const config = { server: { speedMode: 'normal' } };
    if (isValidSpeedMode(undefined)) config.server.speedMode = undefined;
    assert.equal(config.server.speedMode, 'normal', 'speedMode should remain unchanged');
  });

  test('handler simulation: toggle fast→normal→fast', () => {
    const config = { server: { speedMode: 'normal' } };
    if (isValidSpeedMode('fast')) config.server.speedMode = 'fast';
    assert.equal(config.server.speedMode, 'fast');
    if (isValidSpeedMode('normal')) config.server.speedMode = 'normal';
    assert.equal(config.server.speedMode, 'normal');
    if (isValidSpeedMode('fast')) config.server.speedMode = 'fast';
    assert.equal(config.server.speedMode, 'fast');
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 setSpeedMode Handler Validation Tests');

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
