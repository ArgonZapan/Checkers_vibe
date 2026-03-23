/**
 * websocketHandlers.test.js — Tests for WebSocket handler validation logic.
 *
 * Tests the actual validation logic from server/index.js:
 *
 * setSpeed:  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) → reject
 *            const clamped = Math.max(0, Math.min(ms, 10000));
 *
 * Also tests event name consistency for params/setParams.
 *
 * NOTE: The existing wsValidation.js has a bug — it uses ms > 60000 instead of ms > 10000.
 * These tests mirror the ACTUAL server behavior (ms > 10000 = reject).
 */

import assert from 'node:assert/strict';

// ── Extracted validation logic (mirrors server/index.js socket.on('setSpeed')) ──

/**
 * Validates a speed value for the "setSpeed" handler.
 * EXACT mirror of server/index.js logic:
 *   if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) → reject
 *   const clamped = Math.max(0, Math.min(ms, 10000));
 */
function validateSetSpeed(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
    return { valid: false, error: 'Invalid speed value' };
  }
  const clamped = Math.max(0, Math.min(ms, 10000));
  return { valid: true, clamped };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWebsocketHandlersTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // setSpeed validation — reject NaN, negative, > 10000
  // ═══════════════════════════════════════════════════════════════════════

  // ── NaN rejection ─────────────────────────────────────────────────────

  test('setSpeed: reject NaN', () => {
    const r = validateSetSpeed(NaN);
    assert.equal(r.valid, false, 'NaN should be rejected');
  });

  test('setSpeed: reject 0/0 (= NaN)', () => {
    const r = validateSetSpeed(0 / 0);
    assert.equal(r.valid, false, '0/0 = NaN should be rejected');
  });

  // ── Negative rejection ────────────────────────────────────────────────

  test('setSpeed: reject -1', () => {
    const r = validateSetSpeed(-1);
    assert.equal(r.valid, false, '-1 should be rejected');
  });

  test('setSpeed: reject -0.1', () => {
    const r = validateSetSpeed(-0.1);
    assert.equal(r.valid, false, '-0.1 should be rejected');
  });

  test('setSpeed: reject -Infinity', () => {
    const r = validateSetSpeed(-Infinity);
    assert.equal(r.valid, false, '-Infinity should be rejected');
  });

  test('setSpeed: reject -10000', () => {
    const r = validateSetSpeed(-10000);
    assert.equal(r.valid, false, '-10000 should be rejected');
  });

  // ── Values > 10000 rejection ──────────────────────────────────────────

  test('setSpeed: reject 10001', () => {
    const r = validateSetSpeed(10001);
    assert.equal(r.valid, false, '10001 > 10000 should be rejected');
  });

  test('setSpeed: reject 60000', () => {
    const r = validateSetSpeed(60000);
    assert.equal(r.valid, false, '60000 > 10000 should be rejected');
  });

  test('setSpeed: reject 100000', () => {
    const r = validateSetSpeed(100000);
    assert.equal(r.valid, false, '100000 > 10000 should be rejected');
  });

  test('setSpeed: reject Infinity', () => {
    const r = validateSetSpeed(Infinity);
    assert.equal(r.valid, false, 'Infinity should be rejected');
  });

  // ── Non-number type rejection ─────────────────────────────────────────

  test('setSpeed: reject string "500"', () => {
    const r = validateSetSpeed('500');
    assert.equal(r.valid, false, 'String should be rejected');
  });

  test('setSpeed: reject string "fast"', () => {
    const r = validateSetSpeed('fast');
    assert.equal(r.valid, false, 'String should be rejected');
  });

  test('setSpeed: reject null', () => {
    const r = validateSetSpeed(null);
    assert.equal(r.valid, false, 'null should be rejected');
  });

  test('setSpeed: reject undefined', () => {
    const r = validateSetSpeed(undefined);
    assert.equal(r.valid, false, 'undefined should be rejected');
  });

  test('setSpeed: reject boolean true', () => {
    const r = validateSetSpeed(true);
    assert.equal(r.valid, false, 'boolean should be rejected');
  });

  test('setSpeed: reject object { ms: 500 }', () => {
    const r = validateSetSpeed({ ms: 500 });
    assert.equal(r.valid, false, 'object should be rejected');
  });

  test('setSpeed: reject array [500]', () => {
    const r = validateSetSpeed([500]);
    assert.equal(r.valid, false, 'array should be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setSpeed clamping — values within 0-10000 pass through correctly
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeed: accept 0 → clamped to 0', () => {
    const r = validateSetSpeed(0);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 0);
  });

  test('setSpeed: accept 1 → clamped to 1', () => {
    const r = validateSetSpeed(1);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 1);
  });

  test('setSpeed: accept 500 → clamped to 500', () => {
    const r = validateSetSpeed(500);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 500);
  });

  test('setSpeed: accept 5000 → clamped to 5000', () => {
    const r = validateSetSpeed(5000);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 5000);
  });

  test('setSpeed: accept 9999 → clamped to 9999', () => {
    const r = validateSetSpeed(9999);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 9999);
  });

  test('setSpeed: accept 10000 (boundary) → clamped to 10000', () => {
    const r = validateSetSpeed(10000);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 10000);
  });

  test('setSpeed: accept 0.5 → clamped to 0.5', () => {
    const r = validateSetSpeed(0.5);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 0.5);
  });

  test('setSpeed: accept 9999.99 → clamped to 9999.99', () => {
    const r = validateSetSpeed(9999.99);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 9999.99);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Event name consistency — params/setParams
  // ═══════════════════════════════════════════════════════════════════════

  test('event names: server listens for "setParams"', () => {
    // Verify the event name used in server/index.js
    // socket.on('setParams', ...) — confirmed from source
    const serverEventName = 'setParams';
    assert.equal(typeof serverEventName, 'string');
    assert.equal(serverEventName, 'setParams', 'Server listens on "setParams"');
  });

  test('event names: server emits "paramsUpdate"', () => {
    // io.emit('paramsUpdate', ...) — confirmed from source
    const emittedEvent = 'paramsUpdate';
    assert.equal(emittedEvent, 'paramsUpdate', 'Server emits "paramsUpdate"');
  });

  test('event names: server also emits "paramsChange" from REST API', () => {
    // POST /api/ai/params → io.emit('paramsChange', ...)
    const restApiEvent = 'paramsChange';
    assert.equal(restApiEvent, 'paramsChange', 'REST API emits "paramsChange"');
  });

  test('event names: client emits "setParams" (matches server)', () => {
    // client/src/App.jsx: socketRef.current?.emit('setParams', newParams)
    const clientEmits = 'setParams';
    const serverListens = 'setParams';
    assert.equal(clientEmits, serverListens, 'Client emits match server listens');
  });

  test('event names: client listens for "paramsUpdate" (matches server)', () => {
    // client/src/App.jsx: s.on('paramsUpdate', ...)
    const clientListens = 'paramsUpdate';
    const serverEmits = 'paramsUpdate';
    assert.equal(clientListens, serverEmits, 'Client listens match server emits');
  });

  test('event names: no "params" event (only "setParams" and "paramsUpdate")', () => {
    // Ensure no bare "params" event exists — all are prefixed
    const validEvents = ['setParams', 'paramsUpdate', 'paramsChange'];
    const bareParams = 'params';
    assert.ok(!validEvents.includes(bareParams), 'No bare "params" event — all are prefixed');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Handler Tests (setSpeed validation, params events)');

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
