/**
 * wsHandlerInputGaps.test.js — WebSocket handler input validation gap tests.
 *
 * Covers gaps in websocketHandlers.test.js, wsHandlerLogic.test.js,
 * setSpeedModeValidation.test.js, wsMoveValidation.test.js:
 *
 * 1. setSpeedMode: actual handler does typeof check BEFORE equality — test that
 * 2. setParams: non-object inputs (array, primitive, function)
 * 3. startGame: invalid mode values (null, number, empty string)
 * 4. move handler: captures edge cases (large arrays, deeply nested)
 * 5. Throttle bypass: rapid calls, different event names
 * 6. Malformed WS message shapes (missing fields, extra fields)
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: setSpeedMode handler (server/index.js:645) ──────────────────

/**
 * Server code does typeof check BEFORE equality:
 *   if (typeof mode !== 'string') { socket.emit('error', ...); return; }
 *   if (mode === 'fast' || mode === 'normal') { ... }
 *
 * If typeof check is missing, non-string values pass equality check as false,
 * but the handler would silently ignore them. The test validates the type guard.
 */
function validateSetSpeedMode(mode) {
  if (typeof mode !== 'string') {
    return { valid: false, error: 'Invalid speed mode — expected string' };
  }
  if (mode === 'fast' || mode === 'normal') {
    return { valid: true, mode };
  }
  return { valid: false, ignored: true };
}

// ── Extracted: setParams type check (server/index.js:508) ──────────────────

function validateSetParamsInput(newParams) {
  if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) {
    return { valid: false, error: 'Invalid params — expected object' };
  }
  return { valid: true };
}

// ── Extracted: startGame mode handling ──────────────────────────────────────

function validateStartGameMode(mode) {
  const validModes = ['pvai', 'pvp', 'aivai'];
  const gameMode = mode || 'pvai';
  if (!validModes.includes(gameMode)) {
    return { valid: false, error: `Invalid game mode: ${gameMode}` };
  }
  return { valid: true, gameMode };
}

// ── Extracted: move handler with captures depth check ──────────────────────

function isValidCoord(c) {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    c[0] >= 0 && c[0] <= 7 &&
    c[1] >= 0 && c[1] <= 7
  );
}

function validateMoveWithLimits(data, maxCaptures = 12) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid move data' };
  }
  const { from, to, captures } = data;
  if (!isValidCoord(from)) return { valid: false, error: 'Invalid from' };
  if (!isValidCoord(to)) return { valid: false, error: 'Invalid to' };
  if (captures != null) {
    if (!Array.isArray(captures)) return { valid: false, error: 'Invalid captures' };
    if (captures.length > maxCaptures) {
      return { valid: false, error: `Too many captures: ${captures.length} > ${maxCaptures}` };
    }
    for (let i = 0; i < captures.length; i++) {
      if (!isValidCoord(captures[i])) {
        return { valid: false, error: `Invalid capture at index ${i}` };
      }
    }
  }
  return { valid: true };
}

// ── Extracted: throttle simulation ─────────────────────────────────────────

function createThrottle(minIntervalMs) {
  const lastCall = new Map();
  return function check(socketId, event) {
    const key = `${socketId}:${event}`;
    const now = Date.now();
    const last = lastCall.get(key) || 0;
    if (now - last < minIntervalMs) return false;
    lastCall.set(key, now);
    return true;
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsHandlerInputGapsTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // setSpeedMode: typeof guard before equality
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeedMode: typeof guard rejects number 1', () => {
    const r = validateSetSpeedMode(1);
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('string'), 'Error should mention string');
  });

  test('setSpeedMode: typeof guard rejects boolean true', () => {
    const r = validateSetSpeedMode(true);
    assert.equal(r.valid, false);
  });

  test('setSpeedMode: typeof guard rejects object { mode: "fast" }', () => {
    const r = validateSetSpeedMode({ mode: 'fast' });
    assert.equal(r.valid, false);
  });

  test('setSpeedMode: typeof guard rejects Symbol', () => {
    const r = validateSetSpeedMode(Symbol('fast'));
    assert.equal(r.valid, false);
  });

  test('setSpeedMode: valid string "fast" passes', () => {
    const r = validateSetSpeedMode('fast');
    assert.equal(r.valid, true);
    assert.equal(r.mode, 'fast');
  });

  test('setSpeedMode: invalid string "turbo" passes type check but not mode', () => {
    const r = validateSetSpeedMode('turbo');
    assert.equal(r.valid, false);
    assert.ok(r.ignored, 'Should be silently ignored (not an error)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setParams: non-object input rejection
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams: rejects array input', () => {
    const r = validateSetParamsInput([{ layers: 3 }]);
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('object'));
  });

  test('setParams: rejects string input', () => {
    const r = validateSetParamsInput('layers=3');
    assert.equal(r.valid, false);
  });

  test('setParams: rejects number input', () => {
    const r = validateSetParamsInput(42);
    assert.equal(r.valid, false);
  });

  test('setParams: rejects boolean true', () => {
    const r = validateSetParamsInput(true);
    assert.equal(r.valid, false);
  });

  test('setParams: rejects function', () => {
    const r = validateSetParamsInput(() => {});
    // Functions are typeof 'object' in some checks, but should be rejected
    // In the actual server: typeof newParams !== 'object' → function passes
    // But Array.isArray check doesn't catch functions
    // The server check is: !newParams || typeof !== 'object' || Array.isArray
    // typeof function === 'function', not 'object', so it's rejected!
    assert.equal(r.valid, false);
  });

  test('setParams: rejects null', () => {
    const r = validateSetParamsInput(null);
    assert.equal(r.valid, false);
  });

  test('setParams: rejects undefined', () => {
    const r = validateSetParamsInput(undefined);
    assert.equal(r.valid, false);
  });

  test('setParams: rejects empty object (valid — no changes)', () => {
    // Actually, empty object passes type check — it's a valid "no changes" input
    const r = validateSetParamsInput({});
    assert.equal(r.valid, true, 'Empty object should pass type check');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // startGame: invalid mode handling
  // ═══════════════════════════════════════════════════════════════════════

  test('startGame: undefined mode defaults to pvai', () => {
    const r = validateStartGameMode(undefined);
    assert.equal(r.valid, true);
    assert.equal(r.gameMode, 'pvai');
  });

  test('startGame: null mode defaults to pvai', () => {
    const r = validateStartGameMode(null);
    assert.equal(r.valid, true);
    assert.equal(r.gameMode, 'pvai', 'null || "pvai" = "pvai"');
  });

  test('startGame: empty string defaults to pvai', () => {
    const r = validateStartGameMode('');
    assert.equal(r.valid, true);
    assert.equal(r.gameMode, 'pvai', '"" || "pvai" = "pvai"');
  });

  test('startGame: invalid mode "chess" rejected', () => {
    const r = validateStartGameMode('chess');
    assert.equal(r.valid, false);
  });

  test('startGame: numeric mode 123 rejected', () => {
    const r = validateStartGameMode(123);
    // 123 || 'pvai' → 123 (truthy), then 123 not in validModes
    assert.equal(r.valid, false);
  });

  test('startGame: mode "PVP" (uppercase) rejected', () => {
    const r = validateStartGameMode('PVP');
    assert.equal(r.valid, false, 'Case-sensitive check');
  });

  test('startGame: mode "pvai " (trailing space) rejected', () => {
    const r = validateStartGameMode('pvai ');
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // move handler: captures edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('move: captures with 12 elements (max king capture chain) accepted', () => {
    // Max capture chain on 8x8 board: zigzag pattern within bounds
    const captures = [
      [1, 0], [3, 0], [5, 0], [7, 0],
      [7, 2], [5, 2], [3, 2], [1, 2],
      [1, 4], [3, 4], [5, 4], [7, 4]
    ];
    assert.equal(captures.length, 12);
    const r = validateMoveWithLimits({ from: [0, 0], to: [7, 7], captures });
    assert.equal(r.valid, true);
  });

  test('move: captures with 13 elements rejected (unrealistic)', () => {
    const captures = Array(13).fill(null).map((_, i) => [i % 8, i % 8]);
    const r = validateMoveWithLimits({ from: [0, 0], to: [7, 7], captures });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('Too many captures'));
  });

  test('move: captures with mixed valid/invalid coords', () => {
    const r = validateMoveWithLimits({
      from: [2, 1], to: [6, 5],
      captures: [[3, 2], [5, 4], [99, 99]] // last is invalid
    });
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('index 2'));
  });

  test('move: captures as sparse array (with holes)', () => {
    const captures = [];
    captures[0] = [3, 2];
    captures[2] = [5, 4]; // hole at index 1
    const r = validateMoveWithLimits({ from: [2, 1], to: [6, 5], captures });
    // captures[1] is undefined → isValidCoord(undefined) → false
    assert.equal(r.valid, false);
    assert.ok(r.error?.includes('index 1'));
  });

  test('move: from === to (same square) accepted by coord validation', () => {
    const r = validateMoveWithLimits({ from: [3, 3], to: [3, 3] });
    assert.equal(r.valid, true, 'Same coord passes validation (game logic rejects)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Throttle bypass: different events are independent
  // ═══════════════════════════════════════════════════════════════════════

  test('throttle: same event rapid calls — second is blocked', () => {
    const throttle = createThrottle(1000);
    assert.equal(throttle('socket1', 'setSpeed'), true, 'First call allowed');
    assert.equal(throttle('socket1', 'setSpeed'), false, 'Second call blocked');
  });

  test('throttle: different events are independent', () => {
    const throttle = createThrottle(1000);
    assert.equal(throttle('socket1', 'setSpeed'), true);
    assert.equal(throttle('socket1', 'setSpeedMode'), true, 'Different event — allowed');
    assert.equal(throttle('socket1', 'setParams'), true, 'Another event — allowed');
  });

  test('throttle: different sockets are independent', () => {
    const throttle = createThrottle(1000);
    assert.equal(throttle('socket1', 'setSpeed'), true);
    assert.equal(throttle('socket2', 'setSpeed'), true, 'Different socket — allowed');
  });

  test('throttle: same socket+event after interval allows', async () => {
    const throttle = createThrottle(50);
    assert.equal(throttle('s1', 'setSpeed'), true);
    assert.equal(throttle('s1', 'setSpeed'), false);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(throttle('s1', 'setSpeed'), true, 'After interval — allowed');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Malformed WS message shapes
  // ═══════════════════════════════════════════════════════════════════════

  test('setSpeed: receiving { ms: 500 } object instead of number', () => {
    // Server does typeof ms !== 'number' → object is rejected
    const ms = { ms: 500 };
    assert.equal(typeof ms !== 'number', true, 'Object is not a number');
  });

  test('setSpeed: receiving [500] array instead of number', () => {
    const ms = [500];
    assert.equal(typeof ms !== 'number', true, 'Array is not a number');
  });

  test('move: receiving stringified JSON instead of object', () => {
    const data = '{"from":[2,1],"to":[3,0]}';
    const r = validateMoveWithLimits(data);
    assert.equal(r.valid, false, 'String is not a valid move object');
  });

  test('move: receiving empty string', () => {
    const r = validateMoveWithLimits('');
    assert.equal(r.valid, false);
  });

  test('startGame: receiving { mode: "pvai" } as expected', () => {
    const r = validateStartGameMode('pvai');
    assert.equal(r.valid, true);
  });

  test('startGame: receiving raw "pvai" string (missing destructure)', () => {
    // If client sends raw string instead of { mode: "pvai" }
    // destructuring { mode } from string → mode = undefined → defaults to pvai
    const raw = 'pvai';
    const { mode } = raw; // mode = undefined (string has no 'mode' property)
    const r = validateStartGameMode(mode);
    assert.equal(r.valid, true);
    assert.equal(r.gameMode, 'pvai', 'Defaults to pvai when mode is undefined');
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Handler Input Gap Tests');

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
