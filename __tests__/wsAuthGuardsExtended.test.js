/**
 * wsAuthGuardsExtended.test.js — Extended tests for WebSocket auth guards.
 *
 * Covers auth checks across WS handlers:
 * - setSpeed: only allowed in aivai mode (pvai/pvp → reject)
 * - setSpeedMode: only allowed in aivai mode
 * - setParams: only allowed in aivai mode
 * - startSelfPlay: only allowed in aivai mode
 * - stopSelfPlay: only allowed in aivai mode
 * - Throttle enforcement (1s for speed controls)
 * - Cross-mode: switching from aivai to pvai revokes speed control
 * - Auth + validation order (auth checked before validation)
 * - Error message content (Polish strings)
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: auth guard logic (mirrors server/index.js) ──────────────────

/**
 * Check if a WS action is allowed for the given game mode.
 */
function checkAuth(gameMode, action) {
  const aivaiOnly = new Set(['setSpeed', 'setSpeedMode', 'setParams', 'startSelfPlay', 'stopSelfPlay']);
  if (aivaiOnly.has(action)) {
    if (gameMode !== 'aivai') {
      return {
        allowed: false,
        error: getAuthErrorMessage(action),
      };
    }
  }
  return { allowed: true };
}

/**
 * Get the auth error message for an action (matches server Polish strings).
 */
function getAuthErrorMessage(action) {
  const messages = {
    setSpeed: 'Zmiana prędkości dozwolona tylko w trybie AI vs AI',
    setSpeedMode: 'Zmiana trybu prędkości dozwolona tylko w trybie AI vs AI',
    setParams: 'Parametry można zmieniać tylko w trybie AI vs AI',
    startSelfPlay: 'Self-play dostępny tylko w trybie AI vs AI',
    stopSelfPlay: 'Self-play dostępny tylko w trybie AI vs AI',
  };
  return messages[action] || 'Unauthorized';
}

/**
 * Validate setSpeed value (matches server validation).
 */
function validateSpeed(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
    return { valid: false, error: 'Invalid speed value — expected number 0-10000' };
  }
  return { valid: true, clamped: Math.max(0, Math.min(ms, 10000)) };
}

/**
 * Validate setSpeedMode value.
 */
function validateSpeedMode(mode) {
  if (typeof mode !== 'string') {
    return { valid: false, error: 'Invalid speed mode — expected string' };
  }
  if (mode !== 'fast' && mode !== 'normal') {
    return { valid: false, error: 'Invalid speed mode — expected "fast" or "normal"' };
  }
  return { valid: true };
}

/**
 * Simulate full WS handler with auth + validation.
 */
function simulateHandler(gameMode, action, payload) {
  // 1. Auth check (always first)
  const auth = checkAuth(gameMode, action);
  if (!auth.allowed) {
    return { result: 'reject', error: auth.error, step: 'auth' };
  }

  // 2. Action-specific validation
  if (action === 'setSpeed') {
    const v = validateSpeed(payload);
    if (!v.valid) return { result: 'reject', error: v.error, step: 'validation' };
    return { result: 'accept', clamped: v.clamped };
  }

  if (action === 'setSpeedMode') {
    const v = validateSpeedMode(payload);
    if (!v.valid) return { result: 'reject', error: v.error, step: 'validation' };
    return { result: 'accept', mode: payload };
  }

  return { result: 'accept' };
}

/**
 * Simulate throttle check.
 */
function createThrottleState() {
  const store = {};
  return function check(key, minIntervalMs) {
    const now = Date.now();
    const last = store[key] || 0;
    if (now - last < minIntervalMs) return false;
    store[key] = now;
    return true;
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsAuthGuardsExtendedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Auth: setSpeed
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeed in pvai → rejected at auth step', () => {
    const r = simulateHandler('pvai', 'setSpeed', 500);
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'auth');
    assert.ok(r.error.includes('AI vs AI'));
  });

  test('setSpeed in pvp → rejected at auth step', () => {
    const r = simulateHandler('pvp', 'setSpeed', 500);
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'auth');
  });

  test('setSpeed in aivai → accepted (passes auth)', () => {
    const r = simulateHandler('aivai', 'setSpeed', 500);
    assert.equal(r.result, 'accept');
    assert.equal(r.clamped, 500);
  });

  test('setSpeed in aivai with invalid value → rejected at validation', () => {
    const r = simulateHandler('aivai', 'setSpeed', -10);
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'validation');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth: setSpeedMode
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeedMode in pvai → rejected at auth step', () => {
    const r = simulateHandler('pvai', 'setSpeedMode', 'fast');
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'auth');
    assert.ok(r.error.includes('prędkości'));
  });

  test('setSpeedMode in pvp → rejected', () => {
    const r = simulateHandler('pvp', 'setSpeedMode', 'normal');
    assert.equal(r.result, 'reject');
  });

  test('setSpeedMode "fast" in aivai → accepted', () => {
    const r = simulateHandler('aivai', 'setSpeedMode', 'fast');
    assert.equal(r.result, 'accept');
    assert.equal(r.mode, 'fast');
  });

  test('setSpeedMode "normal" in aivai → accepted', () => {
    const r = simulateHandler('aivai', 'setSpeedMode', 'normal');
    assert.equal(r.result, 'accept');
    assert.equal(r.mode, 'normal');
  });

  test('setSpeedMode invalid string in aivai → rejected at validation', () => {
    const r = simulateHandler('aivai', 'setSpeedMode', 'turbo');
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'validation');
  });

  test('setSpeedMode non-string in aivai → rejected at validation', () => {
    const r = simulateHandler('aivai', 'setSpeedMode', 42);
    assert.equal(r.result, 'reject');
    assert.equal(r.step, 'validation');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth: setParams
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams in pvai → rejected', () => {
    const r = checkAuth('pvai', 'setParams');
    assert.equal(r.allowed, false);
    assert.ok(r.error.includes('Parametry'));
  });

  test('setParams in pvp → rejected', () => {
    const r = checkAuth('pvp', 'setParams');
    assert.equal(r.allowed, false);
  });

  test('setParams in aivai → allowed', () => {
    const r = checkAuth('aivai', 'setParams');
    assert.equal(r.allowed, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth: startSelfPlay / stopSelfPlay
  // ═══════════════════════════════════════════════════════════════════════

  test('startSelfPlay in pvai → rejected', () => {
    const r = checkAuth('pvai', 'startSelfPlay');
    assert.equal(r.allowed, false);
    assert.ok(r.error.includes('Self-play'));
  });

  test('startSelfPlay in aivai → allowed', () => {
    const r = checkAuth('aivai', 'startSelfPlay');
    assert.equal(r.allowed, true);
  });

  test('stopSelfPlay in pvp → rejected', () => {
    const r = checkAuth('pvp', 'stopSelfPlay');
    assert.equal(r.allowed, false);
  });

  test('stopSelfPlay in aivai → allowed', () => {
    const r = checkAuth('aivai', 'stopSelfPlay');
    assert.equal(r.allowed, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Actions NOT requiring aivai auth
  // ═══════════════════════════════════════════════════════════════════════

  test('move in pvai → allowed (no aivai restriction)', () => {
    const r = checkAuth('pvai', 'move');
    assert.equal(r.allowed, true);
  });

  test('getLegalMoves in pvai → allowed', () => {
    const r = checkAuth('pvai', 'getLegalMoves');
    assert.equal(r.allowed, true);
  });

  test('startGame in pvai → allowed', () => {
    const r = checkAuth('pvai', 'startGame');
    assert.equal(r.allowed, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Auth before validation: auth is checked FIRST
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeed in pvai with invalid value → auth error, not validation error', () => {
    const r = simulateHandler('pvai', 'setSpeed', -999);
    assert.equal(r.step, 'auth', 'auth should be checked before validation');
    assert.ok(!r.error.includes('Invalid speed'), 'should not reveal validation logic');
  });

  test('setSpeedMode in pvai with invalid string → auth error first', () => {
    const r = simulateHandler('pvai', 'setSpeedMode', 'invalid');
    assert.equal(r.step, 'auth');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Throttle: 1s for speed controls
  // ═══════════════════════════════════════════════════════════════════════

  test('throttle: setSpeed first call passes', () => {
    const throttle = createThrottleState();
    assert.ok(throttle('setSpeed', 1000));
  });

  test('throttle: setSpeed rapid second call blocked', () => {
    const throttle = createThrottleState();
    throttle('setSpeed', 1000);
    assert.ok(!throttle('setSpeed', 1000));
  });

  test('throttle: setSpeedMode first call passes', () => {
    const throttle = createThrottleState();
    assert.ok(throttle('setSpeedMode', 1000));
  });

  test('throttle: setSpeedMode rapid second call blocked', () => {
    const throttle = createThrottleState();
    throttle('setSpeedMode', 1000);
    assert.ok(!throttle('setSpeedMode', 1000));
  });

  test('throttle: setSpeed and setSpeedMode are independent', () => {
    const throttle = createThrottleState();
    throttle('setSpeed', 1000);
    assert.ok(throttle('setSpeedMode', 1000), 'different keys should be independent');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Speed validation edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('validateSpeed: 0 → valid, clamped 0', () => {
    const r = validateSpeed(0);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 0);
  });

  test('validateSpeed: 10000 → valid, clamped 10000', () => {
    const r = validateSpeed(10000);
    assert.equal(r.valid, true);
    assert.equal(r.clamped, 10000);
  });

  test('validateSpeed: 10001 → invalid (>10000)', () => {
    const r = validateSpeed(10001);
    assert.equal(r.valid, false);
  });

  test('validateSpeed: NaN → invalid', () => {
    const r = validateSpeed(NaN);
    assert.equal(r.valid, false);
  });

  test('validateSpeed: Infinity → invalid', () => {
    const r = validateSpeed(Infinity);
    assert.equal(r.valid, false);
  });

  test('validateSpeed: string "500" → invalid', () => {
    const r = validateSpeed('500');
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SpeedMode validation edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('validateSpeedMode: null → invalid', () => {
    const r = validateSpeedMode(null);
    assert.equal(r.valid, false);
  });

  test('validateSpeedMode: undefined → invalid', () => {
    const r = validateSpeedMode(undefined);
    assert.equal(r.valid, false);
  });

  test('validateSpeedMode: empty string → invalid', () => {
    const r = validateSpeedMode('');
    assert.equal(r.valid, false);
  });

  test('validateSpeedMode: "FAST" (uppercase) → invalid', () => {
    const r = validateSpeedMode('FAST');
    assert.equal(r.valid, false);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Auth Guards Extended Tests');

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
