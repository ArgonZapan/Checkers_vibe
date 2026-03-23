/**
 * boardToCppValidation.test.js — Tests for BUG-008: boardToCpp with incomplete boards.
 *
 * boardToCpp should return a 64-element array even when given a board with
 * fewer than 8 rows, padding with zeros instead of crashing.
 *
 * Mirrors server/boardConvert.js boardToCpp logic.
 */

import assert from 'node:assert/strict';

// ── Extracted: boardToCpp (mirrors server/boardConvert.js) ──────────────────

function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    return new Array(64).fill(0);
  }
  const flat = board.flat();
  // Normalize flat array to exactly 64 elements
  if (flat.length !== 64) {
    if (flat.length > 64) {
      flat.length = 64;
    } else {
      // Pad with zeros
      const originalLen = flat.length;
      flat.length = 64;
      flat.fill(0, originalLen);
    }
  }
  return flat.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 0;
    const color = p.color;
    const king = p.king;
    if (color === 'white') return king ? 2 : 1;
    if (color === 'black') return king ? 4 : 3;
    return 0;
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePiece(color, king = false) {
  return { color, king };
}

function makeRow(pieces) {
  return pieces.map(p => p === 'w' ? makePiece('white') : p === 'W' ? makePiece('white', true) : p === 'b' ? makePiece('black') : p === 'B' ? makePiece('black', true) : null);
}

function makeFullBoard() {
  // Standard 8x8 empty board
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runBoardToCppValidationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Normal 8x8 board ──────────────────────────────────────────────────

  test('8x8 empty board returns 64 zeros', () => {
    const board = makeFullBoard();
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('8x8 board with pieces encodes correctly', () => {
    const board = makeFullBoard();
    board[0][0] = makePiece('white');     // 1
    board[1][1] = makePiece('white', true); // 2
    board[2][2] = makePiece('black');     // 3
    board[3][3] = makePiece('black', true); // 4
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1, 'white pawn');
    assert.equal(result[9], 2, 'white king');
    assert.equal(result[18], 3, 'black pawn');
    assert.equal(result[27], 4, 'black king');
  });

  // ── BUG-008: Board with fewer than 8 rows ─────────────────────────────

  test('board with 1 row returns 64-element array (padded with zeros)', () => {
    const board = [makeRow(['w', null, 'b', null, null, null, null, null])];
    const result = boardToCpp(board);
    assert.equal(result.length, 64, 'Should return 64 elements');
    assert.equal(result[0], 1, 'First element should be white pawn');
    assert.equal(result[2], 3, 'Third element should be black pawn');
    assert.ok(result.slice(8).every(v => v === 0), 'Remaining elements should be zeros');
  });

  test('board with 4 rows returns 64-element array', () => {
    const board = [
      makeRow(['w', null, null, null, null, null, null, null]),
      makeRow([null, 'b', null, null, null, null, null, null]),
      makeRow([null, null, 'W', null, null, null, null, null]),
      makeRow([null, null, null, 'B', null, null, null, null]),
    ];
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    assert.equal(result[9], 3);
    assert.equal(result[18], 2);
    assert.equal(result[27], 4);
    assert.ok(result.slice(32).every(v => v === 0), 'Rows 5-8 should be zeros');
  });

  test('board with 7 rows returns 64-element array (last row zeros)', () => {
    const board = Array.from({ length: 7 }, (_, r) => {
      const row = Array(8).fill(null);
      row[r] = makePiece('white');
      return row;
    });
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    // First 7 diagonal elements should be 1 (white pawn)
    for (let r = 0; r < 7; r++) {
      assert.equal(result[r * 8 + r], 1, `Row ${r} col ${r} should be white pawn`);
    }
    // Last 8 elements (row 7) should all be zeros
    assert.ok(result.slice(56).every(v => v === 0), 'Last row should be zeros');
  });

  // ── Empty / null / invalid inputs ─────────────────────────────────────

  test('null board returns 64 zeros', () => {
    const result = boardToCpp(null);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('undefined board returns 64 zeros', () => {
    const result = boardToCpp(undefined);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('non-array board returns 64 zeros', () => {
    const result = boardToCpp('not a board');
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('empty array returns 64 zeros', () => {
    const result = boardToCpp([]);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  // ── Board with non-standard cell values ───────────────────────────────

  test('board with null cells encodes as zeros', () => {
    const board = makeFullBoard();
    board[0][0] = null;
    board[0][1] = undefined;
    board[0][2] = 'invalid';
    board[0][3] = 42;
    const result = boardToCpp(board);
    assert.equal(result[0], 0);
    assert.equal(result[1], 0);
    assert.equal(result[2], 0);
    assert.equal(result[3], 0);
  });

  // ── Board with empty rows ─────────────────────────────────────────────

  test('board with empty rows (fewer than 8 cols per row)', () => {
    const board = [
      [makePiece('white'), null],
      [],
      [null, makePiece('black')],
    ];
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    // flat: [white_pawn, null, null, black_pawn, ...zeros]
    assert.equal(result[0], 1, 'First element: white pawn');
    assert.equal(result[1], 0, 'Second element: null → 0');
    assert.equal(result[2], 0, 'Third element: null → 0');
    assert.equal(result[3], 3, 'Fourth element: black pawn');
    assert.ok(result.slice(4).every(v => v === 0), 'Remaining should be zeros');
  });

  // ── Flat board input (already flat 64) ────────────────────────────────

  test('flat 64-element array input works', () => {
    const flat = new Array(64).fill(0);
    flat[0] = { color: 'white', king: false };
    flat[63] = { color: 'black', king: true };
    const result = boardToCpp(flat);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    assert.equal(result[63], 4);
  });

  // ── Run all tests ─────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
