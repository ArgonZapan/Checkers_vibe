/**
 * isHumanPieceLogic.test.js — Tests for the isHumanPiece logic in handleCellClick.
 *
 * Covers the client/src/App.jsx handleCellClick decision logic:
 * - PvAI: human can only select white pieces on white's turn
 * - PvAI: clicking black piece does nothing (AI controls black)
 * - PvAI: clicking during AI turn (black's turn) does nothing
 * - PvP: either color can be selected on their turn
 * - aivai: all clicks ignored
 * - gameOver: all clicks ignored
 * - Selected piece → legal move check → move dispatch
 * - Click on non-legal square → deselect
 *
 * Extracted logic — no React required.
 */

import assert from 'node:assert/strict';

// ── Extracted: handleCellClick decision logic (mirrors client/src/App.jsx) ──

/**
 * Determine if a piece can be selected by the human player.
 * Returns { canSelect: boolean, action: string }.
 */
function evaluateCellClick(row, col, state) {
  const { board, turn, gameOver, mode, selected, legalMoves } = state;

  // Game over → ignore
  if (gameOver) return { canSelect: false, action: 'ignore', reason: 'gameOver' };

  // aivai → ignore (spectator mode)
  if (mode === 'aivai') return { canSelect: false, action: 'ignore', reason: 'aivai' };

  const piece = board[row]?.[col];

  // If a piece is already selected, check if clicking a legal move target
  if (selected) {
    const isLegal = legalMoves.some(
      (m) => m.to[0] === row && m.to[1] === col
    );
    if (isLegal) {
      const matchingMove = legalMoves.find(m => m.to[0] === row && m.to[1] === col);
      return {
        canSelect: false,
        action: 'move',
        move: { from: selected, to: [row, col], captures: matchingMove?.captures },
      };
    }
    // Clicked on non-legal square → deselect
    return { canSelect: false, action: 'deselect' };
  }

  // isHumanPiece check
  const isHumanPiece = mode === 'pvai'
    ? piece && piece.color === 'white' && turn === 'white'
    : piece && piece.color === turn;

  if (isHumanPiece) {
    return { canSelect: true, action: 'select', coord: [row, col] };
  }

  return { canSelect: false, action: 'deselect' };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runIsHumanPieceLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Helper: standard board with pieces ─────────────────────────────

  function makeBoard() {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    // White pieces on rows 0-2
    board[0][1] = { color: 'white', king: false };
    board[2][3] = { color: 'white', king: false };
    board[2][5] = { color: 'white', king: true };
    // Black pieces on rows 5-7
    board[5][0] = { color: 'black', king: false };
    board[7][2] = { color: 'black', king: false };
    return board;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PvAI mode — isHumanPiece
  // ═══════════════════════════════════════════════════════════════════════

  test('PvAI white turn: clicking white piece → select', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'select');
    assert.deepEqual(r.coord, [0, 1]);
  });

  test('PvAI white turn: clicking black piece → deselect (AI piece)', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'deselect');
    assert.equal(r.canSelect, false);
  });

  test('PvAI black turn: clicking white piece → deselect (AI turn)', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'deselect');
    assert.equal(r.canSelect, false);
  });

  test('PvAI black turn: clicking black piece → deselect (AI controls black)', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'deselect');
    assert.equal(r.canSelect, false);
  });

  test('PvAI: clicking empty square → deselect', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(3, 3, state);
    assert.equal(r.action, 'deselect');
  });

  test('PvAI: white king can be selected on white turn', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(2, 5, state);
    assert.equal(r.action, 'select');
  });

  test('PvAI: white king CANNOT be selected on black turn', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(2, 5, state);
    assert.equal(r.action, 'deselect');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PvP mode — isHumanPiece
  // ═══════════════════════════════════════════════════════════════════════

  test('PvP white turn: clicking white piece → select', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvp', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'select');
  });

  test('PvP white turn: clicking black piece → deselect (not their turn)', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvp', selected: null, legalMoves: [] };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'deselect');
  });

  test('PvP black turn: clicking black piece → select', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: false, mode: 'pvp', selected: null, legalMoves: [] };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'select');
  });

  test('PvP black turn: clicking white piece → deselect', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: false, mode: 'pvp', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'deselect');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // aivai mode — all clicks ignored
  // ═══════════════════════════════════════════════════════════════════════

  test('aivai: clicking any piece → ignore', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'aivai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'ignore');
    assert.equal(r.reason, 'aivai');
  });

  test('aivai: clicking empty square → ignore', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'aivai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(3, 3, state);
    assert.equal(r.action, 'ignore');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Game over — all clicks ignored
  // ═══════════════════════════════════════════════════════════════════════

  test('gameOver PvAI: clicking piece → ignore', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: true, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'ignore');
    assert.equal(r.reason, 'gameOver');
  });

  test('gameOver PvP: clicking piece → ignore', () => {
    const board = makeBoard();
    const state = { board, turn: 'black', gameOver: true, mode: 'pvp', selected: null, legalMoves: [] };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'ignore');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Selected piece → legal move → move dispatch
  // ═══════════════════════════════════════════════════════════════════════

  test('selected piece + legal move target → move action', () => {
    const board = makeBoard();
    const legalMoves = [
      { from: [0, 1], to: [1, 2], captures: [] },
      { from: [0, 1], to: [1, 0], captures: [] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: [0, 1], legalMoves };
    const r = evaluateCellClick(1, 2, state);
    assert.equal(r.action, 'move');
    assert.deepEqual(r.move.from, [0, 1]);
    assert.deepEqual(r.move.to, [1, 2]);
  });

  test('selected piece + capture move → move action with captures', () => {
    const board = makeBoard();
    board[1][2] = { color: 'black', king: false }; // piece to capture
    const legalMoves = [
      { from: [0, 1], to: [2, 3], captures: [[1, 2]] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: [0, 1], legalMoves };
    const r = evaluateCellClick(2, 3, state);
    assert.equal(r.action, 'move');
    assert.deepEqual(r.move.captures, [[1, 2]]);
  });

  test('selected piece + non-legal square → deselect', () => {
    const board = makeBoard();
    const legalMoves = [
      { from: [0, 1], to: [1, 2], captures: [] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: [0, 1], legalMoves };
    const r = evaluateCellClick(3, 3, state);
    assert.equal(r.action, 'deselect');
  });

  test('selected piece + clicking same piece → deselect', () => {
    const board = makeBoard();
    const legalMoves = [
      { from: [0, 1], to: [1, 2], captures: [] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: [0, 1], legalMoves };
    // Clicking same piece is not a legal move target → deselect
    const r = evaluateCellClick(0, 1, state);
    assert.equal(r.action, 'deselect');
  });

  test('selected piece + clicking opponent piece (not in legal moves) → deselect', () => {
    const board = makeBoard();
    const legalMoves = [
      { from: [0, 1], to: [1, 2], captures: [] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: [0, 1], legalMoves };
    const r = evaluateCellClick(5, 0, state);
    assert.equal(r.action, 'deselect');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('PvAI: null piece at location → deselect', () => {
    const board = makeBoard();
    const state = { board, turn: 'white', gameOver: false, mode: 'pvai', selected: null, legalMoves: [] };
    const r = evaluateCellClick(4, 4, state); // empty square
    assert.equal(r.action, 'deselect');
    assert.equal(r.canSelect, false);
  });

  test('PvP: multi-capture move dispatches with all captures', () => {
    const board = makeBoard();
    const legalMoves = [
      { from: [2, 3], to: [6, 7], captures: [[3, 4], [5, 6]] },
    ];
    const state = { board, turn: 'white', gameOver: false, mode: 'pvp', selected: [2, 3], legalMoves };
    const r = evaluateCellClick(6, 7, state);
    assert.equal(r.action, 'move');
    assert.equal(r.move.captures.length, 2);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 isHumanPiece Logic Tests');

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
