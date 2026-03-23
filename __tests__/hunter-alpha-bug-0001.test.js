/**
 * Bug #1: Minimax pawn direction & promotion logic is inverted.
 *
 * White pawns move toward row 0 (starting row) instead of row 7 (promotion row).
 * Black pawns move toward row 7 (starting row) instead of row 0 (promotion row).
 * Promotion checks are swapped: white at row 0, black at row 7.
 *
 * C++ engine: white starts rows 0-2, promotes at row 7;
 *             black starts rows 5-7, promotes at row 0.
 */

import assert from 'node:assert/strict';
import { generateLegalMoves, applyMove, minimaxSearch } from '../server/ai/minimax.js';

export async function runBug0001Tests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }
  const empty = () => new Array(64).fill(0);

  test('white pawn at row 6 should reach row 7 (forward = increasing row)', () => {
    const board = empty();
    board[6 * 8 + 1] = 1;
    board[0] = 3; // black piece
    const moves = generateLegalMoves(board, 1);
    const targets = moves.filter(m => m.from[0] === 6 && m.from[1] === 1);
    const canReachRow7 = targets.some(m => m.to[0] === 7);
    assert.equal(canReachRow7, true, 'White pawn must be able to reach row 7 (promotion row)');
  });

  test('black pawn at row 1 should reach row 0 (forward = decreasing row)', () => {
    const board = empty();
    board[1 * 8 + 3] = 3;
    board[63] = 1; // white piece
    const moves = generateLegalMoves(board, -1);
    const targets = moves.filter(m => m.from[0] === 1 && m.from[1] === 3);
    const canReachRow0 = targets.some(m => m.to[0] === 0);
    assert.equal(canReachRow0, true, 'Black pawn must be able to reach row 0 (promotion row)');
  });

  test('white pawn at row 7 should promote to king (value 2)', () => {
    const board = empty();
    board[6 * 8 + 1] = 1;
    const result = applyMove(board, { from: [6, 1], to: [7, 0] }, 1);
    assert.equal(result[7 * 8 + 0], 2, 'White pawn at row 7 should become king (2)');
  });

  test('black pawn at row 0 should promote to king (value 4)', () => {
    const board = empty();
    board[1 * 8 + 3] = 3;
    const result = applyMove(board, { from: [1, 3], to: [0, 2] }, -1);
    assert.equal(result[0 * 8 + 2], 4, 'Black pawn at row 0 should become king (4)');
  });

  test('white pawn at row 0 should NOT be promoted', () => {
    const board = empty();
    board[0 * 8 + 1] = 1;
    const result = applyMove(board, { from: [0, 1], to: [0, 3], captures: [] }, 1);
    assert.equal(result[0 * 8 + 3], 1, 'White pawn at row 0 should stay pawn (1)');
  });

  test('black pawn at row 7 should NOT be promoted', () => {
    const board = empty();
    board[7 * 8 + 3] = 3;
    const result = applyMove(board, { from: [7, 3], to: [7, 1], captures: [] }, -1);
    assert.equal(result[7 * 8 + 1], 3, 'Black pawn at row 7 should stay pawn (3)');
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (e) { failed++; console.log(`  ❌ ${t.name}: ${e.message}`); }
  }
  return { passed, failed };
}
