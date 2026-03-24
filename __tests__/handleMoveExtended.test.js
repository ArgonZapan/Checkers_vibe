/**
 * handleMoveExtended.test.js — Extended tests for handleMove edge cases.
 *
 * Covers additional scenarios not in handleMoveFlow.test.js:
 * - PvAI: game over during player move (before AI gets to play)
 * - PvAI: aiMove after player move but AI state shows game over
 * - Move body with null captures vs empty captures
 * - PvP: game over after single move
 * - aivai: game over restarts self-play with correct delay
 * - handleMove error recovery: C++ fetch fails mid-flow
 * - Animation delay edge cases (stepMs=0, delayMs=0)
 * - lastMove payload structure verification
 * - Multiple captures in one move
 *
 * Extracted logic — no server, engine, or TF.js required.
 */

import assert from 'node:assert/strict';

// ── Extracted: extended handleMove logic ────────────────────────────────────

/**
 * Build the state payload emitted to clients after a move.
 */
function buildStatePayload(state, from, to, moveCaptures) {
  return {
    ...state,
    lastMove: state.lastMove || { from, to, captures: moveCaptures },
  };
}

/**
 * Determine which emit strategy to use based on game mode.
 */
function getEmitStrategy(gameMode) {
  if (gameMode === 'pvp') return { type: 'broadcast', method: 'io.emit' };
  return { type: 'unicast', method: 'socket.emit' };
}

/**
 * Determine if game over should trigger trainer restart.
 */
function shouldRestartTrainer(gameMode) {
  return gameMode === 'aivai';
}

/**
 * Calculate total animation time for a move.
 */
function calcTotalAnimTime(path, stepMs, baseDelayMs) {
  if (path && path.length > 2) {
    return path.length * stepMs + baseDelayMs;
  }
  return baseDelayMs;
}

/**
 * Validate move body for C++ API.
 */
function buildCppMoveBody(from, to, captures) {
  const body = { from, to };
  if (captures && captures.length > 0) body.captures = captures;
  return body;
}

/**
 * Simulate full handleMove with error injection.
 */
function simulateHandleMoveWithError(socket, moveData, states, config, errorAt) {
  const log = [];
  const { from, to, captures } = moveData;

  try {
    // Step 1: cppFetch move
    if (errorAt === 'cppFetch') throw new Error('C++ engine unavailable');
    const moveBody = buildCppMoveBody(from, to, captures);
    log.push({ action: 'cppFetchMove', body: moveBody });

    // Step 2: get state after player move
    if (errorAt === 'getState') throw new Error('Failed to get state');
    let state = { ...states.afterPlayerMove };
    log.push({ action: 'getState', state });

    const isPvAI = socket.gameMode === 'pvai';

    // Step 3: PvAI flow
    if (isPvAI && !state.gameOver) {
      log.push({ action: 'emit', event: 'state', target: 'socket' });
      const animTime = calcTotalAnimTime(state.path, config.animationStepDurationMs, config.moveDelayMs);
      log.push({ action: 'sleep', ms: animTime });

      if (errorAt === 'aiMove') throw new Error('AI move failed');
      log.push({ action: 'aiMove' });
      state = { ...states.afterAiMove };
    }

    // Step 4: emit final state
    const strategy = getEmitStrategy(socket.gameMode);
    log.push({ action: strategy.method, event: 'state' });

    // Step 5: game over
    if (state.gameOver) {
      log.push({ action: 'io.emit', event: 'gameOver', winner: state.winner });
      if (shouldRestartTrainer(socket.gameMode)) {
        log.push({ action: 'setTimeout', delay: 3000, callback: 'trainer.start()' });
      }
    }
  } catch (err) {
    log.push({ action: 'error', message: err.message });
  }

  return log;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runHandleMoveExtendedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  const CONFIG = { moveDelayMs: 100, animationStepDurationMs: 50 };

  // ═══════════════════════════════════════════════════════════════════════
  // Emit strategy per game mode
  // ═══════════════════════════════════════════════════════════════════════

  test('emitStrategy: pvp → io.emit (broadcast)', () => {
    const s = getEmitStrategy('pvp');
    assert.equal(s.method, 'io.emit');
    assert.equal(s.type, 'broadcast');
  });

  test('emitStrategy: pvai → socket.emit (unicast)', () => {
    const s = getEmitStrategy('pvai');
    assert.equal(s.method, 'socket.emit');
    assert.equal(s.type, 'unicast');
  });

  test('emitStrategy: aivai → socket.emit (unicast)', () => {
    const s = getEmitStrategy('aivai');
    assert.equal(s.method, 'socket.emit');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Trainer restart on game over
  // ═══════════════════════════════════════════════════════════════════════

  test('shouldRestartTrainer: aivai → true', () => {
    assert.ok(shouldRestartTrainer('aivai'));
  });

  test('shouldRestartTrainer: pvai → false', () => {
    assert.ok(!shouldRestartTrainer('pvai'));
  });

  test('shouldRestartTrainer: pvp → false', () => {
    assert.ok(!shouldRestartTrainer('pvp'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Animation time edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('animTime: stepMs=0 → only baseDelayMs', () => {
    const path = [[0,0],[1,1],[2,2],[3,3]];
    const t = calcTotalAnimTime(path, 0, 100);
    assert.equal(t, 100);
  });

  test('animTime: baseDelayMs=0 → only path.length * stepMs', () => {
    const path = [[0,0],[1,1],[2,2],[3,3]];
    const t = calcTotalAnimTime(path, 50, 0);
    assert.equal(t, 4 * 50);
  });

  test('animTime: both zero → 0', () => {
    const path = [[0,0],[1,1],[2,2]];
    const t = calcTotalAnimTime(path, 0, 0);
    assert.equal(t, 0);
  });

  test('animTime: null path → baseDelayMs', () => {
    const t = calcTotalAnimTime(null, 50, 100);
    assert.equal(t, 100);
  });

  test('animTime: 2-element path → baseDelayMs (≤2 threshold)', () => {
    const t = calcTotalAnimTime([[0,0],[1,1]], 50, 100);
    assert.equal(t, 100);
  });

  test('animTime: 3-element path → path.length * stepMs + base', () => {
    const t = calcTotalAnimTime([[0,0],[1,1],[2,2]], 50, 100);
    assert.equal(t, 3 * 50 + 100);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C++ move body construction
  // ═══════════════════════════════════════════════════════════════════════

  test('cppMoveBody: simple move without captures', () => {
    const body = buildCppMoveBody([2, 1], [3, 2], []);
    assert.deepEqual(body, { from: [2, 1], to: [3, 2] });
    assert.equal(body.captures, undefined);
  });

  test('cppMoveBody: single capture', () => {
    const body = buildCppMoveBody([2, 1], [4, 3], [[3, 2]]);
    assert.deepEqual(body.captures, [[3, 2]]);
  });

  test('cppMoveBody: triple capture chain', () => {
    const caps = [[1, 2], [3, 4], [5, 6]];
    const body = buildCppMoveBody([0, 1], [6, 7], caps);
    assert.equal(body.captures.length, 3);
  });

  test('cppMoveBody: null captures → omitted', () => {
    const body = buildCppMoveBody([2, 1], [3, 2], null);
    assert.equal(body.captures, undefined);
  });

  test('cppMoveBody: undefined captures → omitted', () => {
    const body = buildCppMoveBody([2, 1], [3, 2], undefined);
    assert.equal(body.captures, undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // State payload construction
  // ═══════════════════════════════════════════════════════════════════════

  test('statePayload: includes lastMove when state has none', () => {
    const state = { board: [], turn: 'black', gameOver: false };
    const payload = buildStatePayload(state, [2, 1], [3, 2], []);
    assert.deepEqual(payload.lastMove, { from: [2, 1], to: [3, 2], captures: [] });
  });

  test('statePayload: preserves existing lastMove', () => {
    const state = { board: [], turn: 'black', gameOver: false, lastMove: { from: [0, 0], to: [1, 1], captures: [] } };
    const payload = buildStatePayload(state, [2, 1], [3, 2], []);
    assert.deepEqual(payload.lastMove.from, [0, 0], 'existing lastMove should be preserved');
  });

  test('statePayload: includes captures in lastMove', () => {
    const state = { board: [], turn: 'black', gameOver: false };
    const payload = buildStatePayload(state, [2, 1], [4, 3], [[3, 2]]);
    assert.deepEqual(payload.lastMove.captures, [[3, 2]]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error injection: handleMove with C++ failures
  // ═══════════════════════════════════════════════════════════════════════

  test('error at cppFetch → error logged, no further steps', () => {
    const socket = { gameMode: 'pvai' };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [2, 1], to: [3, 2], captures: [] },
      {},
      CONFIG,
      'cppFetch'
    );
    assert.equal(log[0].action, 'error');
    assert.equal(log.length, 1);
  });

  test('error at getState → error after move, no emit', () => {
    const socket = { gameMode: 'pvai' };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [2, 1], to: [3, 2], captures: [] },
      {},
      CONFIG,
      'getState'
    );
    assert.equal(log[0].action, 'cppFetchMove');
    assert.equal(log[1].action, 'error');
    assert.equal(log.length, 2);
  });

  test('error at aiMove in PvAI → player state emitted, then error', () => {
    const socket = { gameMode: 'pvai' };
    const states = {
      afterPlayerMove: { board: [], turn: 'black', gameOver: false, path: [[2, 1], [3, 2]] },
    };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [2, 1], to: [3, 2], captures: [] },
      states,
      CONFIG,
      'aiMove'
    );
    // Should have: cppFetchMove, getState, emit (player state), sleep, then error
    const emitIdx = log.findIndex(l => l.action === 'emit');
    const errorIdx = log.findIndex(l => l.action === 'error');
    assert.ok(emitIdx >= 0, 'player state should be emitted before error');
    assert.ok(errorIdx > emitIdx, 'error should come after player state emit');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full flow: PvAI game over on player move (before AI)
  // ═══════════════════════════════════════════════════════════════════════

  test('PvAI: player move causes game over → no AI move, gameOver emitted', () => {
    const socket = { gameMode: 'pvai' };
    const states = {
      afterPlayerMove: { board: [], turn: 'black', gameOver: true, winner: 'white', path: [[2, 1], [4, 3]] },
    };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [2, 1], to: [4, 3], captures: [[3, 2]] },
      states,
      CONFIG,
      null
    );
    const aiMoves = log.filter(l => l.action === 'aiMove');
    const gameOverEvents = log.filter(l => l.event === 'gameOver');
    assert.equal(aiMoves.length, 0, 'no AI move when game over on player turn');
    assert.equal(gameOverEvents.length, 1);
    assert.equal(gameOverEvents[0].winner, 'white');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full flow: PvP game over
  // ═══════════════════════════════════════════════════════════════════════

  test('PvP: game over → broadcast state + gameOver, no trainer restart', () => {
    const socket = { gameMode: 'pvp' };
    const states = {
      afterPlayerMove: { board: [], turn: 'white', gameOver: true, winner: 'black' },
    };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [5, 0], to: [7, 2], captures: [[6, 1]] },
      states,
      CONFIG,
      null
    );
    const broadcasts = log.filter(l => l.action === 'io.emit' && l.event === 'state');
    const gameOverEvents = log.filter(l => l.event === 'gameOver');
    const restarts = log.filter(l => l.action === 'setTimeout');
    assert.equal(broadcasts.length, 1, 'should broadcast state');
    assert.equal(gameOverEvents.length, 1);
    assert.equal(restarts.length, 0, 'should NOT restart trainer in PvP');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full flow: aivai game over → restart
  // ═══════════════════════════════════════════════════════════════════════

  test('aivai: game over → setTimeout 3s → trainer.start()', () => {
    const socket = { gameMode: 'aivai' };
    const states = {
      afterPlayerMove: { board: [], turn: 'white', gameOver: true, winner: 'white' },
    };
    const log = simulateHandleMoveWithError(
      socket,
      { from: [2, 1], to: [4, 3], captures: [[3, 2]] },
      states,
      CONFIG,
      null
    );
    const restarts = log.filter(l => l.action === 'setTimeout');
    assert.equal(restarts.length, 1);
    assert.equal(restarts[0].delay, 3000);
    assert.equal(restarts[0].callback, 'trainer.start()');
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Handle Move Extended Tests');

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
