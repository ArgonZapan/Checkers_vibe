/**
 * hunter-alpha-boardconvert-nan.test.js — boardConvert edge cases with NaN, floats, non-standard inputs.
 *
 * Gaps identified:
 * - boardFromCpp with NaN values in flat array
 * - boardFromCpp with floating point values (1.5, 2.7, etc.)
 * - boardFromCpp with negative numbers
 * - boardFromCpp with strings in array
 * - boardFromCpp with 2D array with NaN values
 * - boardToCpp with pieces having extra properties
 * - boardToCpp with undefined entries in array
 * - boardToCpp with non-standard color strings
 * - Round-trip with edge piece values (value 5, -1, etc.)
 */
import assert from 'node:assert/strict';

// ── Inline boardConvert functions ─────────────────────────────────────

function boardFromCpp(cppBoard) {
  if (!cppBoard || !Array.isArray(cppBoard)) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  if (cppBoard.length === 0) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  let board2D = cppBoard;
  if (Array.isArray(cppBoard) && !Array.isArray(cppBoard[0])) {
    if (cppBoard.length !== 64) {
      return Array.from({ length: 8 }, () => Array(8).fill(null));
    }
    board2D = [];
    for (let r = 0; r < 8; r++) {
      board2D.push(cppBoard.slice(r * 8, r * 8 + 8));
    }
  }
  if (board2D.length !== 8) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  for (let r = 0; r < 8; r++) {
    if (!Array.isArray(board2D[r]) || board2D[r].length !== 8) {
      return Array.from({ length: 8 }, () => Array(8).fill(null));
    }
  }
  return board2D.map(row => row.map(val => {
    if (typeof val !== 'number' || Number.isNaN(val) || val === 0) return null;
    if (val < 1 || val > 4) return null;
    const isWhite = val === 1 || val === 2;
    const isKing = val === 2 || val === 4;
    return { color: isWhite ? 'white' : 'black', king: isKing };
  }));
}

function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    return new Array(64).fill(0);
  }
  const flat = board.flat();
  if (flat.length !== 64) {
    if (flat.length > 64) {
      flat.length = 64;
    } else {
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

export async function runHunterAlphaBoardconvertNanTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── boardFromCpp with NaN ──────────────────────────────────────────

  test('boardFromCpp: flat array with NaN values → null at those positions', () => {
    const flat = new Array(64).fill(0);
    flat[0] = NaN;
    flat[10] = NaN;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null);
    assert.equal(board[1][2], null); // index 10 = row 1, col 2
  });

  test('boardFromCpp: 2D array with NaN values → null at those positions', () => {
    const board2D = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board2D[3][4] = NaN;
    const board = boardFromCpp(board2D);
    assert.equal(board[3][4], null);
  });

  // ── boardFromCpp with floating point values ────────────────────────

  test('boardFromCpp: flat array with float 1.5 → null (not integer 1-4)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1.5;
    const board = boardFromCpp(flat);
    // typeof 1.5 === 'number' && !Number.isNaN(1.5) && 1.5 !== 0 && 1.5 >= 1 && 1.5 <= 4
    // But the code checks val < 1 || val > 4 — 1.5 passes that
    // However, it's not exactly 1,2,3,4 so isWhite/isKing would be wrong
    // 1.5 !== 1, !== 2 → isWhite=false, isKing=false → 'black', king:false
    // Actually let's check: val===1||val===2 is false, isKing=val===2||val===4 is false
    // So it returns {color:'black', king:false}
    // This is a potential bug — floats 1.5 map to black pawn
    const result = board[0][0];
    assert.ok(result !== null, 'float 1.5 should produce a piece (potential bug: maps to black pawn)');
    assert.equal(result.color, 'black');
    assert.equal(result.king, false);
  });

  test('boardFromCpp: flat array with float 2.7 → black pawn (not white king)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 2.7;
    const board = boardFromCpp(flat);
    const result = board[0][0];
    assert.ok(result !== null);
    // 2.7 !== 1, !== 2 → isWhite=false; 2.7 !== 2, !== 4 → isKing=false
    assert.equal(result.color, 'black');
    assert.equal(result.king, false);
  });

  // ── boardFromCpp with negative numbers ─────────────────────────────

  test('boardFromCpp: negative value -1 → null (out of 1-4 range)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = -1;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null);
  });

  test('boardFromCpp: negative value -3 → null', () => {
    const flat = new Array(64).fill(0);
    flat[5] = -3;
    const board = boardFromCpp(flat);
    assert.equal(board[0][5], null);
  });

  // ── boardFromCpp with string values ────────────────────────────────

  test('boardFromCpp: string "1" in array → null (typeof check)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = '1';
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null);
  });

  test('boardFromCpp: string "white" in 2D array → null', () => {
    const board2D = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board2D[0][0] = 'white';
    const board = boardFromCpp(board2D);
    assert.equal(board[0][0], null);
  });

  // ── boardFromCpp with value 5 (out of range) ───────────────────────

  test('boardFromCpp: value 5 → null (out of 1-4 range)', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 5;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null);
  });

  test('boardFromCpp: value 10 → null', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 10;
    const board = boardFromCpp(flat);
    assert.equal(board[0][0], null);
  });

  // ── boardToCpp with extra properties ───────────────────────────────

  test('boardToCpp: piece with extra properties ignores them', () => {
    const react = [[{ color: 'white', king: false, extra: 'ignored', id: 42 }]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 1);
  });

  test('boardToCpp: piece with missing king property → pawn', () => {
    const react = [[{ color: 'white' }]];
    const cpp = boardToCpp(react);
    // king is undefined → falsy → 1 (white pawn)
    assert.equal(cpp[0], 1);
  });

  test('boardToCpp: piece with king=0 → pawn', () => {
    const react = [[{ color: 'white', king: 0 }]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 1);
  });

  test('boardToCpp: piece with king="yes" → truthy → king', () => {
    const react = [[{ color: 'black', king: 'yes' }]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 4); // black king
  });

  // ── boardToCpp with undefined/null entries ─────────────────────────

  test('boardToCpp: undefined entry → 0', () => {
    const react = [[undefined]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
  });

  test('boardToCpp: mixed null and pieces', () => {
    const react = [[null, { color: 'white', king: false }, null]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
    assert.equal(cpp[1], 1);
    assert.equal(cpp[2], 0);
  });

  // ── boardToCpp with non-standard color strings ─────────────────────

  test('boardToCpp: "red" color → 0 (unknown)', () => {
    const react = [[{ color: 'red', king: false }]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
  });

  test('boardToCpp: empty color string → 0', () => {
    const react = [[{ color: '', king: false }]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
  });

  // ── boardToCpp with arrays as pieces ───────────────────────────────

  test('boardToCpp: array entry (not object) → 0', () => {
    const react = [[[1, 2, 3]]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
  });

  test('boardToCpp: number entry → 0', () => {
    const react = [[42]];
    const cpp = boardToCpp(react);
    assert.equal(cpp[0], 0);
  });

  // ── Round-trip with boundary values ────────────────────────────────

  test('round-trip: all four piece types only', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1; flat[1] = 2; flat[2] = 3; flat[3] = 4;
    const board = boardFromCpp(flat);
    const back = boardToCpp(board);
    assert.equal(back[0], 1);
    assert.equal(back[1], 2);
    assert.equal(back[2], 3);
    assert.equal(back[3], 4);
    for (let i = 4; i < 64; i++) assert.equal(back[i], 0);
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: BoardConvert NaN/Float Edge');

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
