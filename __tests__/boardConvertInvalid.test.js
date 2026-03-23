/**
 * boardConvertInvalid.test.js — Edge cases for boardFromCpp / boardToCpp:
 * invalid input, captures, malformed data.
 *
 * M27 review note (issue #123): test edge cases for conversion helpers.
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runBoardConvertInvalidTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Invalid input: null / undefined (graceful defaults) ───────────────

  test('boardFromCpp: null input → returns empty 8x8 board', () => {
    const board = boardFromCpp(null);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: undefined input → returns empty 8x8 board', () => {
    const board = boardFromCpp(undefined);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardToCpp: null input → returns 64 zeros', () => {
    const arr = boardToCpp(null);
    assert.equal(arr.length, 64);
    assert.ok(arr.every(v => v === 0));
  });

  test('boardToCpp: undefined input → returns 64 zeros', () => {
    const arr = boardToCpp(undefined);
    assert.equal(arr.length, 64);
    assert.ok(arr.every(v => v === 0));
  });

  // ── Invalid input: non-array (graceful defaults) ─────────────────────

  test('boardFromCpp: number input → returns empty 8x8 board', () => {
    const board = boardFromCpp(42);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: string input → returns empty 8x8 board', () => {
    const board = boardFromCpp("000");
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardToCpp: number input → returns 64 zeros', () => {
    const arr = boardToCpp(42);
    assert.equal(arr.length, 64);
    assert.ok(arr.every(v => v === 0));
  });

  // ── Wrong dimensions ─────────────────────────────────────────────────

  test('boardFromCpp: 7x7 board (wrong size) → returns empty 8x8 (strict shape)', () => {
    const small = Array.from({ length: 7 }, () => new Array(7).fill(0));
    const board = boardFromCpp(small);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 4x4 board → returns empty 8x8 (strict shape)', () => {
    const small = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const board = boardFromCpp(small);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: jagged rows (different lengths) → returns empty 8x8', () => {
    const board = boardFromCpp([[0, 0, 0, 0, 0, 0, 0, 0], [0, 0]]);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  // ── Capture scenarios (piece removal) ────────────────────────────────

  test('round-trip: board after captures (half-empty)', () => {
    // After several captures — some rows partially empty
    const afterCaptures = [
      [0, 0, 0, 0, 0, 0, 0, 3],  // only 1 black pawn left
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 3, 0, 0, 0, 0, 0],  // 1 black pawn stranded
      [0, 0, 0, 0, 1, 0, 0, 0],  // 1 white pawn
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0, 0],  // 1 white pawn
    ];
    const react = boardFromCpp(afterCaptures);
    const back = boardToCpp(react);
    assert.deepEqual(back, afterCaptures.flat());
  });

  test('round-trip: kings-only board (endgame)', () => {
    const kingsEndgame = [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 4, 0, 0, 0, 0],  // black king
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 2, 0, 0],  // white king
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const react = boardFromCpp(kingsEndgame);
    const back = boardToCpp(react);
    assert.deepEqual(back, kingsEndgame.flat());
  });

  test('round-trip: one piece remaining (winning position)', () => {
    const onePiece = Array.from({ length: 8 }, () => new Array(8).fill(0));
    onePiece[0][1] = 4; // single black king
    const react = boardFromCpp(onePiece);
    // Verify only 1 piece
    let count = 0;
    react.forEach(row => row.forEach(cell => { if (cell) count++; }));
    assert.equal(count, 1);
    // Round-trip
    const back = boardToCpp(react);
    assert.deepEqual(back, onePiece.flat());
  });

  // ── Objects with extra/missing properties in boardToCpp ──────────────

  test('boardToCpp: piece with extra property → works', () => {
    const react = [[{ color: 'white', king: false, extra: 'ignored' }]];
    const result = boardToCpp(react);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    assert.equal(result[1], 0);
  });

  test('boardToCpp: piece missing king → king is undefined (falsy) → pawn', () => {
    const react = [[{ color: 'white' }]];
    const result = boardToCpp(react);
    // king is undefined → falsy → pawn → 1
    assert.equal(result[0], 1);
  });

  test('boardToCpp: piece missing color → returns 0 (unknown)', () => {
    const react = [[{ king: false }]];
    const result = boardToCpp(react);
    // p.color is undefined, not "white" or "black" → falls to 0
    assert.equal(result[0], 0);
  });

  // ── Empty arrays / sparse ────────────────────────────────────────────

  test('boardFromCpp: empty array [] → returns 8x8 empty board', () => {
    const board = boardFromCpp([]);
    assert.equal(board.length, 8);
    board.forEach(row => assert.equal(row.length, 8));
    board.forEach(row => row.forEach(cell => assert.equal(cell, null)));
  });

  test('boardToCpp: empty board [] → returns 64 zeros (padded)', () => {
    const result = boardToCpp([]);
    assert.equal(result.length, 64);
    assert.deepEqual(result, new Array(64).fill(0));
  });

  // ── Extreme flat array ───────────────────────────────────────────────

  test('boardFromCpp: flat array with 128 elements → returns empty board (not 64)', () => {
    // Flat arrays with length !== 64 are invalid — graceful default is empty board
    const flat = new Array(128).fill(0);
    flat[0] = 2;
    const board = boardFromCpp(flat);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  // ── Run ──────────────────────────────────────────────────────────────

  console.log('\n📋 Board Conversion Invalid/Edge Tests');

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
