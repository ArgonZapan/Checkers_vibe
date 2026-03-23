/**
 * aiMovePrediction.test.js — Tests for AI move prediction fallback logic.
 *
 * Source logic (server/index.js aiMove function):
 *   1. Get legal moves from C++ engine
 *   2. Try to predict best move using model
 *   3. If model is null/undefined → catch error → random fallback
 *   4. If predict() throws → catch error → random fallback
 *   5. If predict() returns null/undefined → selectedMove validation fails → random fallback
 *   6. If predicted move not in legalMoves → random fallback
 *
 * Tests are self-contained (no server, no HTTP, no Socket.IO).
 */

import assert from 'node:assert/strict';

// ── Extracted validation logic (mirrors server/index.js aiMove) ───────────

/**
 * Validates that a predicted move is in the list of legal moves.
 * Mirrors the safety check in aiMove().
 */
function isPredictedMoveValid(predictedMove, legalMoves) {
  if (!predictedMove) return false;
  return legalMoves.some(m =>
    m.from[0] === predictedMove.from?.[0] && m.from[1] === predictedMove.from?.[1] &&
    m.to[0] === predictedMove.to?.[0] && m.to[1] === predictedMove.to?.[1]
  );
}

/**
 * Simulates the model check from aiMove().
 * Returns true if model exists and is usable.
 */
function isModelReady(model) {
  return !!model;
}

/**
 * Builds the move body for C++ engine.
 */
function buildMoveBody(move) {
  const body = { from: move.from, to: move.to };
  if (move.captures && move.captures.length > 0) {
    body.captures = move.captures;
  }
  return body;
}

/**
 * Selects a random move from legal moves (fallback behavior).
 */
function selectRandomMove(legalMoves) {
  if (!legalMoves || legalMoves.length === 0) return null;
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

// ── Test runner ───────────────────────────────────────────────────────────

export async function runAiMovePredictionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Model readiness check
  // ═══════════════════════════════════════════════════════════════════════

  test('isModelReady: model object → true', () => {
    const model = { predict: () => {} };
    assert.equal(isModelReady(model), true);
  });

  test('isModelReady: null → false', () => {
    assert.equal(isModelReady(null), false);
  });

  test('isModelReady: undefined → false', () => {
    assert.equal(isModelReady(undefined), false);
  });

  test('isModelReady: empty object → true (truthy)', () => {
    assert.equal(isModelReady({}), true);
  });

  test('isModelReady: 0 → false', () => {
    assert.equal(isModelReady(0), false);
  });

  test('isModelReady: empty string → false', () => {
    assert.equal(isModelReady(''), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Predicted move validation
  // ═══════════════════════════════════════════════════════════════════════

  const legalMoves = [
    { from: [5, 0], to: [4, 1], captures: [] },
    { from: [5, 2], to: [4, 3], captures: [] },
    { from: [5, 4], to: [4, 5], captures: [[4, 1]], index: 0 },
  ];

  test('isPredictedMoveValid: valid move in legalMoves → true', () => {
    const predicted = { from: [5, 0], to: [4, 1] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), true);
  });

  test('isPredictedMoveValid: valid move with captures → true', () => {
    const predicted = { from: [5, 4], to: [4, 5] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), true);
  });

  test('isPredictedMoveValid: move NOT in legalMoves → false', () => {
    const predicted = { from: [3, 0], to: [2, 1] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), false);
  });

  test('isPredictedMoveValid: null → false', () => {
    assert.equal(isPredictedMoveValid(null, legalMoves), false);
  });

  test('isPredictedMoveValid: undefined → false', () => {
    assert.equal(isPredictedMoveValid(undefined, legalMoves), false);
  });

  test('isPredictedMoveValid: object with wrong from → false', () => {
    const predicted = { from: [99, 99], to: [4, 1] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), false);
  });

  test('isPredictedMoveValid: object with wrong to → false', () => {
    const predicted = { from: [5, 0], to: [99, 99] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), false);
  });

  test('isPredictedMoveValid: object with null from → false', () => {
    const predicted = { from: null, to: [4, 1] };
    assert.equal(isPredictedMoveValid(predicted, legalMoves), false);
  });

  test('isPredictedMoveValid: empty legalMoves array → false', () => {
    const predicted = { from: [5, 0], to: [4, 1] };
    assert.equal(isPredictedMoveValid(predicted, []), false);
  });

  test('isPredictedMoveValid: empty object → false', () => {
    assert.equal(isPredictedMoveValid({}, legalMoves), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildMoveBody
  // ═══════════════════════════════════════════════════════════════════════

  test('buildMoveBody: simple move without captures', () => {
    const move = { from: [5, 0], to: [4, 1], captures: [] };
    const body = buildMoveBody(move);
    assert.deepEqual(body.from, [5, 0]);
    assert.deepEqual(body.to, [4, 1]);
    assert.equal(body.captures, undefined, 'Empty captures should not be in body');
  });

  test('buildMoveBody: capture move with captures', () => {
    const move = { from: [5, 0], to: [3, 2], captures: [[4, 1]] };
    const body = buildMoveBody(move);
    assert.deepEqual(body.from, [5, 0]);
    assert.deepEqual(body.to, [3, 2]);
    assert.deepEqual(body.captures, [[4, 1]]);
  });

  test('buildMoveBody: move with multiple captures', () => {
    const move = { from: [7, 0], to: [3, 4], captures: [[6, 1], [4, 3]] };
    const body = buildMoveBody(move);
    assert.deepEqual(body.captures, [[6, 1], [4, 3]]);
  });

  test('buildMoveBody: move without captures property → no captures in body', () => {
    const move = { from: [5, 0], to: [4, 1] };
    const body = buildMoveBody(move);
    assert.equal(body.captures, undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // selectRandomMove (fallback)
  // ═══════════════════════════════════════════════════════════════════════

  test('selectRandomMove: returns a move from legalMoves', () => {
    const move = selectRandomMove(legalMoves);
    assert.ok(move, 'Should return a move');
    assert.ok(legalMoves.includes(move), 'Should be one of the legal moves');
  });

  test('selectRandomMove: empty array → null', () => {
    assert.equal(selectRandomMove([]), null);
  });

  test('selectRandomMove: null → null', () => {
    assert.equal(selectRandomMove(null), null);
  });

  test('selectRandomMove: undefined → null', () => {
    assert.equal(selectRandomMove(undefined), null);
  });

  test('selectRandomMove: single move → always returns that move', () => {
    const single = [{ from: [5, 0], to: [4, 1] }];
    const move = selectRandomMove(single);
    assert.deepEqual(move, single[0]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full fallback scenarios
  // ═══════════════════════════════════════════════════════════════════════

  test('fallback scenario: model null → should use random move', () => {
    const model = null;
    const moves = legalMoves;

    // Simulate aiMove logic
    if (!isModelReady(model)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback), 'Fallback should be a legal move');
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('fallback scenario: model undefined → should use random move', () => {
    const model = undefined;
    const moves = legalMoves;

    if (!isModelReady(model)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback));
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('fallback scenario: prediction returns null → should use random move', () => {
    const prediction = null;
    const moves = legalMoves;

    const selectedMove = prediction?.move;
    if (!isPredictedMoveValid(selectedMove, moves)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback));
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('fallback scenario: prediction returns undefined → should use random move', () => {
    const prediction = undefined;
    const moves = legalMoves;

    const selectedMove = prediction?.move;
    if (!isPredictedMoveValid(selectedMove, moves)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback));
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('fallback scenario: prediction.move not in legalMoves → should use random move', () => {
    const prediction = { move: { from: [0, 0], to: [1, 1] } };
    const moves = legalMoves;

    const selectedMove = prediction.move;
    if (!isPredictedMoveValid(selectedMove, moves)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback));
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('fallback scenario: prediction.move is null → should use random move', () => {
    const prediction = { move: null };
    const moves = legalMoves;

    const selectedMove = prediction.move;
    if (!isPredictedMoveValid(selectedMove, moves)) {
      const fallback = selectRandomMove(moves);
      assert.ok(moves.includes(fallback));
      return;
    }
    assert.fail('Should have entered fallback path');
  });

  test('normal scenario: valid prediction → use predicted move', () => {
    const prediction = { move: { from: [5, 2], to: [4, 3] } };
    const moves = legalMoves;

    const selectedMove = prediction.move;
    assert.equal(isPredictedMoveValid(selectedMove, moves), true);
    assert.deepEqual(selectedMove.from, [5, 2]);
    assert.deepEqual(selectedMove.to, [4, 3]);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 AI Move Prediction Fallback Tests');

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
