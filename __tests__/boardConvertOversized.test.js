/**
 * boardConvertOversized.test.js — Tests for boardFromCpp/boardToCpp with
 * oversized arrays, 2D non-8x8 boards, and boundary conditions not covered
 * by existing boardConvert*.test.js files.
 *
 * Covers:
 * - boardToCpp with oversized board (>64 elements) — truncation
 * - boardFromCpp with 2D array of wrong row count
 * - boardFromCpp with non-array row elements in 2D
 * - Mixed valid/invalid values in same board
 * - Performance-relevant: very large flat array
 * - boardToCpp with nested arrays (already-flat input)
 *
 * Import actual source functions for real behavior.
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runBoardConvertOversizedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp: oversized boards
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: 9x8 board truncates to 64 elements', () => {
    const board = Array.from({ length: 9 }, () => new Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[8][0] = { color: 'black', king: true }; // row 8, beyond 8x8
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1); // first element preserved
    // row 8 elements are truncated
  });

  test('boardToCpp: 8x9 board truncates to 64 elements', () => {
    const board = Array.from({ length: 8 }, () => new Array(9).fill(null));
    board[0][8] = { color: 'white', king: false }; // col 8, beyond 8x8
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
  });

  test('boardToCpp: 10x10 board truncates to 64', () => {
    const board = Array.from({ length: 10 }, () => new Array(10).fill(null));
    board[9][9] = { color: 'black', king: true };
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
  });

  test('boardToCpp: single row with 20 elements pads to 64 total', () => {
    const row = new Array(20).fill(null);
    row[0] = { color: 'white', king: false };
    const result = boardToCpp([row]);
    assert.equal(result.length, 64); // flat = 20, < 64, pads to 64
    assert.equal(result[0], 1);
  });

  test('boardToCpp: 8 rows of 8 with extra — total > 64 truncates', () => {
    const board = Array.from({ length: 8 }, (_, i) => {
      const row = new Array(8).fill(null);
      row[0] = { color: i % 2 === 0 ? 'white' : 'black', king: false };
      return row;
    });
    // Add extra row
    board.push([{ color: 'white', king: true }]);
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp: 2D array with wrong dimensions
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: 9 rows of 8 → empty board (wrong row count)', () => {
    const board = Array.from({ length: 9 }, () => new Array(8).fill(0));
    board[0][0] = 1;
    const result = boardFromCpp(board);
    // Source checks board2D.length !== 8 → returns empty
    assert.equal(result.length, 8);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 7 rows of 8 → empty board', () => {
    const board = Array.from({ length: 7 }, () => new Array(8).fill(0));
    const result = boardFromCpp(board);
    assert.equal(result.length, 8);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 8 rows but row 3 has 7 cols → empty board', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[3] = new Array(7).fill(0); // wrong length
    const result = boardFromCpp(board);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 8 rows but row 0 has 9 cols → empty board', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0] = new Array(9).fill(0);
    const result = boardFromCpp(board);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 8 rows, one row is null → empty board', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[4] = null;
    const result = boardFromCpp(board);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 8 rows, one row is undefined → empty board', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[4] = undefined;
    const result = boardFromCpp(board);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: 8 rows, one row is a string → empty board', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[4] = 'not an array';
    const result = boardFromCpp(board);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp: non-numeric cell values in valid 8x8
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: string "1" in cell → null (not a number)', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = "1";
    const result = boardFromCpp(board);
    assert.equal(result[0][0], null);
  });

  test('boardFromCpp: boolean true in cell → null', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = true;
    const result = boardFromCpp(board);
    assert.equal(result[0][0], null);
  });

  test('boardFromCpp: object in cell → null', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = { color: 'white' };
    const result = boardFromCpp(board);
    assert.equal(result[0][0], null);
  });

  test('boardFromCpp: NaN in cell → null (strict validation rejects non-0-4)', () => {
    // NaN is a number but not in range 0-4 → null
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = NaN;
    const result = boardFromCpp(board);
    assert.equal(result[0][0], null);
  });

  test('boardFromCpp: Infinity in cell → null (not 0-4)', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = Infinity;
    const result = boardFromCpp(board);
    // typeof Infinity === 'number' is true, but Infinity is not 0-4
    // val < 1 || val > 4 → Infinity > 4 → true → null
    assert.equal(result[0][0], null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp: flat array edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: flat array with 63 elements → empty (not 64)', () => {
    const flat = new Array(63).fill(0);
    flat[0] = 1;
    const result = boardFromCpp(flat);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: flat array with 65 elements → empty (not 64)', () => {
    const flat = new Array(65).fill(0);
    flat[0] = 1;
    const result = boardFromCpp(flat);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  test('boardFromCpp: flat array with 0 elements → empty board', () => {
    const result = boardFromCpp([]);
    assert.equal(result.length, 8);
    assert.ok(result.every(row => row.every(cell => cell === null)));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Round-trip: boardFromCpp → boardToCpp with non-standard values
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: mixed valid and invalid values — invalid become null/0', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = 1;  // valid white pawn
    board[0][1] = 5;  // invalid → null
    board[1][0] = 3;  // valid black pawn
    board[1][1] = -1; // invalid → null
    const react = boardFromCpp(board);
    const back = boardToCpp(react);
    assert.equal(back[0], 1);   // white pawn preserved
    assert.equal(back[1], 0);   // invalid → null → 0
    assert.equal(back[8], 3);   // black pawn preserved
    assert.equal(back[9], 0);   // invalid → null → 0
  });

  test('round-trip: all 5 piece values in 8x8 — values 1-4 preserved, 0 stays 0', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = 0; board[0][1] = 1; board[0][2] = 2; board[0][3] = 3; board[0][4] = 4;
    const react = boardFromCpp(board);
    const back = boardToCpp(react);
    assert.deepEqual(back.slice(0, 5), [0, 1, 2, 3, 4]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp: flat board input (1D array)
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: receives 1D array of pieces — flattens and converts', () => {
    // boardToCpp calls board.flat(), so a 1D array of objects works
    const row = [
      { color: 'white', king: false },
      null,
      { color: 'black', king: true },
    ];
    const result = boardToCpp([row]);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    assert.equal(result[1], 0);
    assert.equal(result[2], 4);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp/boardToCpp: performance-relevant large array
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: flat 64 array with all same value', () => {
    const flat = new Array(64).fill(1); // all white pawns
    const result = boardFromCpp(flat);
    assert.equal(result.length, 8);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        assert.deepEqual(result[r][c], { color: 'white', king: false });
      }
    }
  });

  test('boardFromCpp: flat 64 array with alternating values', () => {
    const flat = [];
    for (let i = 0; i < 64; i++) flat.push(i % 5); // 0,1,2,3,4,0,1,2...
    const result = boardFromCpp(flat);
    assert.equal(result[0][0], null);                      // 0
    assert.deepEqual(result[0][1], { color: 'white', king: false }); // 1
    assert.deepEqual(result[0][2], { color: 'white', king: true });  // 2
    assert.deepEqual(result[0][3], { color: 'black', king: false }); // 3
    assert.deepEqual(result[0][4], { color: 'black', king: true });  // 4
    assert.equal(result[0][5], null);                      // 0
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Board Convert Oversized & Boundary Tests');

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
