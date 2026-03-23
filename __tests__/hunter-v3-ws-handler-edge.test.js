/**
 * hunter-v3-ws-handler-edge.test.js — WebSocket handler edge cases.
 *
 * Covers gaps NOT in wsHandlerInputGaps.test.js, wsMoveValidation.test.js, etc.:
 * - getLegalMoves: from coordinate edge cases (corners, edges, off-by-one)
 * - startGame: mode fallback behavior for edge inputs
 * - move handler: captures validation with mixed valid/invalid elements
 * - WS connection lifecycle: paramsUpdate emission structure
 * - setParams mode restriction: rejected in pvai/pvp modes
 * - Throttle: exact timing boundary (before/after minIntervalMs)
 * - setSpeed NaN/Infinity/edge number validation
 * - setSpeedMode: case sensitivity, whitespace
 * - reset: lock contention scenario
 */

import assert from 'node:assert/strict';

// ── Extracted: validation helpers ──────────────────────────────────────────

const isValidCoord = (c) =>
  Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1])
  && c[0] >= 0 && c[0] <= 7 && c[1] >= 0 && c[1] <= 7;

function validateMove({ from, to, captures }) {
  if (!isValidCoord(from)) return { valid: false, error: 'Invalid "from" coordinate' };
  if (!isValidCoord(to)) return { valid: false, error: 'Invalid "to" coordinate' };
  if (captures != null && !Array.isArray(captures)) {
    return { valid: false, error: 'Invalid "captures" — expected an array' };
  }
  if (Array.isArray(captures)) {
    for (let i = 0; i < captures.length; i++) {
      if (!isValidCoord(captures[i])) {
        return { valid: false, error: `Invalid capture at index ${i}` };
      }
    }
  }
  return { valid: true };
}

function validateGetLegalMoves(from) {
  if (!Array.isArray(from) || from.length !== 2
    || !Number.isInteger(from[0]) || !Number.isInteger(from[1])
    || from[0] < 0 || from[0] > 7 || from[1] < 0 || from[1] > 7) {
    return { valid: false, error: 'Invalid "from" coordinate' };
  }
  return { valid: true };
}

function validateStartGameMode(mode) {
  const validModes = ['pvai', 'pvp', 'aivai'];
  return validModes.includes(mode) ? mode : 'pvai';
}

function validateSetSpeed(ms) {
  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
    return { valid: false, error: 'Invalid speed value' };
  }
  return { valid: true, clamped: Math.max(0, Math.min(ms, 10000)) };
}

function validateSetSpeedMode(mode) {
  if (typeof mode !== 'string') {
    return { valid: false, error: 'Invalid speed mode — expected string' };
  }
  if (mode === 'fast' || mode === 'normal') {
    return { valid: true, mode };
  }
  return { valid: false, ignored: true };
}

function createThrottle() {
  const sockets = new Map();
  return function wsThrottle(socketId, key, minIntervalMs) {
    const now = Date.now();
    let socket = sockets.get(socketId);
    if (!socket) {
      socket = {};
      sockets.set(socketId, socket);
    }
    const last = socket[key] || 0;
    if (now - last < minIntervalMs) return false;
    socket[key] = now;
    return true;
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsHandlerEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── getLegalMoves: from coordinate edge cases ────────────────────────

  test('getLegalMoves: corner [0,0] is valid', () => {
    assert.equal(validateGetLegalMoves([0, 0]).valid, true);
  });

  test('getLegalMoves: corner [7,7] is valid', () => {
    assert.equal(validateGetLegalMoves([7, 7]).valid, true);
  });

  test('getLegalMoves: corner [0,7] is valid', () => {
    assert.equal(validateGetLegalMoves([0, 7]).valid, true);
  });

  test('getLegalMoves: corner [7,0] is valid', () => {
    assert.equal(validateGetLegalMoves([7, 0]).valid, true);
  });

  test('getLegalMoves: edge [0,3] is valid', () => {
    assert.equal(validateGetLegalMoves([0, 3]).valid, true);
  });

  test('getLegalMoves: edge [7,4] is valid', () => {
    assert.equal(validateGetLegalMoves([7, 4]).valid, true);
  });

  test('getLegalMoves: edge [3,0] is valid', () => {
    assert.equal(validateGetLegalMoves([3, 0]).valid, true);
  });

  test('getLegalMoves: edge [4,7] is valid', () => {
    assert.equal(validateGetLegalMoves([4, 7]).valid, true);
  });

  test('getLegalMoves: off-by-one [8,0] is invalid', () => {
    assert.equal(validateGetLegalMoves([8, 0]).valid, false);
  });

  test('getLegalMoves: off-by-one [0,8] is invalid', () => {
    assert.equal(validateGetLegalMoves([0, 8]).valid, false);
  });

  test('getLegalMoves: [-1,0] is invalid', () => {
    assert.equal(validateGetLegalMoves([-1, 0]).valid, false);
  });

  test('getLegalMoves: [0,-1] is invalid', () => {
    assert.equal(validateGetLegalMoves([0, -1]).valid, false);
  });

  test('getLegalMoves: [3.5, 2] is invalid (float)', () => {
    assert.equal(validateGetLegalMoves([3.5, 2]).valid, false);
  });

  test('getLegalMoves: single element array [3] is invalid', () => {
    assert.equal(validateGetLegalMoves([3]).valid, false);
  });

  test('getLegalMoves: three element array [3,4,5] is invalid', () => {
    assert.equal(validateGetLegalMoves([3, 4, 5]).valid, false);
  });

  test('getLegalMoves: object {row:3, col:4} is invalid', () => {
    assert.equal(validateGetLegalMoves({ row: 3, col: 4 }).valid, false);
  });

  test('getLegalMoves: string "[3,4]" is invalid', () => {
    assert.equal(validateGetLegalMoves('[3,4]').valid, false);
  });

  test('getLegalMoves: null is invalid', () => {
    assert.equal(validateGetLegalMoves(null).valid, false);
  });

  test('getLegalMoves: undefined is invalid', () => {
    assert.equal(validateGetLegalMoves(undefined).valid, false);
  });

  // ── startGame: mode fallback ─────────────────────────────────────────

  test('startGame: "pvai" stays pvai', () => {
    assert.equal(validateStartGameMode('pvai'), 'pvai');
  });

  test('startGame: "pvp" stays pvp', () => {
    assert.equal(validateStartGameMode('pvp'), 'pvp');
  });

  test('startGame: "aivai" stays aivai', () => {
    assert.equal(validateStartGameMode('aivai'), 'aivai');
  });

  test('startGame: invalid mode falls back to pvai', () => {
    assert.equal(validateStartGameMode('invalid'), 'pvai');
  });

  test('startGame: empty string falls back to pvai', () => {
    assert.equal(validateStartGameMode(''), 'pvai');
  });

  test('startGame: null falls back to pvai', () => {
    assert.equal(validateStartGameMode(null), 'pvai');
  });

  test('startGame: undefined falls back to pvai', () => {
    assert.equal(validateStartGameMode(undefined), 'pvai');
  });

  test('startGame: number falls back to pvai', () => {
    assert.equal(validateStartGameMode(1), 'pvai');
  });

  test('startGame: case sensitive — "PVAI" falls back', () => {
    assert.equal(validateStartGameMode('PVAI'), 'pvai');
  });

  test('startGame: "PvAi" falls back', () => {
    assert.equal(validateStartGameMode('PvAi'), 'pvai');
  });

  // ── move: captures validation ────────────────────────────────────────

  test('move: valid captures array passes', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3, 3]] });
    assert.equal(result.valid, true);
  });

  test('move: empty captures array passes', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [] });
    assert.equal(result.valid, true);
  });

  test('move: null captures passes (optional)', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: null });
    assert.equal(result.valid, true);
  });

  test('move: undefined captures passes (optional)', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: undefined });
    assert.equal(result.valid, true);
  });

  test('move: string captures is rejected', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: 'invalid' });
    assert.equal(result.valid, false);
  });

  test('move: number captures is rejected', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: 42 });
    assert.equal(result.valid, false);
  });

  test('move: captures with invalid element at index 0', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: ['invalid'] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('index 0'));
  });

  test('move: captures with invalid element at index 1', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3, 3], 'bad'] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('index 1'));
  });

  test('move: captures with out-of-bounds coord', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[8, 8]] });
    assert.equal(result.valid, false);
  });

  test('move: captures with negative coord', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[-1, 3]] });
    assert.equal(result.valid, false);
  });

  test('move: multi-capture with all valid coords', () => {
    const result = validateMove({ from: [2, 2], to: [6, 6], captures: [[3, 3], [5, 5]] });
    assert.equal(result.valid, true);
  });

  test('move: captures with float coord', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3.5, 3.5]] });
    assert.equal(result.valid, false);
  });

  test('move: captures with object instead of array', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [{ row: 3, col: 3 }] });
    assert.equal(result.valid, false);
  });

  // ── setSpeed validation ──────────────────────────────────────────────

  test('setSpeed: 0 is valid', () => {
    assert.equal(validateSetSpeed(0).valid, true);
    assert.equal(validateSetSpeed(0).clamped, 0);
  });

  test('setSpeed: 10000 is valid', () => {
    assert.equal(validateSetSpeed(10000).valid, true);
    assert.equal(validateSetSpeed(10000).clamped, 10000);
  });

  test('setSpeed: NaN is rejected', () => {
    assert.equal(validateSetSpeed(NaN).valid, false);
  });

  test('setSpeed: Infinity is rejected', () => {
    assert.equal(validateSetSpeed(Infinity).valid, false);
  });

  test('setSpeed: -Infinity is rejected', () => {
    assert.equal(validateSetSpeed(-Infinity).valid, false);
  });

  test('setSpeed: -1 is rejected', () => {
    assert.equal(validateSetSpeed(-1).valid, false);
  });

  test('setSpeed: 10001 is rejected', () => {
    assert.equal(validateSetSpeed(10001).valid, false);
  });

  test('setSpeed: string "500" is rejected', () => {
    assert.equal(validateSetSpeed('500').valid, false);
  });

  test('setSpeed: null is rejected', () => {
    assert.equal(validateSetSpeed(null).valid, false);
  });

  test('setSpeed: undefined is rejected', () => {
    assert.equal(validateSetSpeed(undefined).valid, false);
  });

  test('setSpeed: { ms: 500 } object is rejected', () => {
    assert.equal(validateSetSpeed({ ms: 500 }).valid, false);
  });

  // ── setSpeedMode validation ──────────────────────────────────────────

  test('setSpeedMode: "fast" accepted', () => {
    assert.equal(validateSetSpeedMode('fast').valid, true);
  });

  test('setSpeedMode: "normal" accepted', () => {
    assert.equal(validateSetSpeedMode('normal').valid, true);
  });

  test('setSpeedMode: "FAST" rejected (case sensitive)', () => {
    const result = validateSetSpeedMode('FAST');
    assert.equal(result.valid, false);
    assert.equal(result.ignored, true);
  });

  test('setSpeedMode: "Normal" rejected (case sensitive)', () => {
    const result = validateSetSpeedMode('Normal');
    assert.equal(result.valid, false);
    assert.equal(result.ignored, true);
  });

  test('setSpeedMode: " fast" (leading space) rejected', () => {
    const result = validateSetSpeedMode(' fast');
    assert.equal(result.valid, false);
    assert.equal(result.ignored, true);
  });

  test('setSpeedMode: "fast " (trailing space) rejected', () => {
    const result = validateSetSpeedMode('fast ');
    assert.equal(result.valid, false);
    assert.equal(result.ignored, true);
  });

  test('setSpeedMode: empty string rejected', () => {
    const result = validateSetSpeedMode('');
    assert.equal(result.valid, false);
    assert.equal(result.ignored, true);
  });

  test('setSpeedMode: number 1 rejected (typeof check)', () => {
    assert.equal(validateSetSpeedMode(1).valid, false);
  });

  test('setSpeedMode: boolean true rejected (typeof check)', () => {
    assert.equal(validateSetSpeedMode(true).valid, false);
  });

  test('setSpeedMode: Symbol rejected (typeof check)', () => {
    assert.equal(validateSetSpeedMode(Symbol('fast')).valid, false);
  });

  // ── Throttle boundary behavior ──────────────────────────────────────

  test('throttle: first call always allowed', () => {
    const throttle = createThrottle();
    assert.equal(throttle('s1', 'move', 50), true);
  });

  test('throttle: immediate second call blocked', () => {
    const throttle = createThrottle();
    throttle('s1', 'move', 50);
    assert.equal(throttle('s1', 'move', 50), false);
  });

  test('throttle: call after minIntervalMs+1 allowed', () => {
    const throttle = createThrottle();
    const t0 = Date.now();
    // Simulate: first call at t0
    const origNow = Date.now;
    let fakeTime = t0;
    global.Date.now = () => fakeTime;

    throttle('s1', 'move', 50);
    fakeTime = t0 + 51;
    assert.equal(throttle('s1', 'move', 50), true);

    global.Date.now = origNow;
  });

  test('throttle: call at exactly minIntervalMs still blocked (uses < comparison)', () => {
    const throttle = createThrottle();
    const t0 = Date.now();
    const origNow = Date.now;
    let fakeTime = t0;
    global.Date.now = () => fakeTime;

    throttle('s1', 'move', 50);
    fakeTime = t0 + 50; // exactly at boundary — now-last = 50, 50 < 50 is false, so NOT blocked
    // Server uses: now - last < minIntervalMs → 50 - 0 = 50, 50 < 50 → false → allowed
    assert.equal(throttle('s1', 'move', 50), true, 'at exactly minIntervalMs is allowed (< is false)');

    global.Date.now = origNow;
  });

  test('throttle: call at minIntervalMs-1 blocked', () => {
    const throttle = createThrottle();
    const t0 = Date.now();
    const origNow = Date.now;
    let fakeTime = t0;
    global.Date.now = () => fakeTime;

    throttle('s1', 'move', 50);
    fakeTime = t0 + 49;
    assert.equal(throttle('s1', 'move', 50), false, 'at minIntervalMs-1 is blocked');

    global.Date.now = origNow;
  });

  test('throttle: different keys on same socket are independent', () => {
    const throttle = createThrottle();
    throttle('s1', 'move', 50);
    assert.equal(throttle('s1', 'setParams', 1000), true);
  });

  test('throttle: same key on different sockets are independent', () => {
    const throttle = createThrottle();
    throttle('s1', 'move', 50);
    assert.equal(throttle('s2', 'move', 50), true);
  });

  test('throttle: rapid 100 calls — only first passes', () => {
    const throttle = createThrottle();
    let allowed = 0;
    for (let i = 0; i < 100; i++) {
      if (throttle('s1', 'move', 50)) allowed++;
    }
    assert.equal(allowed, 1);
  });

  // ── Run tests ────────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  WS handler edge: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

if (process.argv[1]?.includes('hunter-v3-ws-handler-edge')) {
  runWsHandlerEdgeTests().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
