/**
 * hunter-sub-minimax-extend.test.js — Tests for multi-capture chains
 * and evaluate() symmetry in server/ai/minimax.js
 *
 * Rules used by minimax.js:
 *   - White pawns: forward = increasing row (toward row 7), captures forward only
 *   - Black pawns: forward = decreasing row (toward row 0), captures forward only
 *   - Kings: capture in any diagonal direction (sliding)
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

  // ═══ Multi-capture chains ═══

  test('multi-capture: white pawn double capture SE diagonal (forward)', () => {
    // White pawn at (1,1) idx=9, black at (2,2) idx=18, black at (4,4) idx=36
    // Forward SE: (1,1)→cap(2,2)→(3,3)→cap(4,4)→(5,5)
    const board = makeBoard([
      [9, 1], [18, 3], [36, 3],
    ]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'should find double capture');
    assert.deepEqual(dc.from, [1, 1]);
    assert.deepEqual(dc.to, [5, 5]);
    assert.deepEqual(dc.captures, [[2, 2], [4, 4]]);
  });

  test('multi-capture: white pawn triple capture chain (forward)', () => {
    // White pawn at (0,1) idx=1, black at (1,2) idx=10, black at (3,4) idx=28, black at (5,6) idx=46
    // (0,1)→cap(1,2)→(2,3)→cap(3,4)→(4,5)→cap(5,6)→(6,7)
    const board = makeBoard([
      [1, 1], [10, 3], [28, 3], [46, 3],
    ]);
    const moves = generateLegalMoves(board, 1);
    const tc = moves.find(m => m.captures && m.captures.length === 3);
    assert.ok(tc, 'should find triple capture');
    assert.deepEqual(tc.from, [0, 1]);
    assert.deepEqual(tc.to, [6, 7]);
    assert.deepEqual(tc.captures, [[1, 2], [3, 4], [5, 6]]);
  });

  test('multi-capture: king can chain captures in different directions', () => {
    // King at (5,3) idx=43, black at (4,4) idx=36, black at (2,6) idx=22
    // King slides: cap(4,4) at (3,5), then cap(2,6) at (1,7)
    const board = makeBoard([
      [43, 2], [36, 3], [22, 3],
    ]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'king should find double capture');
    assert.deepEqual(dc.from, [5, 3]);
    assert.deepEqual(dc.to, [1, 7]);
    assert.deepEqual(dc.captures, [[4, 4], [2, 6]]);
  });

  test('multi-capture: captures removed after applyMove', () => {
    const board = makeBoard([[9, 1], [18, 3], [36, 3]]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'should find double capture first');
    const newBoard = applyMove(board, dc, 1);
    assert.equal(newBoard[9], 0);   // from vacated
    assert.equal(newBoard[18], 0);  // first capture removed
    assert.equal(newBoard[36], 0);  // second capture removed
    assert.equal(newBoard[45], 1);  // landed at (5,5)
  });

  test('multi-capture: single capture when no chain available', () => {
    // White pawn at (1,1), black at (2,2), no further captures possible
    const board = makeBoard([[9, 1], [18, 3]]);
    const moves = generateLegalMoves(board, 1);
    const captures = moves.filter(m => m.captures.length > 0);
    assert.ok(captures.length > 0, 'should have at least one capture');
    assert.ok(captures.every(m => m.captures.length === 1),
      'all captures should be single (no chain)');
  });

  test('multi-capture: no duplicate captures in chain', () => {
    const board = makeBoard([[9, 1], [18, 3], [36, 3]]);
    const moves = generateLegalMoves(board, 1);
    for (const m of moves) {
      const seen = new Set();
      for (const [cr, cc] of m.captures) {
        const key = `${cr},${cc}`;
        assert.ok(!seen.has(key), `duplicate capture at (${cr},${cc})`);
        seen.add(key);
      }
    }
  });

  test('multi-capture: black pawn double capture (forward = decreasing row)', () => {
    // Black pawn at (6,6) idx=54, white at (5,5) idx=45, white at (3,3) idx=27
    // Black forward: (6,6)→cap(5,5)→(4,4)→cap(3,3)→(2,2)
    const board = makeBoard([
      [54, 3], [45, 1], [27, 1],
    ]);
    const moves = generateLegalMoves(board, -1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'black should find double capture');
    assert.deepEqual(dc.from, [6, 6]);
    assert.deepEqual(dc.to, [2, 2]);
    assert.deepEqual(dc.captures, [[5, 5], [3, 3]]);
  });

  test('multi-capture: applyMove on triple capture', () => {
    const board = makeBoard([[1, 1], [10, 3], [28, 3], [46, 3]]);
    const moves = generateLegalMoves(board, 1);
    const tc = moves.find(m => m.captures && m.captures.length === 3);
    assert.ok(tc, 'should find triple capture');
    const newBoard = applyMove(board, tc, 1);
    assert.equal(newBoard[1], 0);   // from vacated
    assert.equal(newBoard[10], 0);  // captured
    assert.equal(newBoard[28], 0);  // captured
    assert.equal(newBoard[46], 0);  // captured
    assert.equal(newBoard[55], 1, 'piece at (6,7) not promoted yet (row 6 !== 7)');
  });

  // ═══ evaluate() symmetry ═══

  test('evaluate symmetry: empty board both 0', () => {
    assert.equal(evaluate(emptyBoard(), 1), 0);
    assert.equal(evaluate(emptyBoard(), -1), 0);
  });

  test('evaluate symmetry: equal material roughly symmetric', () => {
    const board = makeBoard([[28, 1], [35, 3]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(Math.abs(ws + bs) < 0.5, `white=${ws} black=${bs}`);
  });

  test('evaluate symmetry: single pawn each side', () => {
    const board = makeBoard([[36, 1], [27, 3]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(Math.abs(ws + bs) < 1, `white=${ws} black=${bs}`);
  });

  test('evaluate symmetry: only kings symmetric', () => {
    const board = makeBoard([[28, 2], [35, 4]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(Math.abs(ws + bs) < 1, `white=${ws} black=${bs}`);
  });

  test('evaluate symmetry: material advantage flips sign', () => {
    const board = makeBoard([[28, 1], [29, 1], [30, 1], [36, 3]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(ws > 0, 'white positive');
    assert.ok(bs < 0, 'black negative');
    assert.ok(ws * bs < 0, 'opposite signs');
  });

  test('evaluate symmetry: reversed advantage', () => {
    const board = makeBoard([[28, 3], [29, 3], [30, 3], [36, 1]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(ws < 0, 'white negative');
    assert.ok(bs > 0, 'black positive');
  });

  test('evaluate symmetry: advanced pieces scored from owner perspective', () => {
    // White pawn at row 6 (close to promotion row 7) = advanced for white
    // Black pawn at row 1 (close to promotion row 0) = advanced for black
    // Both should see their own advanced piece as positive
    const board = makeBoard([[48, 1], [15, 3]]); // row6,col0 (white), row1,col7 (black)
    const ws = evaluate(board, 1); // white's perspective
    const bs = evaluate(board, -1); // black's perspective
    // White sees own advanced pawn (positive) and black's advanced pawn (threat, negative)
    // Black sees own advanced pawn (positive) and white's advanced pawn (threat, negative)
    assert.ok(typeof ws === 'number' && isFinite(ws));
    assert.ok(typeof bs === 'number' && isFinite(bs));
  });

  test('evaluate symmetry: own pieces positive, opponent negative', () => {
    const board = makeBoard([[28, 1], [29, 1], [36, 1], [37, 1]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(ws > 0, 'white sees own pieces');
    assert.ok(bs < 0, 'black sees opponent pieces');
  });

  test('evaluate symmetry: mixed edges', () => {
    const board = makeBoard([[0, 2], [7, 4], [56, 1], [63, 3]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(typeof ws === 'number' && isFinite(ws));
    assert.ok(typeof bs === 'number' && isFinite(bs));
    assert.ok(Math.abs(ws + bs) < 2, `white=${ws} black=${bs}`);
  });

  // ═══ Multi-capture with promotion ═══

  test('multi-capture: white pawn promotes during capture to row 7', () => {
    // White pawn at (5,1) idx=41, black at (6,2) idx=50
    // Forward SE: (5,1)→cap(6,2)→(7,3) → promotes to king
    const board = makeBoard([[41, 1], [50, 3]]);
    const moves = generateLegalMoves(board, 1);
    const cap = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(cap, 'should find capture');
    assert.deepEqual(cap.to, [7, 3]);
    const newBoard = applyMove(board, cap, 1);
    assert.equal(newBoard[59], 2, 'promoted to king');
  });

  test('multi-capture: black pawn promotes during capture to row 0', () => {
    // Black pawn at (2,4) idx=20, white at (1,3) idx=11
    // Forward NW (decreasing row): (2,4)→cap(1,3)→(0,2) → promotes to king
    const board = makeBoard([[20, 3], [11, 1]]);
    const moves = generateLegalMoves(board, -1);
    const cap = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(cap, 'should find capture');
    assert.deepEqual(cap.to, [0, 2]);
    const newBoard = applyMove(board, cap, -1);
    assert.equal(newBoard[2], 4, 'black pawn promoted to king');
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (err) { failed++; console.log(`  ❌ ${t.name}: ${err.message}`); }
  }
  console.log(`\n  minimax-extend: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
