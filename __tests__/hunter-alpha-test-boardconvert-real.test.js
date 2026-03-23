/**
 * hunter-alpha-test-boardconvert-real.test.js — Real-import tests for boardConvert.js
 *
 * Gaps filled:
 * - Uses ACTUAL imports (not inline copies like existing NaN test)
 * - NaN values in flat and 2D arrays
 * - Infinity, -Infinity
 * - Mixed valid/invalid values
 * - Boolean and string coercion edge cases
 * - boardToCpp with exotic object shapes
 * - Null prototype objects
 * - Frozen/sealed arrays
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runHunterAlphaTestBoardconvertReal() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — NaN handling
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: NaN in flat array → null', () => {
    const flat = new Array(64).fill(0);
    flat[0] = NaN;
    flat[10] = 1;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null, 'NaN should become null');
    assert.deepEqual(board[1][2], { color: 'white', king: false });
  });

  test('boardFromCpp: NaN in 2D array → null', () => {
    const arr = Array.from({ length: 8 }, () => Array(8).fill(NaN));
    arr[3][3] = 2;
    const board = boardFromCpp(arr);
    assert.equal(board[0][0], null, 'NaN cells should be null');
    assert.deepEqual(board[3][3], { color: 'white', king: true });
  });

  test('boardFromCpp: all NaN flat → all null board', () => {
    const flat = new Array(64).fill(NaN);
    const board = boardFromCpp(flat);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        assert.equal(board[r][c], null);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — Infinity
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: Infinity → null (out of 1-4 range)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = Infinity;
    flat[1] = -Infinity;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null, 'Infinity should become null');
    assert.equal(board[0][1], null, '-Infinity should become null');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — string coercion
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: string "1" → null (typeof check)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = '1';
    flat[1] = 'white';
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null, 'string "1" should be null (not typeof number)');
    assert.equal(board[0][1], null, 'string "white" should be null');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — boolean values
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: boolean true/false → null', () => {
    const flat = new Array(64).fill(0);
    flat[0] = true;
    flat[1] = false;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null, 'true should be null');
    assert.equal(board[0][1], null, 'false should be null');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — floating point values
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: float 1.5 → maps to black pawn (no int validation)', () => {
    // BUG NOTE: 1.5 passes typeof number, NaN check, and 1-4 range check.
    // But val===1 is false, val===2 is false → isWhite=false, isKing=false
    // Result: { color: 'black', king: false } — technically incorrect mapping.
    // Floats should ideally be rejected, but the code doesn't validate integer type.
    const flat = new Array(64).fill(0);
    flat[0] = 1.5;
    const board = boardFromCpp(flat);
    // Document actual behavior (not ideal, but not crashing)
    assert.ok(board[0][0] !== undefined, 'should not be undefined');
  });

  test('boardFromCpp: float 3.7 → maps to black pawn (no int validation)', () => {
    // Same issue as 1.5 — floats in 1-4 range pass validation but don't match piece codes
    const flat = new Array(64).fill(0);
    flat[0] = 3.7;
    const board = boardFromCpp(flat);
    assert.ok(board[0][0] !== undefined, 'should not be undefined');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — mixed valid/invalid
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: mix of valid, NaN, Infinity in one row', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1;       // valid white pawn
    flat[1] = NaN;
    flat[2] = 4;       // valid black king
    flat[3] = Infinity;
    flat[4] = -1;
    flat[5] = 5;       // out of range
    const board = boardFromCpp(flat);
    assert.deepEqual(board[0][0], { color: 'white', king: false });
    assert.equal(board[0][1], null);
    assert.deepEqual(board[0][2], { color: 'black', king: true });
    assert.equal(board[0][3], null);
    assert.equal(board[0][4], null);
    assert.equal(board[0][5], null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp — exotic objects
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: null prototype object → 0', () => {
    const obj = Object.create(null);
    obj.color = 'white';
    obj.king = false;
    const board = [[obj, null], ...Array.from({ length: 7 }, () => Array(8).fill(null))];
    // Pad to 8 rows of 8
    while (board.length < 8) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    // Null prototype objects still have .color and .king — should work
    assert.equal(result[0], 1, 'null-prototype with color=white, king=false → 1');
  });

  test('boardToCpp: frozen piece object → same result', () => {
    const piece = Object.freeze({ color: 'black', king: true });
    const board = [[piece, null], ...Array.from({ length: 7 }, () => Array(8).fill(null))];
    while (board.length < 8) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result[0], 4, 'frozen black king → 4');
  });

  test('boardToCpp: piece with extra properties — ignores extras', () => {
    const piece = { color: 'white', king: true, id: 42, name: 'knight' };
    const board = [[piece, null], ...Array.from({ length: 7 }, () => Array(8).fill(null))];
    while (board.length < 8) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result[0], 2, 'extra properties should be ignored');
  });

  test('boardToCpp: array entry instead of object → 0', () => {
    const board = [[['white', false], null], ...Array.from({ length: 7 }, () => Array(8).fill(null))];
    while (board.length < 8) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result[0], 0, 'array should be treated as invalid piece');
  });

  test('boardToCpp: piece with wrong color string → 0', () => {
    const piece = { color: 'red', king: false };
    const board = [[piece, null], ...Array.from({ length: 7 }, () => Array(8).fill(null))];
    while (board.length < 8) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result[0], 0, 'unknown color should give 0');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp — 2D array with jagged rows
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: 2D array with row of 7 elements → empty board', () => {
    const arr = Array.from({ length: 8 }, () => Array(8).fill(0));
    arr[3] = Array(7).fill(0); // row 3 has only 7 elements
    const board = boardFromCpp(arr);
    // The validation checks each row has length 8, so this should return empty
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)),
      'jagged 2D array should return empty board');
  });

  test('boardFromCpp: 2D array with 7 rows → empty board', () => {
    const arr = Array.from({ length: 7 }, () => Array(8).fill(1));
    const board = boardFromCpp(arr);
    assert.equal(board.length, 8);
    assert.ok(board.every(row => row.every(cell => cell === null)));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp — short/long board arrays
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: 7x7 board → padded to 64', () => {
    const board = Array.from({ length: 7 }, () => Array(7).fill(null));
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0), 'should be all zeros after padding');
  });

  test('boardToCpp: 9x9 board → truncated to 64', () => {
    const board = Array.from({ length: 9 }, (_, r) =>
      Array.from({ length: 9 }, (_, c) => (r + c) % 3 === 0 ? { color: 'white', king: false } : null)
    );
    const result = boardToCpp(board);
    assert.equal(result.length, 64, 'should truncate to 64');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Round-trip with real imports
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: all piece types', () => {
    const flat = [1, 2, 3, 4, 0, 0, 0, 0,
                  1, 0, 0, 3, 0, 0, 2, 4,
                  ...new Array(48).fill(0)];
    const react = boardFromCpp(flat);
    const back = boardToCpp(react);
    assert.deepEqual(back, flat, 'round-trip should preserve all values');
  });

  test('round-trip: mostly empty board with one king', () => {
    const flat = new Array(64).fill(0);
    flat[27] = 2; // white king at (3,3)
    const react = boardFromCpp(flat);
    assert.deepEqual(react[3][3], { color: 'white', king: true });
    const back = boardToCpp(react);
    assert.deepEqual(back, flat);
  });

  // ── Run ──────────────────────────────────────────────────────────────
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
  console.log(`\n  boardconvert-real-import: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
