/**
 * handleMoveFlow.test.js — Tests for the handleMove orchestration flow.
 *
 * Covers the full move handling pipeline from server/index.js:
 * - PvAI: emits player state first, waits for animation, then AI moves
 * - PvP: broadcasts state to all clients
 * - PvAI: emits only to requesting socket
 * - Game over: emits gameOver event with winner
 * - aivai game over: restarts self-play after delay
 * - pvai game over: does NOT restart self-play
 * - Animation delay calculation from path length
 * - Move body includes captures when present
 *
 * Extracted logic — no server, engine, or TF.js required.
 */

import assert from 'node:assert/strict';

// ── Extracted: handleMove orchestration logic (mirrors server/index.js) ─────

/**
 * Simulate the handleMove flow decisions.
 * Returns a log of what would be emitted/executed.
 */
function simulateHandleMove(socket, moveData, gameStateAfterPlayerMove, aiStateAfterAiMove, config) {
  const log = [];
  const { from, to, captures } = moveData;
  const isPvAI = socket.gameMode === 'pvai';
  const isPvP = socket.gameMode === 'pvp';
  const isAivai = socket.gameMode === 'aivai';

  // 1. Build move body
  const moveBody = { from, to };
  if (captures && captures.length > 0) moveBody.captures = captures;
  log.push({ action: 'cppFetchMove', body: moveBody });

  // 2. State after player move
  let state = { ...gameStateAfterPlayerMove };
  const moveCaptures = captures || [];
  const playerPath = gameStateAfterPlayerMove.path || null;

  // 3. If PvAI and game not over → emit player state, wait for animation, then AI moves
  if (isPvAI && !state.gameOver) {
    const playerPayload = {
      ...state,
      lastMove: { from, to, captures: moveCaptures },
      path: playerPath,
    };
    log.push({ action: 'emit', event: 'state', target: 'socket', payload: playerPayload });

    // Animation delay
    const animStepMs = config.animationStepDurationMs;
    const animDelay = (playerPath && playerPath.length > 2)
      ? playerPath.length * animStepMs + config.moveDelayMs
      : config.moveDelayMs;
    log.push({ action: 'sleep', ms: animDelay });
    log.push({ action: 'aiMove' });

    // After AI move, state changes
    if (aiStateAfterAiMove) {
      state = { ...aiStateAfterAiMove };
    }
  }

  // 4. Emit final state
  const statePayload = {
    ...state,
    lastMove: state.lastMove || { from, to, captures: moveCaptures },
  };
  if (isPvP) {
    log.push({ action: 'io.emit', event: 'state', payload: statePayload });
  } else {
    log.push({ action: 'socket.emit', event: 'state', payload: statePayload });
  }

  // 5. Game over handling
  if (state.gameOver) {
    log.push({ action: 'io.emit', event: 'gameOver', payload: { winner: state.winner, moves: 0 } });
    if (isAivai) {
      log.push({ action: 'setTimeout', delay: 3000, callback: 'trainer.start()' });
    }
  }

  return log;
}

/**
 * Calculate animation delay (extracted from handleMove).
 */
function calcAnimationDelay(playerPath, animStepMs, moveDelayMs) {
  if (playerPath && playerPath.length > 2) {
    return playerPath.length * animStepMs + moveDelayMs;
  }
  return moveDelayMs;
}

/**
 * Build move body for C++ API (extracted from handleMove and aiMove).
 */
function buildMoveBody(from, to, captures) {
  const body = { from, to };
  if (captures && captures.length > 0) body.captures = captures;
  return body;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runHandleMoveFlowTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  const CONFIG = {
    moveDelayMs: 100,
    animationStepDurationMs: 50,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // PvAI flow — emit player state first, then AI, then final state
  // ═══════════════════════════════════════════════════════════════════════

  test('handleMove PvAI: emits player state before AI move', () => {
    const socket = { gameMode: 'pvai' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const playerState = { board: [], turn: 'black', gameOver: false, winner: null, path: [[2,1],[3,2]] };
    const aiState = { board: [], turn: 'white', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, playerState, aiState, CONFIG);
    const stateEmits = log.filter(l => l.action === 'emit' && l.event === 'state');
    const aiMoves = log.filter(l => l.action === 'aiMove');

    // Player state emitted first
    assert.equal(stateEmits.length, 1, 'should emit player state');
    assert.equal(stateEmits[0].target, 'socket', 'should emit to socket only');
    assert.equal(aiMoves.length, 1, 'should call aiMove');
    // AI move happens after player state emit
    const aiIdx = log.findIndex(l => l.action === 'aiMove');
    const emitIdx = log.findIndex(l => l.action === 'emit' && l.event === 'state');
    assert.ok(aiIdx > emitIdx, 'AI move should happen after player state emit');
  });

  test('handleMove PvAI: emits final state to socket (not io.emit)', () => {
    const socket = { gameMode: 'pvai' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const playerState = { board: [], turn: 'black', gameOver: false, winner: null, path: [[2,1],[3,2]] };
    const aiState = { board: [], turn: 'white', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, playerState, aiState, CONFIG);
    const finalStates = log.filter(l => l.action === 'socket.emit' && l.event === 'state');
    const ioStates = log.filter(l => l.action === 'io.emit' && l.event === 'state');

    assert.equal(finalStates.length, 1, 'should emit final state via socket.emit');
    assert.equal(ioStates.length, 0, 'should NOT broadcast via io.emit in PvAI');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PvP flow — broadcasts to all clients
  // ═══════════════════════════════════════════════════════════════════════

  test('handleMove PvP: broadcasts state to all via io.emit', () => {
    const socket = { gameMode: 'pvp' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'black', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const ioStates = log.filter(l => l.action === 'io.emit' && l.event === 'state');

    assert.equal(ioStates.length, 1, 'should broadcast via io.emit in PvP');
  });

  test('handleMove PvP: does NOT call aiMove', () => {
    const socket = { gameMode: 'pvp' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'black', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const aiMoves = log.filter(l => l.action === 'aiMove');
    assert.equal(aiMoves.length, 0, 'should NOT call aiMove in PvP');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Animation delay calculation
  // ═══════════════════════════════════════════════════════════════════════

  test('animation delay: short path (≤2) uses moveDelayMs only', () => {
    const delay = calcAnimationDelay([[2,1],[3,2]], 50, 100);
    assert.equal(delay, 100);
  });

  test('animation delay: path with 3 steps uses path.length * stepMs + delayMs', () => {
    const path = [[2,1],[3,2],[4,3]];
    const delay = calcAnimationDelay(path, 50, 100);
    assert.equal(delay, 3 * 50 + 100); // 250
  });

  test('animation delay: long capture path scales linearly', () => {
    const path = [[2,1],[3,2],[4,3],[5,4],[6,5],[7,6]]; // 6 steps
    const delay = calcAnimationDelay(path, 50, 100);
    assert.equal(delay, 6 * 50 + 100); // 400
  });

  test('animation delay: null path falls back to moveDelayMs', () => {
    const delay = calcAnimationDelay(null, 50, 100);
    assert.equal(delay, 100);
  });

  test('animation delay: empty path falls back to moveDelayMs', () => {
    const delay = calcAnimationDelay([], 50, 100);
    assert.equal(delay, 100);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Game over handling
  // ═══════════════════════════════════════════════════════════════════════

  test('handleMove: game over emits gameOver event with winner', () => {
    const socket = { gameMode: 'pvp' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'white', gameOver: true, winner: 'white' };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const gameOverEvents = log.filter(l => l.event === 'gameOver');
    assert.equal(gameOverEvents.length, 1);
    assert.equal(gameOverEvents[0].payload.winner, 'white');
  });

  test('handleMove aivai: game over restarts trainer via setTimeout', () => {
    const socket = { gameMode: 'aivai' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'white', gameOver: true, winner: 'white' };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const timeouts = log.filter(l => l.action === 'setTimeout');
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].callback, 'trainer.start()');
    assert.equal(timeouts[0].delay, 3000);
  });

  test('handleMove pvai: game over does NOT restart trainer', () => {
    const socket = { gameMode: 'pvai' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'white', gameOver: true, winner: 'white' };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const timeouts = log.filter(l => l.action === 'setTimeout');
    assert.equal(timeouts.length, 0, 'pvai game over should NOT restart trainer');
  });

  test('handleMove pvp: game over does NOT restart trainer', () => {
    const socket = { gameMode: 'pvp' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const state = { board: [], turn: 'white', gameOver: true, winner: 'white' };

    const log = simulateHandleMove(socket, moveData, state, null, CONFIG);
    const timeouts = log.filter(l => l.action === 'setTimeout');
    assert.equal(timeouts.length, 0, 'pvp game over should NOT restart trainer');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Move body with captures
  // ═══════════════════════════════════════════════════════════════════════

  test('buildMoveBody: includes captures array when present', () => {
    const body = buildMoveBody([2,1], [4,3], [[3,2]]);
    assert.deepEqual(body.from, [2,1]);
    assert.deepEqual(body.to, [4,3]);
    assert.deepEqual(body.captures, [[3,2]]);
  });

  test('buildMoveBody: omits captures when empty', () => {
    const body = buildMoveBody([2,1], [3,2], []);
    assert.equal(body.captures, undefined, 'empty captures should not be in body');
  });

  test('buildMoveBody: omits captures when null', () => {
    const body = buildMoveBody([2,1], [3,2], null);
    assert.equal(body.captures, undefined);
  });

  test('buildMoveBody: multi-capture move includes all captures', () => {
    const captures = [[3,2],[5,4]];
    const body = buildMoveBody([2,1], [6,5], captures);
    assert.deepEqual(body.captures, [[3,2],[5,4]]);
    assert.equal(body.captures.length, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PvAI game not over → only player state emitted (no game over)
  // ═══════════════════════════════════════════════════════════════════════

  test('handleMove PvAI: game not over → no gameOver event', () => {
    const socket = { gameMode: 'pvai' };
    const moveData = { from: [2, 1], to: [3, 2], captures: [] };
    const playerState = { board: [], turn: 'black', gameOver: false, winner: null, path: [[2,1],[3,2]] };
    const aiState = { board: [], turn: 'white', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, playerState, aiState, CONFIG);
    const gameOverEvents = log.filter(l => l.event === 'gameOver');
    assert.equal(gameOverEvents.length, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PvAI with captures in player move
  // ═══════════════════════════════════════════════════════════════════════

  test('handleMove PvAI: player capture move includes captures in lastMove', () => {
    const socket = { gameMode: 'pvai' };
    const moveData = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    const playerState = { board: [], turn: 'black', gameOver: false, winner: null, path: [[2,1],[4,3]] };
    const aiState = { board: [], turn: 'white', gameOver: false, winner: null };

    const log = simulateHandleMove(socket, moveData, playerState, aiState, CONFIG);
    const playerEmit = log.find(l => l.action === 'emit' && l.event === 'state');
    assert.deepEqual(playerEmit.payload.lastMove.captures, [[3, 2]]);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Handle Move Flow Tests');

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
