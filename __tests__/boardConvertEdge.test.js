/**
 * boardConvertEdge.test.js — Additional edge case tests for boardFromCpp / boardToCpp.
 *
 * Covers: invalid values, mixed input formats, single-row, non-board dimensions.
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runBoardConvertEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Unknown values (out of 0-4 range) ────────────────────────────────

  test('boardFromCpp: value 5 (unknown) → treated as black king (val>=3 → black)', () => {
    // The function maps: val===1 || val===2 → white, else → black
    // val===5: not 0, not white → black, val===5 not king (2 or 4) → pawn
    // Actually: isWhite = val===1 || val===2, isKing = val===2 || val===4
    // val=5: isWhite=false, isKing=false → {color:'black', king:false}
    const board = boardFromCpp([[5]]);
    assert.deepEqual(board[0][0], { color: 'black', king: false });
  });

  test('boardFromCpp: value -1 (negative) → treated as black pawn', () => {
    const board = boardFromCpp([[-1]]);
    assert.deepEqual(board[0][0], { color: 'black', king: false });
  });

  // ── Single element ───────────────────────────────────────────────────

  test('boardFromCpp: single-element 2D [[1]]', () => {
    const board = boardFromCpp([[1]]);
    assert.equal(board.length, 1);
    assert.equal(board[0].length, 1);
    assert.deepEqual(board[0][0], { color: 'white', king: false });
  });

  test('boardFromCpp: single-element flat [1] produces 8x8 with first row=[1]', () => {
    // Not a real use case (requires 64 elements for flat), but function handles it
    const board = boardFromCpp([1]);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 1); // only 1 element in first row
  });

  // ── boardToCpp single element ────────────────────────────────────────

  test('boardToCpp: single white pawn → [1]', () => {
    const result = boardToCpp([[{ color: 'white', king: false }]]);
    assert.deepEqual(result, [1]);
  });

  test('boardToCpp: single black king → [4]', () => {
    const result = boardToCpp([[{ color: 'black', king: true }]]);
    assert.deepEqual(result, [4]);
  });

  // ── Round-trip with promotion-like values ────────────────────────────

  test('round-trip: all 5 piece types (0-4) in one row', () => {
    const row = [0, 1, 2, 3, 4, 0, 0, 0];
    const react = boardFromCpp([row]);
    const back = boardToCpp(react);
    assert.deepEqual(back, row);
  });

  // ── Flat array with all 64 positions ─────────────────────────────────

  test('boardFromCpp: flat 64 array, check row/col mapping', () => {
    const flat = new Array(64).fill(0);
    // Set specific positions
    flat[0] = 1;   // row=0, col=0
    flat[7] = 2;   // row=0, col=7
    flat[56] = 3;  // row=7, col=0
    flat[63] = 4;  // row=7, col=7
    flat[27] = 1;  // row=3, col=3

    const board = boardFromCpp(flat);

    assert.deepEqual(board[0][0], { color: 'white', king: false });
    assert.deepEqual(board[0][7], { color: 'white', king: true });
    assert.deepEqual(board[7][0], { color: 'black', king: false });
    assert.deepEqual(board[7][7], { color: 'black', king: true });
    assert.deepEqual(board[3][3], { color: 'white', king: false });
    assert.equal(board[1][0], null);
  });

  // ── boardToCpp always returns flat 64 ────────────────────────────────

  test('boardToCpp: always returns flat 64-element array', () => {
    const react = Array.from({ length: 8 }, () => new Array(8).fill(null));
    const result = boardToCpp(react);
    assert.equal(result.length, 64);
    assert.ok(!Array.isArray(result[0]), 'Should be flat, not nested');
  });

  // ── Round-trip: random board ─────────────────────────────────────────

  test('round-trip: random board with all piece types', () => {
    const rng = [];
    for (let i = 0; i < 64; i++) {
      rng.push(Math.floor(Math.random() * 5)); // 0-4
    }
    const react = boardFromCpp(rng);
    const back = boardToCpp(react);
    assert.deepEqual(back, rng);
  });

  // ── Checkers starting position exact values ──────────────────────────

  test('boardFromCpp: starting position — white on rows 5-7', () => {
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
    const board = boardFromCpp(start);

    // Count white and black pieces
    let whiteCount = 0, blackCount = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === 'white') whiteCount++;
        if (board[r][c]?.color === 'black') blackCount++;
      }
    }
    assert.equal(whiteCount, 12, 'White should have 12 pawns');
    assert.equal(blackCount, 12, 'Black should have 12 pawns');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Board Conversion Edge Case Tests');

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
