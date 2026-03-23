/**
 * aiFallbackLogic.test.js — Tests for AI move fallback logic.
 *
 * Covers: when prediction fails or returns invalid move, the system falls
 * back to random selection. Also covers move body construction with captures.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: AI move validation & fallback (mirrors server/index.js) ──────

/**
 * Select a move: prefer predicted, fall back to random if invalid.
 */
function selectMove(predictedMove, legalMoves) {
  if (!legalMoves || legalMoves.length === 0) return null;

  // Check if predicted move is in legalMoves
  if (predictedMove && legalMoves.some(m =>
    m.from[0] === predictedMove.from?.[0] && m.from[1] === predictedMove.from?.[1] &&
    m.to[0] === predictedMove.to?.[0] && m.to[1] === predictedMove.to?.[1]
  )) {
    return predictedMove;
  }

  // Fallback: random (but we test with first for determinism)
  return legalMoves[0];
}

/**
 * Build move body for C++ API.
 */
function buildMoveBody(move) {
  const body = { from: move.from, to: move.to };
  if (move.captures && move.captures.length > 0) {
    body.captures = move.captures;
  }
  return body;
}

/**
 * Check if a move is valid (has required fields).
 */
function isMoveValid(move) {
  if (!move) return false;
  if (!Array.isArray(move.from) || move.from.length !== 2) return false;
  if (!Array.isArray(move.to) || move.to.length !== 2) return false;
  return true;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAiFallbackLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  const legalMoves = [
    { from: [2, 1], to: [3, 0], captures: [], index: 0 },
    { from: [2, 1], to: [3, 2], captures: [], index: 1 },
    { from: [2, 3], to: [3, 4], captures: [[3, 2]], index: 2 },
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // selectMove — predicted move validation
  // ═══════════════════════════════════════════════════════════════════════

  test('selectMove: valid predicted move is returned', () => {
    const predicted = { from: [2, 1], to: [3, 0] };
    const result = selectMove(predicted, legalMoves);
    assert.deepEqual(result.from, [2, 1]);
    assert.deepEqual(result.to, [3, 0]);
  });

  test('selectMove: invalid predicted move falls back to first legal', () => {
    const predicted = { from: [99, 99], to: [0, 0] };
    const result = selectMove(predicted, legalMoves);
    assert.deepEqual(result, legalMoves[0]);
  });

  test('selectMove: null predicted move falls back', () => {
    const result = selectMove(null, legalMoves);
    assert.deepEqual(result, legalMoves[0]);
  });

  test('selectMove: undefined predicted move falls back', () => {
    const result = selectMove(undefined, legalMoves);
    assert.deepEqual(result, legalMoves[0]);
  });

  test('selectMove: empty legalMoves returns null', () => {
    const result = selectMove({ from: [2, 1], to: [3, 0] }, []);
    assert.equal(result, null);
  });

  test('selectMove: null legalMoves returns null', () => {
    const result = selectMove({ from: [2, 1], to: [3, 0] }, null);
    assert.equal(result, null);
  });

  test('selectMove: undefined legalMoves returns null', () => {
    const result = selectMove({ from: [2, 1], to: [3, 0] }, undefined);
    assert.equal(result, null);
  });

  test('selectMove: predicted move without from falls back', () => {
    const predicted = { to: [3, 0] };
    const result = selectMove(predicted, legalMoves);
    assert.deepEqual(result, legalMoves[0]);
  });

  test('selectMove: predicted move without to falls back', () => {
    const predicted = { from: [2, 1] };
    const result = selectMove(predicted, legalMoves);
    assert.deepEqual(result, legalMoves[0]);
  });

  test('selectMove: capture move predicted correctly', () => {
    const predicted = { from: [2, 3], to: [3, 4] };
    const result = selectMove(predicted, legalMoves);
    assert.deepEqual(result.from, [2, 3]);
    assert.deepEqual(result.to, [3, 4]);
  });

  test('selectMove: single legal move returns it', () => {
    const single = [{ from: [5, 0], to: [6, 1] }];
    const result = selectMove({ from: [0, 0], to: [1, 1] }, single);
    assert.deepEqual(result, single[0]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildMoveBody
  // ═══════════════════════════════════════════════════════════════════════

  test('buildMoveBody: basic move without captures', () => {
    const move = { from: [2, 1], to: [3, 0], captures: [] };
    const body = buildMoveBody(move);
    assert.deepEqual(body.from, [2, 1]);
    assert.deepEqual(body.to, [3, 0]);
    assert.equal(body.captures, undefined); // not included when empty
  });

  test('buildMoveBody: capture move includes captures', () => {
    const move = { from: [2, 3], to: [4, 5], captures: [[3, 4]] };
    const body = buildMoveBody(move);
    assert.deepEqual(body.captures, [[3, 4]]);
  });

  test('buildMoveBody: multi-capture includes all', () => {
    const move = { from: [0, 0], to: [4, 4], captures: [[1, 1], [3, 3]] };
    const body = buildMoveBody(move);
    assert.equal(body.captures.length, 2);
  });

  test('buildMoveBody: undefined captures not included', () => {
    const move = { from: [2, 1], to: [3, 0] };
    const body = buildMoveBody(move);
    assert.equal('captures' in body, false);
  });

  test('buildMoveBody: null captures not included', () => {
    const move = { from: [2, 1], to: [3, 0], captures: null };
    const body = buildMoveBody(move);
    assert.equal('captures' in body, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // isMoveValid
  // ═══════════════════════════════════════════════════════════════════════

  test('isMoveValid: valid move returns true', () => {
    assert.equal(isMoveValid({ from: [2, 1], to: [3, 0] }), true);
  });

  test('isMoveValid: null returns false', () => {
    assert.equal(isMoveValid(null), false);
  });

  test('isMoveValid: undefined returns false', () => {
    assert.equal(isMoveValid(undefined), false);
  });

  test('isMoveValid: missing from returns false', () => {
    assert.equal(isMoveValid({ to: [3, 0] }), false);
  });

  test('isMoveValid: missing to returns false', () => {
    assert.equal(isMoveValid({ from: [2, 1] }), false);
  });

  test('isMoveValid: from is not array returns false', () => {
    assert.equal(isMoveValid({ from: 'bad', to: [3, 0] }), false);
  });

  test('isMoveValid: from has 1 element returns false', () => {
    assert.equal(isMoveValid({ from: [2], to: [3, 0] }), false);
  });

  test('isMoveValid: from has 3 elements returns false', () => {
    assert.equal(isMoveValid({ from: [2, 1, 0], to: [3, 0] }), false);
  });

  test('isMoveValid: empty object returns false', () => {
    assert.equal(isMoveValid({}), false);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 AI Fallback Logic Tests');

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
