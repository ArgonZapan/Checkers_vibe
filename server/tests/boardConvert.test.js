import assert from 'node:assert/strict';
import { boardFromCpp, boardToCpp } from '../boardConvert.js';
import { describe, it } from '@jest/globals';

describe('boardConvert', () => {

  // ── boardFromCpp ───────────────────────────────────────────────────────

  describe('boardFromCpp', () => {

    it('converts flat array with all piece types', () => {
      const flat = new Array(64).fill(0);
      flat[0] = 1;   // white pawn
      flat[1] = 2;   // white king
      flat[2] = 3;   // black pawn
      flat[3] = 4;   // black king
      const result = boardFromCpp(flat);
      assert.equal(result.length, 8);
      assert.equal(result[0].length, 8);
      assert.deepEqual(result[0][0], { color: 'white', king: false });
      assert.deepEqual(result[0][1], { color: 'white', king: true });
      assert.deepEqual(result[0][2], { color: 'black', king: false });
      assert.deepEqual(result[0][3], { color: 'black', king: true });
      assert.equal(result[0][4], null);
    });

    it('converts 2D array', () => {
      const board2D = Array.from({ length: 8 }, () => Array(8).fill(0));
      board2D[7][7] = 2; // white king at bottom-right
      const result = boardFromCpp(board2D);
      assert.deepEqual(result[7][7], { color: 'white', king: true });
    });

    it('returns empty board for null input', () => {
      const result = boardFromCpp(null);
      assert.equal(result.length, 8);
      assert.equal(result[0][0], null);
    });

    it('returns empty board for undefined input', () => {
      const result = boardFromCpp(undefined);
      assert.equal(result[0][0], null);
    });

    it('returns empty board for non-array input', () => {
      const result = boardFromCpp('not-an-array');
      assert.equal(result[0][0], null);
    });

    it('returns empty board for empty array', () => {
      const result = boardFromCpp([]);
      assert.equal(result[0][0], null);
    });

    it('returns empty board for flat array with wrong length', () => {
      const result = boardFromCpp([1, 2, 3]);
      assert.equal(result[0][0], null);
    });

    it('returns empty board for 2D array with wrong number of rows', () => {
      const result = boardFromCpp([[0, 0], [0, 0]]);
      assert.equal(result[0][0], null);
    });

    it('returns empty board for 2D array with wrong column count', () => {
      const bad = Array.from({ length: 8 }, () => [0, 0]);
      const result = boardFromCpp(bad);
      assert.equal(result[0][0], null);
    });

    it('treats out-of-range values as null', () => {
      const flat = new Array(64).fill(0);
      flat[0] = 99;
      flat[1] = -5;
      const result = boardFromCpp(flat);
      assert.equal(result[0][0], null);
      assert.equal(result[0][1], null);
    });

    it('treats NaN values as null', () => {
      const flat = new Array(64).fill(0);
      flat[0] = NaN;
      const result = boardFromCpp(flat);
      assert.equal(result[0][0], null);
    });

    it('handles mixed flat array correctly', () => {
      const flat = new Array(64).fill(0);
      // White pawns on row 1
      for (let i = 8; i < 16; i++) flat[i] = 1;
      // Black pawns on row 6
      for (let i = 48; i < 56; i++) flat[i] = 3;
      const result = boardFromCpp(flat);
      for (let c = 0; c < 8; c++) {
        assert.deepEqual(result[1][c], { color: 'white', king: false });
        assert.deepEqual(result[6][c], { color: 'black', king: false });
      }
      assert.equal(result[0][0], null);
      assert.equal(result[7][0], null);
    });
  });

  // ── boardToCpp ─────────────────────────────────────────────────────────

  describe('boardToCpp', () => {

    it('converts all piece types to correct integers', () => {
      const board = Array.from({ length: 8 }, () => Array(8).fill(null));
      board[0][0] = { color: 'white', king: false }; // → 1
      board[0][1] = { color: 'white', king: true };  // → 2
      board[0][2] = { color: 'black', king: false }; // → 3
      board[0][3] = { color: 'black', king: true };  // → 4
      const flat = boardToCpp(board);
      assert.equal(flat.length, 64);
      assert.equal(flat[0], 1);
      assert.equal(flat[1], 2);
      assert.equal(flat[2], 3);
      assert.equal(flat[3], 4);
      assert.equal(flat[4], 0);
    });

    it('returns all zeros for null input', () => {
      const flat = boardToCpp(null);
      assert.equal(flat.length, 64);
      assert.ok(flat.every(v => v === 0));
    });

    it('returns all zeros for undefined input', () => {
      const flat = boardToCpp(undefined);
      assert.ok(flat.every(v => v === 0));
    });

    it('round-trips boardFromCpp → boardToCpp', () => {
      const original = new Array(64).fill(0);
      original[0] = 1; original[9] = 2; original[18] = 3; original[27] = 4;
      const reactBoard = boardFromCpp(original);
      const backToCpp = boardToCpp(reactBoard);
      assert.deepEqual(backToCpp, original);
    });

    it('handles empty board round-trip', () => {
      const empty = new Array(64).fill(0);
      const react = boardFromCpp(empty);
      const back = boardToCpp(react);
      assert.deepEqual(back, empty);
    });

    it('treats non-object entries as empty', () => {
      const board = Array.from({ length: 8 }, () => Array(8).fill(null));
      board[0][0] = 'string';
      board[0][1] = 42;
      board[0][2] = [1, 2];
      const flat = boardToCpp(board);
      assert.equal(flat[0], 0);
      assert.equal(flat[1], 0);
      assert.equal(flat[2], 0);
    });

    it('treats unrecognized color as empty', () => {
      const board = Array.from({ length: 8 }, () => Array(8).fill(null));
      board[0][0] = { color: 'green', king: false };
      const flat = boardToCpp(board);
      assert.equal(flat[0], 0);
    });

    it('pads short boards to 64 elements', () => {
      const board = [[{ color: 'white', king: false }]]; // only 1 element
      const flat = boardToCpp(board);
      assert.equal(flat.length, 64);
      assert.equal(flat[0], 1);
      assert.equal(flat[1], 0);
    });

    it('truncates oversized boards to 64 elements', () => {
      // Create a board that flattens to more than 64
      const board = Array.from({ length: 10 }, () => Array(10).fill({ color: 'white', king: false }));
      const flat = boardToCpp(board);
      assert.equal(flat.length, 64);
    });
  });
});
