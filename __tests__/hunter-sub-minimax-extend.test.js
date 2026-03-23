/**
 * hunter-sub-minimax-extend.test.js — Tests for multi-capture chains
 * and evaluate() symmetry in server/ai/minimax.js
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

  test('multi-capture: white pawn double capture NW diagonal', () => {
    const board = makeBoard([
      [45, 1], [36, 3], [18, 3], // (5,5)→cap(4,4)→(3,3)→cap(2,2)→(1,1)
    ]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'should find double capture');
    assert.deepEqual(dc.from, [5, 5]);
    assert.deepEqual(dc.to, [1, 1]);
    assert.deepEqual(dc.captures, [[4, 4], [2, 2]]);
  });

  test('multi-capture: white pawn triple capture chain', () => {
    const board = makeBoard([
      [49, 1], [42, 3], [28, 3], [14, 3], // (6,1)→cap(5,2)→cap(3,4)→cap(1,6)→(0,7)
    ]);
    const moves = generateLegalMoves(board, 1);
    const tc = moves.find(m => m.captures && m.captures.length === 3);
    assert.ok(tc, 'should find triple capture');
    assert.deepEqual(tc.from, [6, 1]);
    assert.deepEqual(tc.to, [0, 7]);
    assert.deepEqual(tc.captures, [[5, 2], [3, 4], [1, 6]]);
  });

  test('multi-capture: king can chain captures in different directions', () => {
    const board = makeBoard([
      [43, 2], [36, 3], [22, 3], // (5,3) king → cap(4,4) → (3,5) → cap(2,6) → (1,7)
    ]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'king should find double capture');
    assert.deepEqual(dc.from, [5, 3]);
    assert.deepEqual(dc.to, [1, 7]);
    assert.deepEqual(dc.captures, [[4, 4], [2, 6]]);
  });

  test('multi-capture: captures removed after applyMove', () => {
    const board = makeBoard([[45, 1], [36, 3], [18, 3]]);
    const moves = generateLegalMoves(board, 1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    const newBoard = applyMove(board, dc, 1);
    assert.equal(newBoard[45], 0);
    assert.equal(newBoard[36], 0);
    assert.equal(newBoard[18], 0);
    assert.equal(newBoard[9], 1);
  });

  test('multi-capture: single capture when no chain available', () => {
    const board = makeBoard([[45, 1], [36, 3]]);
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.every(m => m.captures.length === 1));
  });

  test('multi-capture: no duplicate captures in chain', () => {
    const board = makeBoard([[45, 1], [36, 3], [18, 3]]);
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

  test('multi-capture: black pawn double capture', () => {
    const board = makeBoard([
      [18, 3], [27, 1], [45, 1], // (2,2)→cap(3,3)→(4,4)→cap(5,5)→(6,6)
    ]);
    const moves = generateLegalMoves(board, -1);
    const dc = moves.find(m => m.captures && m.captures.length === 2);
    assert.ok(dc, 'black should find double capture');
    assert.deepEqual(dc.from, [2, 2]);
    assert.deepEqual(dc.to, [6, 6]);
  });

  test('multi-capture: applyMove on triple capture', () => {
    const board = makeBoard([[49, 1], [42, 3], [28, 3], [14, 3]]);
    const moves = generateLegalMoves(board, 1);
    const tc = moves.find(m => m.captures && m.captures.length === 3);
    const newBoard = applyMove(board, tc, 1);
    assert.equal(newBoard[49], 0);
    assert.equal(newBoard[42], 0);
    assert.equal(newBoard[28], 0);
    assert.equal(newBoard[14], 0);
    assert.equal(newBoard[7], 2, 'piece at (0,7) promoted to king');
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

  test('evaluate symmetry: mirrored board same-sign scores', () => {
    // evaluate uses turn param for advance direction, so mirrored pieces
    // produce same-sign scores (both see own pieces advancing)
    const board = makeBoard([[0, 1], [2, 1], [4, 1], [59, 3], [61, 3], [63, 3]]);
    const ws = evaluate(board, 1), bs = evaluate(board, -1);
    assert.ok(typeof ws === 'number' && isFinite(ws));
    assert.ok(typeof bs === 'number' && isFinite(bs));
    // Both should be positive (each side sees own advanced pieces)
    assert.ok(ws > 0 && bs > 0, `white=${ws} black=${bs} should both be positive`);
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

  test('multi-capture: white pawn promotes during capture', () => {
    const board = makeBoard([[19, 1], [10, 3]]);
    const moves = generateLegalMoves(board, 1);
    const cap = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(cap);
    assert.deepEqual(cap.to, [0, 1]);
    const newBoard = applyMove(board, cap, 1);
    assert.equal(newBoard[1], 2, 'promoted to king');
  });

  test('multi-capture: black pawn promotes during capture', () => {
    const board = makeBoard([[42, 3], [51, 1]]);
    const moves = generateLegalMoves(board, -1);
    const cap = moves.find(m => m.captures && m.captures.length > 0);
    assert.ok(cap);
    assert.deepEqual(cap.to, [7, 4]);
    const newBoard = applyMove(board, cap, -1);
    assert.equal(newBoard[60], 4, 'black pawn promoted');
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (err) { failed++; console.log(`  ❌ ${t.name}: ${err.message}`); }
  }
  console.log(`\n  minimax-extend: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
