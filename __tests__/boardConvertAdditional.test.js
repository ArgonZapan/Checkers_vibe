/**
 * boardConvertAdditional.test.js — Additional boardToCpp / boardFromCpp edge cases.
 *
 * Covers gaps not in boardConvert.test.js, boardConvertEdge.test.js, boardConvertInvalid.test.js:
 * - boardToCpp with null/undefined elements in array
 * - boardToCpp with non-standard piece objects (wrong types)
 * - boardFromCpp value 3 = black pawn detail, value 5+ unknown
 * - Array holes, sparse arrays
 */

import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../server/boardConvert.js';

export async function runBoardConvertAdditionalTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp: null/undefined elements in board array
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: row with null element → 0', () => {
    const result = boardToCpp([[null]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: row with undefined element → 0', () => {
    const result = boardToCpp([[undefined]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: mixed row [null, {white pawn}, undefined] → [0, 1, 0]', () => {
    const result = boardToCpp([[null, { color: 'white', king: false }, undefined]]);
    assert.deepEqual(result, [0, 1, 0]);
  });

  test('boardToCpp: false as cell → 0 (falsy)', () => {
    const result = boardToCpp([[false]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: 0 as cell → 0 (falsy)', () => {
    const result = boardToCpp([[0]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: empty string as cell → 0 (falsy)', () => {
    const result = boardToCpp([['']]);
    assert.equal(result[0], 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardToCpp: non-standard piece objects
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: king = "yes" (truthy string) → treated as king', () => {
    const result = boardToCpp([[{ color: 'white', king: 'yes' }]]);
    // p.color === 'white' → true, p.king is truthy → 2
    assert.equal(result[0], 2);
  });

  test('boardToCpp: king = 1 (truthy number) → treated as king', () => {
    const result = boardToCpp([[{ color: 'black', king: 1 }]]);
    // p.color !== 'white' → black, p.king truthy → 4
    assert.equal(result[0], 4);
  });

  test('boardToCpp: king = 0 (falsy) → treated as pawn', () => {
    const result = boardToCpp([[{ color: 'white', king: 0 }]]);
    assert.equal(result[0], 1);
  });

  test('boardToCpp: king = "" (falsy) → treated as pawn', () => {
    const result = boardToCpp([[{ color: 'black', king: '' }]]);
    assert.equal(result[0], 3);
  });

  test('boardToCpp: color = "WHITE" (uppercase) → returns 0 (not recognized)', () => {
    const result = boardToCpp([[{ color: 'WHITE', king: false }]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: color = "Black" → returns 0 (case-sensitive, not "black")', () => {
    const result = boardToCpp([[{ color: 'Black', king: false }]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: color = 1 (number) → returns 0 (not "white" or "black")', () => {
    const result = boardToCpp([[{ color: 1, king: false }]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: color = true → returns 0 (not "white" or "black")', () => {
    const result = boardToCpp([[{ color: true, king: false }]]);
    assert.equal(result[0], 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp: value 3 = black pawn (explicit check)
  // ═══════════════════════════════════════════════════════════════════════

  test('boardFromCpp: value 3 → { color: "black", king: false }', () => {
    const board = boardFromCpp([[3]]);
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardFromCpp: value 5 → { color: "black", king: false } (unknown maps as black pawn)', () => {
    const board = boardFromCpp([[5]]);
    // val !== 0, val !== 1, val !== 2 → not white → black
    // val !== 2, val !== 4 → not king → pawn
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardFromCpp: value 10 → { color: "black", king: false }', () => {
    const board = boardFromCpp([[10]]);
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardFromCpp: value 100 → { color: "black", king: false }', () => {
    const board = boardFromCpp([[100]]);
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // boardFromCpp / boardToCpp: sparse / unusual arrays
  // ═══════════════════════════════════════════════════════════════════════

  test('boardToCpp: board with single row of 8 nulls → [0,0,0,0,0,0,0,0]', () => {
    const result = boardToCpp([[null, null, null, null, null, null, null, null]]);
    assert.deepEqual(result, [0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('boardFromCpp: flat array with exactly 8 elements → 1 row', () => {
    const flat = [1, 0, 3, 0, 1, 0, 3, 0];
    const board = boardFromCpp(flat);
    assert.equal(board.length, 8);
    assert.equal(board[0].length, 8);
    assert.deepEqual(board[0][0], { color: 'white', king: false });
    assert.equal(board[0][1], null);
    assert.deepEqual(board[0][2], { color: 'black', king: false });
  });

  test('boardToCpp: round-trip with value 5 (unknown) through boardFromCpp', () => {
    // value 5 → boardFromCpp → {black, pawn} → boardToCpp → 3 (not 5!)
    const original = [[5]];
    const react = boardFromCpp(original);
    const back = boardToCpp(react);
    // 5 is unknown, maps to black pawn (3) — NOT identity
    assert.deepEqual(back, [3]);
  });

  test('boardToCpp: object with color=null → returns 0 (not "white" or "black")', () => {
    // p exists (truthy), p.color is null, null !== 'white' and null !== 'black' → 0
    const result = boardToCpp([[{ color: null, king: false }]]);
    assert.equal(result[0], 0);
  });

  test('boardToCpp: object with king=null → falsy → pawn', () => {
    const result = boardToCpp([[{ color: 'white', king: null }]]);
    assert.equal(result[0], 1);
  });

  test('boardToCpp: object with king=undefined → falsy → pawn', () => {
    const result = boardToCpp([[{ color: 'black', king: undefined }]]);
    assert.equal(result[0], 3);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Board Convert Additional Edge Cases');

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
