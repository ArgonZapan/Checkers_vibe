/**
 * hunter-sub-boardconvert-roundtrip.test.js — Round-trip edge cases for boardToCpp/boardFromCpp
 *
 * Focus: board with only kings, board with mixed pieces at edges, promotion scenarios
 *
 * Imports the REAL module from server/boardConvert.js
 */

import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';
import assert from 'node:assert/strict';

function emptyBoard() { return new Array(64).fill(0); }

function makeCppBoard(setup) {
  const flat = emptyBoard();
  for (const [pos, val] of setup) flat[pos] = val;
  return flat;
}

export async function runBoardconvertRoundtripTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: board with only kings
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: board with only white kings', () => {
    const cpp = makeCppBoard([
      [9, 2], [11, 2], [13, 2], [15, 2], // row 1, 4 white kings
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'white kings round-trip');
  });

  test('round-trip: board with only black kings', () => {
    const cpp = makeCppBoard([
      [48, 4], [50, 4], [52, 4], [54, 4], // row 6, 4 black kings
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'black kings round-trip');
  });

  test('round-trip: mixed white and black kings only', () => {
    const cpp = makeCppBoard([
      [27, 2], // white king (3,3)
      [36, 4], // black king (4,4)
      [18, 2], // white king (2,2)
      [45, 4], // black king (5,5)
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'mixed kings round-trip');
  });

  test('round-trip: single white king at each corner', () => {
    for (const pos of [0, 7, 56, 63]) {
      const cpp = makeCppBoard([[pos, 2]]);
      const react = boardFromCpp(cpp);
      assert.equal(react[Math.floor(pos / 8)][pos % 8]?.color, 'white');
      assert.equal(react[Math.floor(pos / 8)][pos % 8]?.king, true);
      const back = boardToCpp(react);
      assert.deepEqual(back, cpp, `white king at corner ${pos}`);
    }
  });

  test('round-trip: single black king at each corner', () => {
    for (const pos of [0, 7, 56, 63]) {
      const cpp = makeCppBoard([[pos, 4]]);
      const react = boardFromCpp(cpp);
      assert.equal(react[Math.floor(pos / 8)][pos % 8]?.color, 'black');
      assert.equal(react[Math.floor(pos / 8)][pos % 8]?.king, true);
      const back = boardToCpp(react);
      assert.deepEqual(back, cpp, `black king at corner ${pos}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: mixed pieces at edges
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: all piece types on top edge (row 0)', () => {
    const cpp = emptyBoard();
    cpp[0] = 0; cpp[1] = 1; cpp[2] = 2; cpp[3] = 3; cpp[4] = 4; cpp[5] = 0; cpp[6] = 0; cpp[7] = 0;
    // Need 8 elements for row 0: [0, 1, 2, 3, 4, 0, 0, 0]
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'top edge mixed pieces');
  });

  test('round-trip: all piece types on bottom edge (row 7)', () => {
    const cpp = emptyBoard();
    cpp[56] = 1; cpp[57] = 2; cpp[58] = 3; cpp[59] = 4; cpp[60] = 0;
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'bottom edge mixed pieces');
  });

  test('round-trip: pieces on left edge (col 0)', () => {
    const cpp = makeCppBoard([
      [0, 2], [8, 3], [16, 4], [24, 1], [32, 2], [40, 3], [48, 4], [56, 1],
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'left edge mixed pieces');
  });

  test('round-trip: pieces on right edge (col 7)', () => {
    const cpp = makeCppBoard([
      [7, 1], [15, 2], [23, 3], [31, 4], [39, 1], [47, 2], [55, 3], [63, 4],
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'right edge mixed pieces');
  });

  test('round-trip: all four corners with different pieces', () => {
    const cpp = makeCppBoard([
      [0, 1],   // top-left: white pawn
      [7, 2],   // top-right: white king
      [56, 3],  // bottom-left: black pawn
      [63, 4],  // bottom-right: black king
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'four corners mixed');
    // Verify react conversion
    assert.deepEqual(react[0][0], { color: 'white', king: false });
    assert.deepEqual(react[0][7], { color: 'white', king: true });
    assert.deepEqual(react[7][0], { color: 'black', king: false });
    assert.deepEqual(react[7][7], { color: 'black', king: true });
  });

  test('round-trip: pieces on entire outer border', () => {
    const cpp = emptyBoard();
    // Fill borders: top row
    for (let c = 0; c < 8; c++) cpp[c] = (c % 4) + 1;
    // bottom row
    for (let c = 0; c < 8; c++) cpp[56 + c] = ((c + 2) % 4) + 1;
    // left col (rows 1-6)
    for (let r = 1; r < 7; r++) cpp[r * 8] = (r % 4) + 1;
    // right col (rows 1-6)
    for (let r = 1; r < 7; r++) cpp[r * 8 + 7] = ((r + 1) % 4) + 1;
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'full border pieces round-trip');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: promotion-like boards (pawns at promotion row)
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: white pawns on row 0 (promotion row)', () => {
    // After promotion these would be kings, but testing the conversion
    const cpp = makeCppBoard([
      [0, 1], [2, 1], [4, 1], [6, 1], // white pawns on row 0
    ]);
    const react = boardFromCpp(cpp);
    // Should still convert correctly even if "logically" promoted
    assert.equal(react[0][0]?.color, 'white');
    assert.equal(react[0][0]?.king, false); // conversion doesn't auto-promote
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp);
  });

  test('round-trip: black pawns on row 7 (promotion row)', () => {
    const cpp = makeCppBoard([
      [57, 3], [59, 3], [61, 3], [63, 3],
    ]);
    const react = boardFromCpp(cpp);
    assert.equal(react[7][1]?.color, 'black');
    assert.equal(react[7][1]?.king, false);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp);
  });

  test('round-trip: kings on promotion rows (already promoted)', () => {
    const cpp = makeCppBoard([
      [0, 2], [7, 2], // white kings on row 0
      [56, 4], [63, 4], // black kings on row 7
    ]);
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'kings on promotion rows');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: boardFromCpp 2D input round-trip
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: 2D input with kings only', () => {
    const cpp2D = [
      [0, 0, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 4, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const react = boardFromCpp(cpp2D);
    const back = boardToCpp(react);
    assert.deepEqual(back[2], 2, 'white king at (0,2)');
    assert.deepEqual(back[28], 4, 'black king at (3,4)');
  });

  test('round-trip: 2D input with mixed edge pieces', () => {
    const cpp2D = [
      [1, 0, 0, 0, 0, 0, 0, 4],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [2, 0, 0, 0, 0, 0, 0, 3],
    ];
    const react = boardFromCpp(cpp2D);
    const back = boardToCpp(react);
    assert.equal(back[0], 1);   // white pawn (0,0)
    assert.equal(back[7], 4);   // black king (0,7)
    assert.equal(back[56], 2);  // white king (7,0)
    assert.equal(back[63], 3);  // black pawn (7,7)
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: extreme positions
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: full board (all 64 squares occupied)', () => {
    const cpp = [];
    for (let i = 0; i < 64; i++) {
      cpp.push((i % 4) + 1); // cycle through 1,2,3,4
    }
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'full board round-trip');
  });

  test('round-trip: empty board', () => {
    const cpp = emptyBoard();
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'empty board round-trip');
    assert.ok(react.every(row => row.every(cell => cell === null)));
  });

  test('round-trip: standard checkers starting position', () => {
    const cpp = emptyBoard();
    // Black pawns: rows 0-2
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) cpp[r * 8 + c] = 3;
      }
    }
    // White pawns: rows 5-7
    for (let r = 5; r <= 7; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) cpp[r * 8 + c] = 1;
      }
    }
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'starting position round-trip');
    // Verify piece count
    const whiteCount = react.flat().filter(p => p?.color === 'white').length;
    const blackCount = react.flat().filter(p => p?.color === 'black').length;
    assert.equal(whiteCount, 12, '12 white pawns');
    assert.equal(blackCount, 12, '12 black pawns');
  });

  test('round-trip: diagonal pieces', () => {
    const cpp = emptyBoard();
    for (let i = 0; i < 8; i++) {
      cpp[i * 8 + i] = (i % 2 === 0) ? 2 : 4; // alternating kings on diagonal
    }
    const react = boardFromCpp(cpp);
    const back = boardToCpp(react);
    assert.deepEqual(back, cpp, 'diagonal kings round-trip');
  });

  test('round-trip: 2D input — kings on opposite corners', () => {
    const cpp2D = [
      [2, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 4],
    ];
    const react = boardFromCpp(cpp2D);
    assert.deepEqual(react[0][0], { color: 'white', king: true });
    assert.deepEqual(react[7][7], { color: 'black', king: true });
    const back = boardToCpp(react);
    assert.equal(back[0], 2);
    assert.equal(back[63], 4);
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

  console.log(`\n  boardconvert-roundtrip: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
