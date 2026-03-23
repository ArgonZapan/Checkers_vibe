/**
 * trainerArrayMoves.test.js — Tests for trainer isMoveLegal with array [row,col] coords
 * and setModelParams batch size clamping.
 *
 * Covers: GAP-13 (isMoveLegal array coords) and GAP-14 (setModelParams validation).
 * Extracted logic — no engine or model required.
 */

import assert from 'node:assert/strict';

// ── Extracted: isMoveLegal with array coord support (mirrors trainer.js) ────

function isMoveLegal(move, legalMoves) {
  if (!move || !Array.isArray(legalMoves) || legalMoves.length === 0) return false;
  return legalMoves.some(lm => {
    const sameFrom = Array.isArray(lm.from)
      ? lm.from[0] === move.from?.[0] && lm.from[1] === move.from?.[1]
      : lm.from === move.from;
    const sameTo = Array.isArray(lm.to)
      ? lm.to[0] === move.to?.[0] && lm.to[1] === move.to?.[1]
      : lm.to === move.to;
    if (!sameFrom || !sameTo) return false;
    if (move.captures && move.captures.length > 0) {
      if (!lm.captures || lm.captures.length !== move.captures.length) return false;
      return move.captures.every((c, i) => c[0] === lm.captures[i]?.[0] && c[1] === lm.captures[i]?.[1]);
    }
    return true;
  });
}

// ── Extracted: setModelParams batch size clamping (mirrors trainer.js) ──────

function clampModelParams(params) {
  const result = { ...params };
  if (result.batchSize !== undefined) {
    const bs = result.batchSize;
    if (bs < 8 || bs > 256) {
      result.batchSize = Math.max(8, Math.min(256, bs));
    }
  }
  return result;
}

// ── Extracted: validateAndFallback with array coords ────────────────────────

function validateMove(move) {
  if (!move || typeof move !== 'object') {
    return { valid: false, reason: 'move is null/undefined/not an object' };
  }
  if (!('from' in move) || !('to' in move)) {
    return { valid: false, reason: 'move missing from/to fields' };
  }
  const { from, to } = move;
  if (typeof from !== 'number' || typeof to !== 'number') {
    return { valid: false, reason: `from/to not numbers` };
  }
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { valid: false, reason: `from/to not integers` };
  }
  if (from < 0 || from > 63 || to < 0 || to > 63) {
    return { valid: false, reason: `from/to out of range 0-63` };
  }
  if (from === to) {
    return { valid: false, reason: `from === to (no-op move)` };
  }
  return { valid: true, move };
}

function validateAndFallbackArray(chosenMove, legalMoves) {
  // Resolve chosen move to a full move object
  let selectedMove;
  if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
    const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
    selectedMove = legalMoves[idx] || null;
  } else if (chosenMove && typeof chosenMove === 'object' && 'from' in chosenMove) {
    selectedMove = chosenMove;
  }

  // For array-coordinate moves, validate by checking in legal list
  if (selectedMove && Array.isArray(selectedMove.from)) {
    if (!isMoveLegal(selectedMove, legalMoves)) {
      return legalMoves[0] || null;
    }
    return selectedMove;
  }

  // For scalar moves, use standard validation
  const validation = validateMove(selectedMove);
  if (!validation.valid) {
    return legalMoves[0] || null;
  }
  if (!isMoveLegal(selectedMove, legalMoves)) {
    return legalMoves[0] || null;
  }
  return selectedMove;
}

// ── Test data ───────────────────────────────────────────────────────────────

const SCALAR_MOVES = [
  { from: 9, to: 13, index: 0 },
  { from: 10, to: 14, index: 1 },
  { from: 11, to: 15, index: 2 },
];

const ARRAY_MOVES = [
  { from: [2, 1], to: [3, 0] },
  { from: [2, 1], to: [3, 2] },
  { from: [2, 3], to: [3, 4] },
];

const MIXED_MOVES = [
  { from: [2, 1], to: [3, 0] },
  { from: 10, to: 14, index: 1 },
];

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runTrainerArrayMovesTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // isMoveLegal — array coordinates
  // ═══════════════════════════════════════════════════════════════════════

  test('isMoveLegal: array coord match', () => {
    const move = { from: [2, 1], to: [3, 0] };
    assert.ok(isMoveLegal(move, ARRAY_MOVES));
  });

  test('isMoveLegal: array coord no match', () => {
    const move = { from: [5, 5], to: [6, 6] };
    assert.ok(!isMoveLegal(move, ARRAY_MOVES));
  });

  test('isMoveLegal: scalar coord match', () => {
    const move = { from: 9, to: 13 };
    assert.ok(isMoveLegal(move, SCALAR_MOVES));
  });

  test('isMoveLegal: mixed legal moves — scalar move finds match', () => {
    const move = { from: 10, to: 14 };
    assert.ok(isMoveLegal(move, MIXED_MOVES));
  });

  test('isMoveLegal: mixed legal moves — array move finds match', () => {
    const move = { from: [2, 1], to: [3, 0] };
    assert.ok(isMoveLegal(move, MIXED_MOVES));
  });

  test('isMoveLegal: captures matching', () => {
    const legalMoves = [
      { from: [2, 1], to: [4, 3], captures: [[3, 2]] },
      { from: [2, 3], to: [4, 5], captures: [[3, 4]] },
    ];
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    assert.ok(isMoveLegal(move, legalMoves));
  });

  test('isMoveLegal: captures mismatch', () => {
    const legalMoves = [
      { from: [2, 1], to: [4, 3], captures: [[3, 2]] },
    ];
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 4]] }; // different capture
    assert.ok(!isMoveLegal(move, legalMoves));
  });

  test('isMoveLegal: move has captures but legal move does not', () => {
    const legalMoves = [{ from: [2, 1], to: [3, 0] }];
    const move = { from: [2, 1], to: [3, 0], captures: [[3, 2]] };
    assert.ok(!isMoveLegal(move, legalMoves));
  });

  test('isMoveLegal: move has no captures (regular move)', () => {
    const legalMoves = [{ from: [2, 1], to: [3, 0] }];
    const move = { from: [2, 1], to: [3, 0] };
    assert.ok(isMoveLegal(move, legalMoves));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // validateAndFallback — array coordinates
  // ═══════════════════════════════════════════════════════════════════════

  test('validateAndFallback: valid array move passes through', () => {
    const move = { from: [2, 1], to: [3, 0] };
    const result = validateAndFallbackArray(move, ARRAY_MOVES);
    assert.deepEqual(result.from, [2, 1]);
    assert.deepEqual(result.to, [3, 0]);
  });

  test('validateAndFallback: invalid array move falls back', () => {
    const move = { from: [5, 5], to: [6, 6] };
    const result = validateAndFallbackArray(move, ARRAY_MOVES);
    // Should fall back to first legal move
    assert.ok(result);
    assert.ok(ARRAY_MOVES.some(m => m.from[0] === result.from[0] && m.from[1] === result.from[1]));
  });

  test('validateAndFallback: null array move falls back', () => {
    const result = validateAndFallbackArray(null, ARRAY_MOVES);
    assert.ok(result);
  });

  test('validateAndFallback: scalar move with index works', () => {
    const result = validateAndFallbackArray({ index: 1 }, SCALAR_MOVES);
    assert.ok(result);
    assert.equal(result.from, 10);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setModelParams batch size clamping
  // ═══════════════════════════════════════════════════════════════════════

  test('setModelParams: batchSize=4 clamped to 8', () => {
    const r = clampModelParams({ batchSize: 4 });
    assert.equal(r.batchSize, 8);
  });

  test('setModelParams: batchSize=7 clamped to 8', () => {
    const r = clampModelParams({ batchSize: 7 });
    assert.equal(r.batchSize, 8);
  });

  test('setModelParams: batchSize=8 boundary passes', () => {
    const r = clampModelParams({ batchSize: 8 });
    assert.equal(r.batchSize, 8);
  });

  test('setModelParams: batchSize=64 passes', () => {
    const r = clampModelParams({ batchSize: 64 });
    assert.equal(r.batchSize, 64);
  });

  test('setModelParams: batchSize=256 boundary passes', () => {
    const r = clampModelParams({ batchSize: 256 });
    assert.equal(r.batchSize, 256);
  });

  test('setModelParams: batchSize=257 clamped to 256', () => {
    const r = clampModelParams({ batchSize: 257 });
    assert.equal(r.batchSize, 256);
  });

  test('setModelParams: batchSize=1000 clamped to 256', () => {
    const r = clampModelParams({ batchSize: 1000 });
    assert.equal(r.batchSize, 256);
  });

  test('setModelParams: batchSize=0 clamped to 8', () => {
    const r = clampModelParams({ batchSize: 0 });
    assert.equal(r.batchSize, 8);
  });

  test('setModelParams: batchSize=-50 clamped to 8', () => {
    const r = clampModelParams({ batchSize: -50 });
    assert.equal(r.batchSize, 8);
  });

  test('setModelParams: undefined batchSize not modified', () => {
    const r = clampModelParams({ layers: 3 });
    assert.equal(r.batchSize, undefined);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Trainer Array Moves & setModelParams Tests');

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
