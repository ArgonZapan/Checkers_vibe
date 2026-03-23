/**
 * Regression test: minimax evaluate() must score opponent pieces from their own perspective.
 *
 * Bug: old code computed `advance = turn === 1 ? row : (7 - row)` for ALL pieces,
 * scoring opponent pawns with the wrong advancement direction.
 * Fix: compute advance from the piece owner's perspective, not the current turn.
 */
import assert from 'node:assert/strict';
import { evaluate } from '../server/ai/minimax.js';

export async function runMinimaxEvalTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  test('black pawn near promotion (row 1) more threatening than at start (row 7)', () => {
    // Black pawn at row 1 (close to row 0 = promotion for black)
    const board1 = new Array(64).fill(0);
    board1[1 * 8 + 3] = 3; // black pawn at row 1

    // Black pawn at row 7 (starting position, far from promotion)
    const board2 = new Array(64).fill(0);
    board2[7 * 8 + 3] = 3; // black pawn at row 7

    // From white's perspective: black near promotion should be MORE threatening (lower score)
    const score1 = evaluate(board1, 1);
    const score2 = evaluate(board2, 1);
    assert.ok(score1 < score2, `Black pawn at row 1 (score=${score1}) should be more threatening than at row 7 (score=${score2})`);
  });

  test('white pawn near promotion (row 6) more threatening than at start (row 0)', () => {
    const board1 = new Array(64).fill(0);
    board1[6 * 8 + 3] = 1; // white pawn at row 6 (near row 7 promotion)

    const board2 = new Array(64).fill(0);
    board2[0 * 8 + 3] = 1; // white pawn at row 0 (starting pos)

    // From black's perspective: white near promotion should be MORE threatening
    const score1 = evaluate(board1, -1);
    const score2 = evaluate(board2, -1);
    assert.ok(score1 < score2, `White pawn at row 6 (score=${score1}) should be more threatening than at row 0 (score=${score2})`);
  });

  test('symmetric positions produce roughly opposite scores', () => {
    const board = new Array(64).fill(0);
    board[6 * 8 + 3] = 1; // white pawn near promotion
    board[1 * 8 + 3] = 3; // black pawn near promotion

    const scoreWhite = evaluate(board, 1);
    const scoreBlack = evaluate(board, -1);
    // With symmetric positions, scores should be roughly opposite
    assert.ok(Math.abs(scoreWhite + scoreBlack) < 0.5,
      `Symmetric scores should cancel: white=${scoreWhite}, black=${scoreBlack}, sum=${scoreWhite + scoreBlack}`);
  });

  test('opponent king center bonus is always positive', () => {
    // Black king at center (row 3, col 3) — evaluate from white's perspective
    const board = new Array(64).fill(0);
    board[3 * 8 + 3] = 4; // black king at center

    const boardEdge = new Array(64).fill(0);
    boardEdge[0 * 8 + 0] = 4; // black king at edge

    // Center king should be more threatening (lower score from white perspective)
    const scoreCenter = evaluate(board, 1);
    const scoreEdge = evaluate(boardEdge, 1);
    assert.ok(scoreCenter < scoreEdge,
      `Center opponent king (score=${scoreCenter}) should be more threatening than edge (score=${scoreEdge})`);
  });

  console.log('\n📋 Minimax Eval — Opponent Piece Scoring Tests');

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
