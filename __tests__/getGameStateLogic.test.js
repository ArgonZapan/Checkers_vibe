/**
 * getGameStateLogic.test.js — Tests for getGameState result assembly logic.
 *
 * Covers: how getGameState combines C++ responses into client-friendly format,
 * including turn conversion fallbacks, move mapping, and gameOver/winner handling.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';
import { boardFromCpp } from '../server/boardConvert.js';

// ── Extracted: turnToColor (mirrors server/index.js) ────────────────────────

function turnToColor(turn) {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return null; // 0 = draw/no turn — don't misleadingly return 'white'
}

// ── Extracted: move mapping logic (mirrors getGameState) ────────────────────

function mapLegalMoves(legalMoves) {
  return (legalMoves || []).map(m => ({
    from: m.from,
    to: m.to,
    captures: m.captures || [],
    index: m.index,
  }));
}

// ── Extracted: state assembly (mirrors getGameState) ────────────────────────

function assembleGameState(cppState, cppLegalMoves) {
  const board = boardFromCpp(cppState.board);
  const moves = mapLegalMoves(cppLegalMoves);
  return {
    board,
    turn: turnToColor(cppState.turn ?? cppState.currentTurn ?? 1),
    legalMoves: moves,
    gameOver: cppState.gameOver ?? false,
    winner: cppState.winner != null ? turnToColor(cppState.winner) : null,
    lastMove: cppState.lastMove || null,
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runGetGameStateLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Turn conversion in state assembly
  // ═══════════════════════════════════════════════════════════════════════

  test('state turn=1 becomes "white"', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), turn: 1 },
      []
    );
    assert.equal(state.turn, 'white');
  });

  test('state turn=-1 becomes "black"', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), turn: -1 },
      []
    );
    assert.equal(state.turn, 'black');
  });

  test('state with currentTurn (fallback field)', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), currentTurn: -1 },
      []
    );
    assert.equal(state.turn, 'black');
  });

  test('state with string turn (C++ engine format) passes through', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), turn: 'white' },
      []
    );
    assert.equal(state.turn, 'white');
  });

  test('state without turn or currentTurn defaults to "white"', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      []
    );
    assert.equal(state.turn, 'white');
  });

  test('state turn=0 returns null (draw state — no misleading turn)', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), turn: 0, gameOver: true },
      []
    );
    assert.equal(state.turn, null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Game over / winner
  // ═══════════════════════════════════════════════════════════════════════

  test('gameOver defaults to false', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      []
    );
    assert.equal(state.gameOver, false);
  });

  test('gameOver=true is preserved', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: true },
      []
    );
    assert.equal(state.gameOver, true);
  });

  test('winner=null when no winner', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: false },
      []
    );
    assert.equal(state.winner, null);
  });

  test('winner=1 becomes "white"', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: true, winner: 1 },
      []
    );
    assert.equal(state.winner, 'white');
  });

  test('winner=-1 becomes "black"', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: true, winner: -1 },
      []
    );
    assert.equal(state.winner, 'black');
  });

  test('winner=0 (draw) → turnToColor returns null (no misleading color)', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: true, winner: 0 },
      []
    );
    assert.equal(state.winner, null);
  });

  test('winner as string passes through', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), gameOver: true, winner: 'draw' },
      []
    );
    assert.equal(state.winner, 'draw');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Legal moves mapping
  // ═══════════════════════════════════════════════════════════════════════

  test('legalMoves: null input becomes empty array', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      null
    );
    assert.deepEqual(state.legalMoves, []);
  });

  test('legalMoves: undefined input becomes empty array', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      undefined
    );
    assert.deepEqual(state.legalMoves, []);
  });

  test('legalMoves: maps from, to, captures, index', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      [{ from: [2, 1], to: [3, 0], captures: [[2, 5]], index: 7 }]
    );
    assert.equal(state.legalMoves.length, 1);
    assert.deepEqual(state.legalMoves[0].from, [2, 1]);
    assert.deepEqual(state.legalMoves[0].to, [3, 0]);
    assert.deepEqual(state.legalMoves[0].captures, [[2, 5]]);
    assert.equal(state.legalMoves[0].index, 7);
  });

  test('legalMoves: missing captures defaults to empty array', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      [{ from: [2, 1], to: [3, 0] }]
    );
    assert.deepEqual(state.legalMoves[0].captures, []);
  });

  test('legalMoves: missing index is undefined (not 0)', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      [{ from: [2, 1], to: [3, 0] }]
    );
    assert.equal(state.legalMoves[0].index, undefined);
  });

  test('legalMoves: empty array stays empty', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      []
    );
    assert.deepEqual(state.legalMoves, []);
  });

  test('legalMoves: multiple moves preserved', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      [
        { from: [2, 1], to: [3, 0], index: 0 },
        { from: [2, 1], to: [3, 2], index: 1 },
        { from: [2, 3], to: [3, 4], index: 2 },
      ]
    );
    assert.equal(state.legalMoves.length, 3);
    assert.deepEqual(state.legalMoves[1].from, [2, 1]);
    assert.deepEqual(state.legalMoves[1].to, [3, 2]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // lastMove handling
  // ═══════════════════════════════════════════════════════════════════════

  test('lastMove: null when not provided', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      []
    );
    assert.equal(state.lastMove, null);
  });

  test('lastMove: preserved when provided', () => {
    const lastMove = { from: [2, 1], to: [3, 0], captures: [[2, 5]] };
    const state = assembleGameState(
      { board: new Array(64).fill(0), lastMove },
      []
    );
    assert.deepEqual(state.lastMove, lastMove);
  });

  test('lastMove: empty object is truthy (preserved)', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), lastMove: {} },
      []
    );
    assert.deepEqual(state.lastMove, {});
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Board conversion within state assembly
  // ═══════════════════════════════════════════════════════════════════════

  test('board: empty board converts to 8x8 null grid', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0) },
      []
    );
    assert.equal(state.board.length, 8);
    assert.equal(state.board[0].length, 8);
    assert.equal(state.board[0][0], null);
  });

  test('board: piece at corner converts correctly', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1; // white pawn
    flat[63] = 4; // black king
    const state = assembleGameState({ board: flat }, []);
    assert.deepEqual(state.board[0][0], { color: 'white', king: false });
    assert.deepEqual(state.board[7][7], { color: 'black', king: true });
  });

  test('state has all expected keys', () => {
    const state = assembleGameState(
      { board: new Array(64).fill(0), turn: 1 },
      []
    );
    const expected = ['board', 'turn', 'legalMoves', 'gameOver', 'winner', 'lastMove'];
    for (const key of expected) {
      assert.ok(key in state, `Missing key: ${key}`);
    }
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 getGameState Logic Tests');

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
