/**
 * hunter-sub-minimax-direction.test.js — Tests that ACTUAL minimax.js has correct pawn directions.
 *
 * Tests use the C++ engine's board convention: white at rows 0-2, black at rows 5-7.
 * White forward = increasing row (toward row 7/promotion).
 * Black forward = decreasing row (toward row 0/promotion).
 */

import { generateLegalMoves, minimaxSearch } from '../server/ai/minimax.js';
import assert from 'node:assert/strict';

// Starting board matching C++ engine: white pawns rows 0-2, black pawns rows 5-7
function startingBoard() {
  const b = new Array(64).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r * 8 + c] = 1; // white pawn
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r * 8 + c] = 3; // black pawn
    }
  }
  return b;
}

export async function runMinimaxDirectionTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test('white pawns move DOWNWARD (increasing row) from starting position', () => {
    const board = startingBoard();
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'white should have moves');
    // White pawns at row 2 should move to row 3 (dr = +1, downward)
    for (const m of moves) {
      assert.ok(m.to[0] > m.from[0],
        `white pawn at (${m.from}) should move DOWNWARD to (${m.to}), but to[0]=${m.to[0]} <= from[0]=${m.from[0]}`);
    }
  });

  test('black pawns move UPWARD (decreasing row) from starting position', () => {
    const board = startingBoard();
    const moves = generateLegalMoves(board, -1);
    assert.ok(moves.length > 0, 'black should have moves');
    for (const m of moves) {
      assert.ok(m.to[0] < m.from[0],
        `black pawn at (${m.from}) should move UPWARD to (${m.to}), but to[0]=${m.to[0]} >= from[0]=${m.from[0]}`);
    }
  });

  test('white has exactly 7 opening moves', () => {
    const board = startingBoard();
    const moves = generateLegalMoves(board, 1);
    assert.equal(moves.length, 7, `expected 7 white opening moves, got ${moves.length}`);
  });

  test('black has exactly 7 opening moves', () => {
    const board = startingBoard();
    const moves = generateLegalMoves(board, -1);
    assert.equal(moves.length, 7, `expected 7 black opening moves, got ${moves.length}`);
  });

  test('minimax finds valid downward move for white', () => {
    const board = startingBoard();
    const result = minimaxSearch(board, 1, 2);
    assert.ok(result.move, 'minimax should return a move');
    assert.ok(result.move.to[0] > result.move.from[0],
      `minimax white move should be downward: (${result.move.from}) → (${result.move.to})`);
  });

  test('minimax finds valid upward move for black', () => {
    const board = startingBoard();
    const result = minimaxSearch(board, -1, 2);
    assert.ok(result.move, 'minimax should return a move');
    assert.ok(result.move.to[0] < result.move.from[0],
      `minimax black move should be upward: (${result.move.from}) → (${result.move.to})`);
  });

  test('white pawn near promotion (row 6) can move to row 7', () => {
    // White pawn at (6,1) — should be able to move to (7,0) or (7,2)
    const board = new Array(64).fill(0);
    board[49] = 1; // (6,1) = white pawn
    const moves = generateLegalMoves(board, 1);
    const targets = moves.map(m => m.to);
    assert.ok(targets.some(([r, c]) => r === 7),
      `white pawn at (6,1) should reach row 7, targets: ${JSON.stringify(targets)}`);
  });

  test('black pawn near promotion (row 1) can move to row 0', () => {
    // Black pawn at (1,0) — should move to (0,1)
    const board = new Array(64).fill(0);
    board[8] = 3; // (1,0) = black pawn
    const moves = generateLegalMoves(board, -1);
    const targets = moves.map(m => m.to);
    assert.ok(targets.some(([r]) => r === 0),
      `black pawn at (1,0) should reach row 0, targets: ${JSON.stringify(targets)}`);
  });

  test('white pawn at row 2 CANNOT move to row 1 (backward)', () => {
    const board = new Array(64).fill(0);
    board[12] = 1; // (1,4) = white pawn — wait, row 1 col 4
    // Actually use row 2 for starting position test
    board[12] = 0;
    board[20] = 1; // (2,4) = white pawn
    const moves = generateLegalMoves(board, 1);
    const upwardMoves = moves.filter(m => m.to[0] < m.from[0]);
    assert.equal(upwardMoves.length, 0,
      `white pawn should NOT move upward: ${JSON.stringify(upwardMoves)}`);
  });

  test('black pawn at row 5 CANNOT move to row 6 (backward)', () => {
    const board = new Array(64).fill(0);
    board[44] = 3; // (5,4) = black pawn
    const moves = generateLegalMoves(board, -1);
    const downwardMoves = moves.filter(m => m.to[0] > m.from[0]);
    assert.equal(downwardMoves.length, 0,
      `black pawn should NOT move downward: ${JSON.stringify(downwardMoves)}`);
  });

  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }
  console.log(`\n  minimax-direction: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
