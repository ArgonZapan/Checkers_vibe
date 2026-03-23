/**
 * boardConvert.test.js — Tests for boardFromCpp / boardToCpp
 */
import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runBoardConvertTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Piece mapping ──────────────────────────────────────────────────

  test('0 = empty (null)', () => {
    const board = boardFromCpp([[0]]);
    assert.equal(board[0][0], null);
  });

  test('1 = white pawn', () => {
    const board = boardFromCpp([[1]]);
    assert.deepEqual(board[0][0], { color: 'white', king: false });
  });

  test('2 = white king', () => {
    const board = boardFromCpp([[2]]);
    assert.deepEqual(board[0][0], { color: 'white', king: true });
  });

  test('3 = black pawn', () => {
    const board = boardFromCpp([[3]]);
    assert.deepEqual(board[0][0], { color: 'black', king: false });
  });

  test('4 = black king', () => {
    const board = boardFromCpp([[4]]);
    assert.deepEqual(board[0][0], { color: 'black', king: true });
  });

  // ── Flat array input ──────────────────────────────────────────────

  test('boardFromCpp accepts flat 64-element array', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1; // white pawn at [0][0]
    flat[63] = 4; // black king at [7][7]
    const board = boardFromCpp(flat);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 8);
    assert.deepEqual(board[0][0], { color: 'white', king: false });
    assert.deepEqual(board[7][7], { color: 'black', king: true });
    assert.equal(board[0][1], null);
  });

  // ── Empty board ───────────────────────────────────────────────────

  test('empty board (all zeros)', () => {
    const empty2D = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const board = boardFromCpp(empty2D);
    assert.equal(board.length, 8);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        assert.equal(board[r][c], null, `cell [${r}][${c}] should be null`);
      }
    }
  });

  test('empty board round-trip', () => {
    const empty2D = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const react = boardFromCpp(empty2D);
    const back = boardToCpp(react);
    assert.deepEqual(back, new Array(64).fill(0));
  });

  // ── Full board (all piece types) ──────────────────────────────────

  test('full board with all piece types round-trip', () => {
    const cppBoard = [
      [3, 0, 3, 0, 3, 0, 3, 0],
      [0, 3, 0, 3, 0, 3, 0, 3],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0],
    ];
    const react = boardFromCpp(cppBoard);
    const back = boardToCpp(react);
    const expected = cppBoard.flat();
    assert.deepEqual(back, expected);
  });

  test('board with kings round-trip', () => {
    const cppBoard = Array.from({ length: 8 }, () => new Array(8).fill(0));
    cppBoard[0][0] = 2; // white king
    cppBoard[7][7] = 4; // black king
    cppBoard[3][3] = 1; // white pawn
    cppBoard[4][4] = 3; // black pawn
    const react = boardFromCpp(cppBoard);
    const back = boardToCpp(react);
    assert.deepEqual(back, cppBoard.flat());
  });

  // ── boardToCpp correctness ────────────────────────────────────────

  test('boardToCpp: null → 0', () => {
    const react = [[null]];
    assert.equal(boardToCpp(react)[0], 0);
  });

  test('boardToCpp: white pawn → 1', () => {
    const react = [[{ color: 'white', king: false }]];
    assert.equal(boardToCpp(react)[0], 1);
  });

  test('boardToCpp: white king → 2', () => {
    const react = [[{ color: 'white', king: true }]];
    assert.equal(boardToCpp(react)[0], 2);
  });

  test('boardToCpp: black pawn → 3', () => {
    const react = [[{ color: 'black', king: false }]];
    assert.equal(boardToCpp(react)[0], 3);
  });

  test('boardToCpp: black king → 4', () => {
    const react = [[{ color: 'black', king: true }]];
    assert.equal(boardToCpp(react)[0], 4);
  });

  // ── Round-trip: C++ → React → C++ = original ─────────────────────

  test('round-trip standard starting position', () => {
    // Standard checkers starting position (12 black pawns rows 0-2, 12 white pawns rows 5-7)
    const start = [
      [0,3,0,3,0,3,0,3],
      [3,0,3,0,3,0,3,0],
      [0,3,0,3,0,3,0,3],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0],
      [0,1,0,1,0,1,0,1],
      [1,0,1,0,1,0,1,0],
    ];
    const react = boardFromCpp(start);
    const back = boardToCpp(react);
    assert.deepEqual(back, start.flat());
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Board Conversion Tests');

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
