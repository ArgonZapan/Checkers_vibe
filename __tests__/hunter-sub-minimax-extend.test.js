/**
 * hunter-sub-minimax-extend.test.js — Tests for _extendCapture multi-capture chains
 * and evaluate() symmetry in server/ai/minimax.js
 *
 * Focus:
 * 1. _extendCapture produces correct multi-capture chains (2, 3 jumps)
 * 2. evaluate() is symmetric: evaluate(board, 1) == -evaluate(board, -1)
 *    when board has equal material for both sides
 * 3. _extendCapture with kings (can capture in all directions)
 *
 * Imports the REAL module — no inline copies.
 */

import { generateLegalMoves, evaluate, applyMove } from '../server/ai/minimax.js';
import assert from 'node:assert/strict';

function emptyBoard() { return new Array(64).fill(0); }

function makeBoard(setup) {
  const b = emptyBoard();
  for (const [pos, val] of setup) b[pos] = val;
  return b;
}

export async function runMinimaxExtendTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: _extendCapture — multi-capture chains
  // ═══════════════════════════════════════════════════════════════════════

  test('multi-capture: white pawn captures two black pawns in a chain (NW diagonal)', () => {
    // White pawn at (5,5), black at (4,4) and (2,2)
    // Capture chain: (5,5) → capture (4,4) → land at (3,3) → capture (2,2) → land at (1,1)
    const board = makeBoard([
      [45, 1],  // white pawn (5,5)
      [36, 3],  // black pawn (4,4)
      [18, 3],  // black pawn (2,2)
    ]);
    const moves = generateLegalMoves(board, 1);
    // Should find a capture with 2 captures in the chain
    const doubleCapture = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(doubleCapture, 'should find a double-capture move');
    assert.deepEqual(doubleCapture.from, [5, 5]);
    assert.deepEqual(doubleCapture.to, [1, 1]);
    assert.deepEqual(doubleCapture.captures, [[4, 4], [2, 2]]);
  });

  test('multi-capture: white pawn captures three black pawns in a zigzag', () => {
    // (5,5) white → capture (4,4) black → land (3,3) → capture (2,4) black → land (1,5)
    // → capture (0,6) black → land — but that would be promotion row
    // Actually let's set up a 3-capture chain:
    // (5,1) white → capture (4,2) → land (3,3) → capture (2,4) → land (1,5) → capture (0,6) → land (-1,7) — off board
    // Let's try: (5,1) → cap (4,0) → land (3,-1) — off board. No good.
    // Better: (5,5) → cap (4,6) → land (3,7) → need another piece...
    // Let's use: (6,1) white → cap (5,2) → land (4,3) → cap (3,4) → land (2,5) → cap (1,6) → land (0,7)
    const board = makeBoard([
      [49, 1],  // white pawn (6,1)
      [42, 3],  // black pawn (5,2)
      [28, 3],  // black pawn (3,4)
      [14, 3],  // black pawn (1,6)
    ]);
    const moves = generateLegalMoves(board, 1);
    // Find a 3-capture chain
    const tripleCapture = moves.find(m => m.captures && m.captures.length === 3);
    assert.ok(tripleCapture, 'should find a triple-capture move');
    assert.deepEqual(tripleCapture.from, [6, 1]);
    assert.deepEqual(tripleCapture.to, [0, 7]);
    assert.deepEqual(tripleCapture.captures, [[5, 2], [3, 4], [1, 6]]);
  });

  test('multi-capture: king can chain captures in different directions', () => {
    // White king at (4,4), black at (3,3) NW and (5,5) SE
    // King captures NW: (4,4) → cap (3,3) → land (2,2)
    // Then from (2,2) king captures SE: → cap (3,3) — already captured
    // So set up two separate black pieces: (4,4) white king → cap (3,5) NE → land (2,6)
    // Then cap (3,7) — need another piece there... Let me think.
    // (4,4) white king → cap (3,3) → land (2,2). From (2,2) no more captures available.
    // Let's do: (4,4) white king → cap (3,5) → land (2,6), then from (2,6) cap (3,7) → land (4,8) off-board. No.
    // Simplest multi-capture with king:
    // (5,3) white king → cap (4,2) → land (3,1) → cap (2,0) → land (1,-1) — off board
    // (5,3) → cap (4,4) → land (3,5) → cap (2,6) → land (1,7)
    const board = makeBoard([
      [43, 2],  // white king (5,3)
      [35, 3],  // black pawn (4,4)
      [22, 3],  // black pawn (2,6)
    ]);
    const moves = generateLegalMoves(board, 1);
    const doubleCap = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(doubleCap, 'king should find a double-capture');
    assert.deepEqual(doubleCap.from, [5, 3]);
    assert.deepEqual(doubleCap.to, [1, 7]);
    assert.deepEqual(doubleCap.captures, [[4, 4], [2, 6]]);
  });

  test('multi-capture: captures are removed from board after applyMove', () => {
    // Verify the board state after applying a double capture
    const board = makeBoard([
      [45, 1],  // white (5,5)
      [36, 3],  // black (4,4)
      [18, 3],  // black (2,2)
    ]);
    const moves = generateLegalMoves(board, 1);
    const doubleCap = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(doubleCap, 'should find double capture');
    const newBoard = applyMove(board, doubleCap, 1);
    assert.equal(newBoard[45], 0, 'source empty');
    assert.equal(newBoard[36], 0, 'first capture removed');
    assert.equal(newBoard[18], 0, 'second capture removed');
    assert.equal(newBoard[9], 1, 'piece at final destination');
  });

  test('multi-capture: single capture also returned when no chain available', () => {
    // White pawn at (5,5), black at (4,4), nothing behind black
    const board = makeBoard([
      [45, 1],
      [36, 3],
    ]);
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.every(m => m.captures && m.captures.length === 1),
      'only single captures should be available');
  });

  test('multi-capture: pawn cannot re-capture same piece', () => {
    // The _extendCapture function checks alreadyCaptured — ensure it works
    // White pawn at (5,5), black at (4,4) — only one opponent to capture
    // There's no way to loop back in checkers, so this just verifies
    // the function doesn't produce infinite loops or duplicate captures
    const board = makeBoard([
      [45, 1],
      [36, 3],
      [18, 3],
    ]);
    const moves = generateLegalMoves(board, 1);
    for (const m of moves) {
      // No capture should appear twice
      const seen = new Set();
      for (const [cr, cc] of m.captures) {
        const key = `${cr},${cc}`;
        assert.ok(!seen.has(key), `duplicate capture at (${cr},${cc})`);
        seen.add(key);
      }
    }
  });

  test('multi-capture: black pawn double-capture chain', () => {
    // Black pawn at (2,2), white at (3,3) and (5,5)
    // (2,2) → cap (3,3) → land (4,4) → cap (5,5) → land (6,6)
    const board = makeBoard([
      [18, 3],  // black pawn (2,2)
      [27, 1],  // white pawn (3,3)
      [45, 1],  // white pawn (5,5)
    ]);
    const moves = generateLegalMoves(board, -1);
    const doubleCap = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(doubleCap, 'black should find a double-capture');
    assert.deepEqual(doubleCap.from, [2, 2]);
    assert.deepEqual(doubleCap.to, [6, 6]);
    assert.deepEqual(doubleCap.captures, [[3, 3], [5, 5]]);
  });

  test('multi-capture: applyMove on triple capture produces correct board', () => {
    const board = makeBoard([
      [49, 1],  // (6,1) white
      [42, 3],  // (5,2) black
      [28, 3],  // (3,4) black
      [14, 3],  // (1,6) black
    ]);
    const moves = generateLegalMoves(board, 1);
    const tripleCap = moves.find(m => m.captures && m.captures.length === 3);
    assert.ok(tripleCap, 'should find triple capture');
    const newBoard = applyMove(board, tripleCap, 1);
    assert.equal(newBoard[49], 0);
    assert.equal(newBoard[42], 0);
    assert.equal(newBoard[28], 0);
    assert.equal(newBoard[14], 0);
    assert.equal(newBoard[7], 1, 'piece at (0,7)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: evaluate() symmetry
  // ═══════════════════════════════════════════════════════════════════════

  test('evaluate symmetry: empty board — both turns produce 0', () => {
    assert.equal(evaluate(emptyBoard(), 1), 0);
    assert.equal(evaluate(emptyBoard(), -1), 0);
  });

  test('evaluate symmetry: equal material, symmetric scores', () => {
    // White and black have same pieces, mirror positions
    const board = makeBoard([
      [28, 1], // white pawn (3,4)
      [35, 3], // black pawn (4,3) — mirror
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    // Scores should be opposite (or very close due to positional differences)
    assert.ok(Math.abs(whiteScore + blackScore) < 0.5,
      `scores should be roughly symmetric: white=${whiteScore}, black=${blackScore}`);
  });

  test('evaluate symmetry: single white pawn vs single black pawn', () => {
    const board = makeBoard([
      [36, 1], // white pawn (4,4)
      [27, 3], // black pawn (3,3)
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    // With equal material, scores should be roughly opposite
    // (positional bonus may cause slight asymmetry)
    assert.ok(Math.abs(whiteScore + blackScore) < 1,
      `scores should be roughly negated: white=${whiteScore}, black=${blackScore}`);
  });

  test('evaluate symmetry: board with only kings — symmetric material', () => {
    const board = makeBoard([
      [28, 2], // white king (3,4)
      [35, 4], // black king (4,3)
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    assert.ok(Math.abs(whiteScore + blackScore) < 1,
      `king-only symmetric board: white=${whiteScore}, black=${blackScore}`);
  });

  test('evaluate symmetry: material advantage flips sign between turns', () => {
    // White has 3 pawns, black has 1
    const board = makeBoard([
      [28, 1], [29, 1], [30, 1], // white
      [36, 3],                     // black
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    assert.ok(whiteScore > 0, 'white should be positive with material advantage');
    assert.ok(blackScore < 0, 'black should be negative with material disadvantage');
    // Not exactly symmetric because positional bonuses depend on piece identity
    // But signs should be opposite
    assert.ok(whiteScore * blackScore < 0, 'scores should have opposite signs');
  });

  test('evaluate symmetry: reversed material advantage', () => {
    // Black has 3 pawns, white has 1
    const board = makeBoard([
      [28, 3], [29, 3], [30, 3], // black
      [36, 1],                     // white
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    assert.ok(whiteScore < 0, 'white should be negative with material disadvantage');
    assert.ok(blackScore > 0, 'black should be positive with material advantage');
  });

  test('evaluate symmetry: identical board, opposite turns produce negated scores', () => {
    // Perfectly mirrored: white pieces = black pieces at same positions
    const board = makeBoard([
      [0, 1], [2, 1], [4, 1],   // white on row 0
      [59, 3], [61, 3], [63, 3], // black on row 7
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    // With symmetric positions, scores should be very close to negated
    // (advance bonus is directional, so there may be slight asymmetry)
    assert.ok(Math.abs(whiteScore + blackScore) < 2,
      `mirrored board: white=${whiteScore}, black=${blackScore}, sum=${whiteScore + blackScore}`);
  });

  test('evaluate symmetry: all pawns same color — sign flip between turns', () => {
    // Only white pawns on the board
    const board = makeBoard([
      [28, 1], [29, 1], [36, 1], [37, 1],
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    // White sees positive (own pieces), black sees negative (opponent pieces)
    assert.ok(whiteScore > 0, 'white sees own pieces positively');
    assert.ok(blackScore < 0, 'black sees opponent pieces negatively');
  });

  test('evaluate symmetry: board with mixed pieces at edges', () => {
    // Pieces on the edges of the board
    const board = makeBoard([
      [0, 2],   // white king at (0,0) — edge
      [7, 4],   // black king at (0,7) — edge
      [56, 1],  // white pawn at (7,0) — edge
      [63, 3],  // black pawn at (7,7) — edge
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    assert.ok(typeof whiteScore === 'number' && isFinite(whiteScore));
    assert.ok(typeof blackScore === 'number' && isFinite(blackScore));
    // Roughly symmetric: white has 1 pawn + 1 king, black has 1 pawn + 1 king
    assert.ok(Math.abs(whiteScore + blackScore) < 2,
      `edge board symmetry: white=${whiteScore}, black=${blackScore}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: _extendCapture with promotion during multi-capture
  // ═══════════════════════════════════════════════════════════════════════

  test('multi-capture: white pawn promotes during capture chain', () => {
    // White pawn at (2,1), black at (1,2) and — need to capture toward row 0
    // (2,1) → cap (1,0) → land (0,-1) — off board
    // (2,3) → cap (1,2) → land (0,1) — promotes!
    const board = makeBoard([
      [19, 1],  // white pawn (2,3)
      [10, 3],  // black pawn (1,2)
    ]);
    const moves = generateLegalMoves(board, 1);
    const capture = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(capture, 'should find capture');
    assert.deepEqual(capture.to, [0, 1], 'should land on promotion row');
    // Apply move and verify promotion
    const newBoard = applyMove(board, capture, 1);
    assert.equal(newBoard[1], 2, 'pawn should be promoted to king');
  });

  test('multi-capture: black pawn promotes during capture chain', () => {
    // Black pawn at (5,2), white at (6,3)
    // (5,2) → cap (6,3) → land (7,4) — promotes!
    const board = makeBoard([
      [42, 3],  // black pawn (5,2)
      [51, 1],  // white pawn (6,3)
    ]);
    const moves = generateLegalMoves(board, -1);
    const capture = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(capture, 'should find capture');
    assert.deepEqual(capture.to, [7, 4], 'should land on promotion row');
    const newBoard = applyMove(board, capture, -1);
    assert.equal(newBoard[60], 4, 'black pawn promoted to black king');
  });

  // ── Run all tests ─────────────────────────────────────────────────
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

  console.log(`\n  minimax-extend: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
