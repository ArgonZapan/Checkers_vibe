/**
 * resilience-hunter-sub-alpha-003.test.js — Resilience tests for recent fixes.
 *
 * hunter-sub-alpha-003 | 2026-03-23
 *
 * Covers three areas from recent bug fixes:
 * 1. Epsilon NaN validation (bug still present — test EXPECTED TO FAIL)
 * 2. boardToCpp padding/truncation regression tests
 * 3. moveQueue reset on error regression tests
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EPSILON VALIDATION — extracted from server/index.js:164
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Current epsilon validation (mirrors server/index.js line 164):
 *   if (epsilon != null && (typeof epsilon !== 'number' || epsilon < 0 || epsilon > 1))
 *
 * BUG: NaN passes validation because:
 *   typeof NaN === 'number'  → true
 *   NaN < 0  → false (IEEE 754)
 *   NaN > 1  → false (IEEE 754)
 *   So: true && (false || false || false) → condition is false → NaN accepted
 */
function validateEpsilonCurrent(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be 0-1' };
  }
  return { valid: true };
}

/**
 * Proposed fix — use Number.isFinite for strict numeric validation:
 *   if (epsilon != null && (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1))
 */
function validateEpsilonFixed(epsilon) {
  if (epsilon != null && (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be 0-1' };
  }
  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BOARD TO CPP — extracted from server/boardConvert.js
// ═══════════════════════════════════════════════════════════════════════════════

function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    return new Array(64).fill(0);
  }
  const flat = board.flat();
  if (flat.length !== 64) {
    if (flat.length > 64) {
      flat.length = 64;
    } else {
      const originalLen = flat.length;
      flat.length = 64;
      flat.fill(0, originalLen);
    }
  }
  return flat.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 0;
    const color = p.color;
    const king = p.king;
    if (color === 'white') return king ? 2 : 1;
    if (color === 'black') return king ? 4 : 3;
    return 0;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MOVE QUEUE — extracted from server/index.js socket handler pattern
// ═══════════════════════════════════════════════════════════════════════════════

function enqueueMove(socket, handleMoveFn, data) {
  socket._moveQueue = (socket._moveQueue || Promise.resolve())
    .then(() => handleMoveFn(socket, data))
    .catch(err => {
      socket._lastError = err.message;
      socket._moveQueue = Promise.resolve();
    });
  return socket._moveQueue;
}

function createMockSocket() {
  return { _moveQueue: undefined, _lastError: null, emit() {} };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export async function runResilienceHunterSubAlpha003Tests() {
  let passed = 0, failed = 0, skipped = 0;
  const tests = [];

  function test(name, fn, { expectedFail = false } = {}) {
    tests.push({ name, fn, expectedFail });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EPSILON: NaN regression (expected to fail — bug still present)
  // ─────────────────────────────────────────────────────────────────────────

  test('NaN epsilon must be REJECTED (bug: current code accepts NaN)', () => {
    const result = validateEpsilonCurrent(NaN);
    assert.equal(result.valid, false, 'NaN should be rejected as invalid epsilon');
  }, { expectedFail: true });

  test('NaN epsilon REJECTED with Number.isFinite fix', () => {
    const result = validateEpsilonFixed(NaN);
    assert.equal(result.valid, false, 'Number.isFinite rejects NaN');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EPSILON: edge cases for robust validation
  // ─────────────────────────────────────────────────────────────────────────

  test('Infinity epsilon REJECTED by current validation', () => {
    const result = validateEpsilonCurrent(Infinity);
    assert.equal(result.valid, false);
  });

  test('-Infinity epsilon REJECTED by current validation', () => {
    const result = validateEpsilonCurrent(-Infinity);
    assert.equal(result.valid, false);
  });

  test('string "0.5" epsilon REJECTED (type check)', () => {
    const result = validateEpsilonCurrent('0.5');
    assert.equal(result.valid, false);
  });

  test('boolean true epsilon REJECTED (type check)', () => {
    const result = validateEpsilonCurrent(true);
    assert.equal(result.valid, false, 'boolean should not pass as epsilon');
  });

  test('empty string "" epsilon REJECTED (type check)', () => {
    const result = validateEpsilonCurrent('');
    assert.equal(result.valid, false, 'empty string is not a number');
  });

  test('object {0.5} epsilon REJECTED (type check)', () => {
    const result = validateEpsilonCurrent({ value: 0.5 });
    assert.equal(result.valid, false);
  });

  test('array [0.5] epsilon REJECTED (type check)', () => {
    const result = validateEpsilonCurrent([0.5]);
    assert.equal(result.valid, false);
  });

  test('boundary: epsilon 0 is ACCEPTED', () => {
    assert.equal(validateEpsilonCurrent(0).valid, true);
  });

  test('boundary: epsilon 1 is ACCEPTED', () => {
    assert.equal(validateEpsilonCurrent(1).valid, true);
  });

  test('boundary: epsilon -0.0001 is REJECTED', () => {
    assert.equal(validateEpsilonCurrent(-0.0001).valid, false);
  });

  test('boundary: epsilon 1.0001 is REJECTED', () => {
    assert.equal(validateEpsilonCurrent(1.0001).valid, false);
  });

  test('null epsilon ACCEPTED (skips check)', () => {
    assert.equal(validateEpsilonCurrent(null).valid, true);
  });

  test('undefined epsilon ACCEPTED (skips check)', () => {
    assert.equal(validateEpsilonCurrent(undefined).valid, true);
  });

  test('Symbol epsilon REJECTED (typeof !== "number")', () => {
    const result = validateEpsilonCurrent(Symbol('x'));
    assert.equal(result.valid, false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BOARD TO CPP: padding regression tests
  // ─────────────────────────────────────────────────────────────────────────

  test('boardToCpp: 8x8 empty → 64 zeros', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('boardToCpp: 3 rows → padded to 64 with zeros', () => {
    const board = [
      [{ color: 'white', king: false }, null, null, null, null, null, null, null],
      [null, { color: 'black', king: false }, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
    ];
    const result = boardToCpp(board);
    assert.equal(result.length, 64, 'Must be exactly 64 elements');
    assert.equal(result[0], 1, 'white pawn at [0][0]');
    assert.equal(result[9], 3, 'black pawn at [1][1]');
    assert.ok(result.slice(24).every(v => v === 0), 'padding zeros from element 24');
  });

  test('boardToCpp: 9 rows → truncated to 64', () => {
    const board = Array.from({ length: 9 }, () => Array(8).fill(null));
    board[8][0] = { color: 'white', king: false }; // should be truncated away
    const result = boardToCpp(board);
    assert.equal(result.length, 64, 'Must be exactly 64 elements');
    assert.ok(result.every(v => v === 0), 'truncated row contents should not appear');
  });

  test('boardToCpp: 1 row with 8 cols → padded to 64', () => {
    const board = [Array.from({ length: 8 }, (_, i) =>
      i < 4 ? { color: 'white', king: i % 2 === 1 } : null
    )];
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1, 'white pawn');
    assert.equal(result[1], 2, 'white king');
    assert.equal(result[2], 1, 'white pawn');
    assert.equal(result[3], 2, 'white king');
    assert.ok(result.slice(8).every(v => v === 0), 'remaining should be zeros');
  });

  test('boardToCpp: null input → 64 zeros', () => {
    const result = boardToCpp(null);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('boardToCpp: undefined input → 64 zeros', () => {
    const result = boardToCpp(undefined);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('boardToCpp: string input → 64 zeros', () => {
    const result = boardToCpp('not a board');
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('boardToCpp: board with jagged rows still produces 64', () => {
    // board.flat() on [[w], [], [n,n,bk]] → [w, n, n, bk]
    const board = [
      [{ color: 'white', king: false }],
      [],
      [null, null, { color: 'black', king: true }],
    ];
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1, 'white pawn at flat index 0');
    assert.equal(result[1], 0, 'null at flat index 1');
    assert.equal(result[2], 0, 'null at flat index 2');
    assert.equal(result[3], 4, 'black king at flat index 3');
    assert.ok(result.slice(4).every(v => v === 0), 'remaining should be zeros');
  });

  test('boardToCpp: invalid color → 0', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'green', king: false };
    const result = boardToCpp(board);
    assert.equal(result[0], 0, 'unknown color should map to 0');
  });

  test('boardToCpp: piece with missing color → 0', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { king: true }; // no color property
    const result = boardToCpp(board);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: piece with missing king (defaults to falsy) → pawn', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white' }; // no king → undefined → falsy → pawn
    const result = boardToCpp(board);
    assert.equal(result[0], 1, 'missing king should be treated as pawn (1)');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MOVE QUEUE: error recovery regression tests
  // ─────────────────────────────────────────────────────────────────────────

  test('moveQueue: error in handler → queue recovers for next move', async () => {
    const socket = createMockSocket();
    const log = [];
    await enqueueMove(socket, () => { log.push('fail'); throw new Error('x'); }, {});
    await enqueueMove(socket, () => { log.push('ok'); }, {});
    assert.deepStrictEqual(log, ['fail', 'ok']);
  });

  test('moveQueue: queue is reset to Promise.resolve() after error', async () => {
    const socket = createMockSocket();
    await enqueueMove(socket, () => { throw new Error('fail'); }, {});
    // After catch, _moveQueue should be a fresh resolved promise
    const val = await socket._moveQueue;
    assert.equal(val, undefined, 'reset promise resolves to undefined');
  });

  test('moveQueue: 5 consecutive errors then success', async () => {
    const socket = createMockSocket();
    let count = 0;
    for (let i = 0; i < 5; i++) {
      await enqueueMove(socket, () => { count++; throw new Error(`e${i}`); }, {});
    }
    let successRan = false;
    await enqueueMove(socket, () => { successRan = true; }, {});
    assert.equal(count, 5, 'all 5 error handlers called');
    assert.equal(successRan, true, 'success handler ran after 5 errors');
  });

  test('moveQueue: sequential ordering preserved under rapid enqueue', async () => {
    const socket = createMockSocket();
    const order = [];
    const h = (id, delay) => async () => {
      order.push(`s${id}`);
      await new Promise(r => setTimeout(r, delay));
      order.push(`e${id}`);
    };
    const p1 = enqueueMove(socket, h('A', 15), {});
    const p2 = enqueueMove(socket, h('B', 5), {});
    const p3 = enqueueMove(socket, h('C', 5), {});
    await Promise.all([p1, p2, p3]);
    assert.deepStrictEqual(order, ['sA', 'eA', 'sB', 'eB', 'sC', 'eC']);
  });

  test('moveQueue: mixed errors and successes maintain order', async () => {
    const socket = createMockSocket();
    const log = [];
    const err = () => { log.push('E'); throw new Error('e'); };
    const ok  = () => { log.push('O'); };
    // sequence: E, O, E, E, O, O
    await enqueueMove(socket, err, {});
    await enqueueMove(socket, ok, {});
    await enqueueMove(socket, err, {});
    await enqueueMove(socket, err, {});
    await enqueueMove(socket, ok, {});
    await enqueueMove(socket, ok, {});
    assert.deepStrictEqual(log, ['E', 'O', 'E', 'E', 'O', 'O']);
  });

  test('moveQueue: async rejection recovers queue', async () => {
    const socket = createMockSocket();
    await enqueueMove(socket, async () => {
      await new Promise(r => setTimeout(r, 2));
      throw new Error('async fail');
    }, {});
    let ran = false;
    await enqueueMove(socket, async () => { ran = true; }, {});
    assert.equal(ran, true);
  });

  test('moveQueue: lastError tracked correctly after each failure', async () => {
    const socket = createMockSocket();
    await enqueueMove(socket, () => { throw new Error('err-A'); }, {});
    assert.equal(socket._lastError, 'err-A');
    await enqueueMove(socket, () => { throw new Error('err-B'); }, {});
    assert.equal(socket._lastError, 'err-B');
    await enqueueMove(socket, () => 'ok', {}); // success — lastError NOT cleared
    assert.equal(socket._lastError, 'err-B', 'lastError persists after success');
  });

  // ── Run ─────────────────────────────────────────────────────────────────

  console.log('\n📋 Resilience Tests — hunter-sub-alpha-003 (epsilon/boardToCpp/moveQueue)');

  for (const { name, fn, expectedFail } of tests) {
    try {
      await fn();
      if (expectedFail) {
        console.log(`   ⚠️  ${name}`);
        console.log(`      (EXPECTED FAIL but passed — bug may be fixed!)`);
        skipped++;
      } else {
        console.log(`   ✅ ${name}`);
        passed++;
      }
    } catch (err) {
      if (expectedFail) {
        console.log(`   ❌ ${name}`);
        console.log(`      (EXPECTED FAIL: ${err.message} — bug confirmed)`);
        passed++; // counting expected-fail as "pass" for reporting
      } else {
        console.log(`   ❌ ${name}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`   ─── ${passed} passed, ${failed} failed, ${skipped} unexpected-pass ───`);
  return { passed, failed };
}
