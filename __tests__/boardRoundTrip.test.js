/**
 * boardRoundTrip.test.js — Round-trip tests for boardToCpp / boardFromCpp.
 *
 * Validates that converting board formats back and forth preserves data:
 * - 2D 8x8 board → boardToCpp → boardFromCpp → original
 * - flat 64 array → boardFromCpp → boardToCpp → original
 * - null entries, king pieces, mixed colors
 * - edge case: negative values from C++
 *
 * Uses real server/boardConvert.js imports.
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runBoardRoundTripTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── 2D 8x8 → boardToCpp → boardFromCpp → original ─────────────────

  test('round-trip: 2D 8x8 React board → C++ → React', () => {
    const original = [
      [{ color: 'white', king: false }, null, { color: 'white', king: true }, null, null, null, null, null],
      [null, { color: 'black', king: false }, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, { color: 'black', king: true }, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, { color: 'white', king: false }, null, null],
      [null, null, null, null, null, null, { color: 'black', king: false }, null],
      [null, null, null, null, null, null, null, { color: 'white', king: true }],
    ];

    const flat = boardToCpp(original);
    const result = boardFromCpp(flat);

    assert.equal(result.length, 8, 'Board has 8 rows');
    for (let r = 0; r < 8; r++) {
      assert.equal(result[r].length, 8, `Row ${r} has 8 cols`);
      for (let c = 0; c < 8; c++) {
        const orig = original[r][c];
        const res = result[r][c];
        if (orig === null) {
          assert.equal(res, null, `[${r}][${c}] should be null`);
        } else {
          assert.ok(res !== null, `[${r}][${c}] should not be null`);
          assert.equal(res.color, orig.color, `[${r}][${c}] color mismatch`);
          assert.equal(res.king, orig.king, `[${r}][${c}] king mismatch`);
        }
      }
    }
  });

  test('round-trip: standard starting position (12+12 pieces)', () => {
    const startCpp = [
      [0,3,0,3,0,3,0,3],
      [3,0,3,0,3,0,3,0],
      [0,3,0,3,0,3,0,3],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [1,0,1,0,1,0,1,0],
      [0,1,0,1,0,1,0,1],
      [1,0,1,0,1,0,1,0],
    ];

    const react = boardFromCpp(startCpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, startCpp.flat(), 'Full round-trip preserves starting position');
  });

  // ── Flat 64 array → boardFromCpp → boardToCpp → original ───────────

  test('round-trip: flat 64 array → React → flat', () => {
    const original = new Array(64).fill(0);
    // Scatter some pieces
    original[0] = 1;   // white pawn
    original[9] = 3;   // black pawn
    original[18] = 2;  // white king
    original[27] = 4;  // black king
    original[50] = 1;
    original[63] = 3;

    const react = boardFromCpp(original);
    const back = boardToCpp(react);
    assert.deepEqual(back, original, 'Flat array round-trip preserves all values');
  });

  test('round-trip: flat 64 all zeros', () => {
    const original = new Array(64).fill(0);
    const react = boardFromCpp(original);
    const back = boardToCpp(react);
    assert.deepEqual(back, original, 'Empty board round-trip');
  });

  test('round-trip: flat 64 all pieces (every cell occupied)', () => {
    const original = [1,2,3,4,1,2,3,4,
                      3,4,1,2,3,4,1,2,
                      1,2,3,4,1,2,3,4,
                      3,4,1,2,3,4,1,2,
                      1,2,3,4,1,2,3,4,
                      3,4,1,2,3,4,1,2,
                      1,2,3,4,1,2,3,4,
                      3,4,1,2,3,4,1,2];

    const react = boardFromCpp(original);
    const back = boardToCpp(react);
    assert.deepEqual(back, original, 'Full board round-trip');
  });

  // ── Null entries ──────────────────────────────────────────────────────

  test('board with all null entries converts to all zeros', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const flat = boardToCpp(board);
    assert.deepEqual(flat, new Array(64).fill(0));
  });

  test('board with sparse nulls preserves null positions', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[7][7] = { color: 'black', king: true };
    // Everything else null

    const flat = boardToCpp(board);
    assert.equal(flat[0], 1, 'First element is white pawn');
    assert.equal(flat[63], 4, 'Last element is black king');
    for (let i = 1; i < 63; i++) {
      assert.equal(flat[i], 0, `Element ${i} should be 0`);
    }
  });

  // ── King pieces ───────────────────────────────────────────────────────

  test('white king round-trip: {white,king:true} → 2 → {white,king:true}', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: true };
    const flat = boardToCpp(board);
    assert.equal(flat[0], 2);
    const react = boardFromCpp(flat);
    assert.deepEqual(react[0][0], { color: 'white', king: true });
  });

  test('black king round-trip: {black,king:true} → 4 → {black,king:true}', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'black', king: true };
    const flat = boardToCpp(board);
    assert.equal(flat[0], 4);
    const react = boardFromCpp(flat);
    assert.deepEqual(react[0][0], { color: 'black', king: true });
  });

  test('board with only kings (no pawns)', () => {
    const original = [
      [2,0,0,0,0,0,0,4],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,2,0,0,0,0],
      [0,0,0,0,4,0,0,0],
      [0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0],
      [4,0,0,0,0,0,0,2],
    ];
    const react = boardFromCpp(original);
    const back = boardToCpp(react);
    assert.deepEqual(back, original.flat(), 'Kings-only board round-trip');
  });

  // ── Mixed colors ──────────────────────────────────────────────────────

  test('mixed white and black pieces in same row', () => {
    const board = [[
      { color: 'white', king: false },
      { color: 'black', king: false },
      { color: 'white', king: true },
      { color: 'black', king: true },
      null,
      null,
      null,
      null
    ]];
    const flat = boardToCpp(board);
    assert.deepEqual(flat.slice(0, 4), [1, 3, 2, 4], 'Row encodes correctly');

    // Pad for full 64
    const fullFlat = [...flat, ...new Array(56).fill(0)];
    // Trim to 64
    fullFlat.length = 64;

    const react = boardFromCpp(fullFlat);
    assert.deepEqual(react[0][0], { color: 'white', king: false });
    assert.deepEqual(react[0][1], { color: 'black', king: false });
    assert.deepEqual(react[0][2], { color: 'white', king: true });
    assert.deepEqual(react[0][3], { color: 'black', king: true });
    assert.equal(react[0][4], null);
  });

  // ── Edge case: negative values (C++ might send them) ──────────────────

  test('boardFromCpp: negative values treated as null (unknown)', () => {
    const flat = [-1, -5, -100, 0, 1, 2, 3, 4,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0,
                  0,0,0,0,0,0,0,0];
    const react = boardFromCpp(flat);
    assert.equal(react[0][0], null, 'Negative value -1 → null');
    assert.equal(react[0][1], null, 'Negative value -5 → null');
    assert.equal(react[0][2], null, 'Negative value -100 → null');
    assert.equal(react[0][3], null, 'Zero → null');
    assert.deepEqual(react[0][4], { color: 'white', king: false }, 'Value 1 → white pawn');
    assert.deepEqual(react[0][5], { color: 'white', king: true }, 'Value 2 → white king');
    assert.deepEqual(react[0][6], { color: 'black', king: false }, 'Value 3 → black pawn');
    assert.deepEqual(react[0][7], { color: 'black', king: true }, 'Value 4 → black king');
  });

  test('boardFromCpp: values above 4 treated as null (unknown)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 5;
    flat[1] = 10;
    flat[2] = 100;
    flat[3] = 255;

    const react = boardFromCpp(flat);
    assert.equal(react[0][0], null, 'Value 5 → null');
    assert.equal(react[0][1], null, 'Value 10 → null');
    assert.equal(react[0][2], null, 'Value 100 → null');
    assert.equal(react[0][3], null, 'Value 255 → null');
  });

  test('boardFromCpp with NaN values: treated as null', () => {
    const flat = new Array(64).fill(NaN);
    flat[0] = 1; // valid white pawn
    const react = boardFromCpp(flat);
    assert.deepEqual(react[0][0], { color: 'white', king: false }, 'Valid value works');
    assert.equal(react[0][1], null, 'NaN → null');
    assert.equal(react[1][0], null, 'NaN → null');
  });

  // ── Edge case: boundary positions ─────────────────────────────────────

  test('corner-to-corner board round-trip', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[0][7] = { color: 'white', king: true };
    board[7][0] = { color: 'black', king: false };
    board[7][7] = { color: 'black', king: true };

    const flat = boardToCpp(board);
    const react = boardFromCpp(flat);

    assert.deepEqual(react[0][0], board[0][0], 'Top-left corner');
    assert.deepEqual(react[0][7], board[0][7], 'Top-right corner');
    assert.deepEqual(react[7][0], board[7][0], 'Bottom-left corner');
    assert.deepEqual(react[7][7], board[7][7], 'Bottom-right corner');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Board Round-Trip Tests');

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
