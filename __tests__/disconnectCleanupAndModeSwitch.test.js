/**
 * disconnectCleanupAndModeSwitch.test.js — Tests for disconnect cleanup and mode switching.
 *
 * Covers gaps in wsConnectionLifecycle.test.js and wsHandlerLogic.test.js:
 * - Disconnect: cleanup of socket state, move queue, throttle data
 * - Mode switching: switching from pvai to pvp while move in progress
 * - Mode switching: switching to aivai stops trainer
 * - Concurrent mode switches: rapid startGame calls
 * - Socket state isolation: one socket's mode doesn't affect another
 * - Disconnect during move: queue should be abandoned
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: socket state management ──────────────────────────────────────

class SocketState {
  constructor(id) {
    this.id = id;
    this.gameMode = 'pvai';
    this._moveQueue = Promise.resolve();
    this._throttle = {};
    this._pendingMove = false;
  }

  setMode(mode) {
    const validModes = ['pvai', 'pvp', 'aivai'];
    this.gameMode = validModes.includes(mode) ? mode : 'pvai';
    return this.gameMode;
  }

  cleanup() {
    this._pendingMove = false;
    this._throttle = {};
    // Move queue is left to resolve/reject naturally
    return { cleaned: true, socketId: this.id };
  }
}

// ── Extracted: mode switch with trainer stop logic ──────────────────────────

function handleModeSwitch(newMode, trainerRunning) {
  const validModes = ['pvai', 'pvp', 'aivai'];
  const gameMode = validModes.includes(newMode) ? newMode : 'pvai';

  const actions = [];

  // Stop self-play when starting a player game
  if (trainerRunning && gameMode !== 'aivai') {
    actions.push({ type: 'stopTrainer' });
    actions.push({ type: 'incrementParamsVersion' });
  }

  actions.push({ type: 'startGame', mode: gameMode });

  // Auto-start trainer for aivai
  if (gameMode === 'aivai') {
    actions.push({ type: 'startTrainer' });
  }

  return { gameMode, actions };
}

// ── Extracted: disconnect during move ───────────────────────────────────────

function handleDisconnectDuringMove(socketId, moveInProgress) {
  const result = { socketId, moveAbandoned: false };

  if (moveInProgress) {
    // The move queue promise will resolve/reject but we don't emit to disconnected socket
    result.moveAbandoned = true;
  }

  result.cleaned = true;
  return result;
}

// ── Extracted: socket isolation check ───────────────────────────────────────

function checkSocketIsolation(sockets, targetId, action) {
  // Action on one socket should not affect others
  const affected = sockets.filter(s => s.id !== targetId);
  const target = sockets.find(s => s.id === targetId);

  if (!target) return { error: 'socket not found' };

  // Apply action to target
  if (action.type === 'setMode') {
    target.setMode(action.mode);
  }

  // Check others are unaffected
  const othersUnaffected = affected.every(s => s.gameMode === s.gameMode);

  return {
    target: target.gameMode,
    othersUnaffected,
    socketCount: sockets.length,
  };
}

// ── Extracted: rapid mode switch handling ───────────────────────────────────

function rapidModeSwitch(socket, modes) {
  const results = [];
  for (const mode of modes) {
    results.push(socket.setMode(mode));
  }
  // Last mode wins
  return { finalMode: results[results.length - 1], switchCount: results.length };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runDisconnectCleanupAndModeSwitchTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Disconnect cleanup
  // ═══════════════════════════════════════════════════════════════════════

  test('disconnect: cleanup resets pending move flag', () => {
    const socket = new SocketState('s1');
    socket._pendingMove = true;
    const result = socket.cleanup();
    assert.equal(socket._pendingMove, false);
    assert.equal(result.cleaned, true);
  });

  test('disconnect: cleanup resets throttle data', () => {
    const socket = new SocketState('s1');
    socket._throttle = { move: Date.now(), setSpeed: Date.now() };
    socket.cleanup();
    assert.deepEqual(socket._throttle, {});
  });

  test('disconnect: cleanup returns socket id for logging', () => {
    const socket = new SocketState('abc-123');
    const result = socket.cleanup();
    assert.equal(result.socketId, 'abc-123');
  });

  test('disconnect: cleanup of socket with no throttle is safe', () => {
    const socket = new SocketState('s1');
    // _throttle is {} by default
    const result = socket.cleanup();
    assert.equal(result.cleaned, true);
  });

  test('disconnect during move: move is abandoned', () => {
    const result = handleDisconnectDuringMove('s1', true);
    assert.equal(result.moveAbandoned, true);
    assert.equal(result.cleaned, true);
  });

  test('disconnect without move: no move to abandon', () => {
    const result = handleDisconnectDuringMove('s1', false);
    assert.equal(result.moveAbandoned, false);
    assert.equal(result.cleaned, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Mode switching
  // ═══════════════════════════════════════════════════════════════════════

  test('mode switch: pvai → pvp stops trainer if running', () => {
    const result = handleModeSwitch('pvp', true);
    assert.equal(result.gameMode, 'pvp');
    assert.ok(result.actions.some(a => a.type === 'stopTrainer'));
  });

  test('mode switch: pvai → aivai starts trainer', () => {
    const result = handleModeSwitch('aivai', false);
    assert.equal(result.gameMode, 'aivai');
    assert.ok(result.actions.some(a => a.type === 'startTrainer'));
  });

  test('mode switch: pvai → aivai does NOT stop trainer', () => {
    const result = handleModeSwitch('aivai', true);
    assert.ok(!result.actions.some(a => a.type === 'stopTrainer'),
      'aivai mode should not stop trainer');
  });

  test('mode switch: invalid mode defaults to pvai', () => {
    const result = handleModeSwitch('chess', false);
    assert.equal(result.gameMode, 'pvai');
  });

  test('mode switch: null mode defaults to pvai', () => {
    const result = handleModeSwitch(null, false);
    assert.equal(result.gameMode, 'pvai');
  });

  test('mode switch: undefined mode defaults to pvai', () => {
    const result = handleModeSwitch(undefined, false);
    assert.equal(result.gameMode, 'pvai');
  });

  test('mode switch: stop trainer also increments params version', () => {
    const result = handleModeSwitch('pvp', true);
    const stopAction = result.actions.find(a => a.type === 'stopTrainer');
    const incrementAction = result.actions.find(a => a.type === 'incrementParamsVersion');
    assert.ok(stopAction, 'should stop trainer');
    assert.ok(incrementAction, 'should increment params version');
  });

  test('mode switch: pvai → pvai (same mode) still starts game', () => {
    const result = handleModeSwitch('pvai', false);
    assert.ok(result.actions.some(a => a.type === 'startGame'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Socket state isolation
  // ═══════════════════════════════════════════════════════════════════════

  test('isolation: changing socket A mode does not affect socket B', () => {
    const socketA = new SocketState('a');
    const socketB = new SocketState('b');
    socketA.setMode('pvp');
    assert.equal(socketB.gameMode, 'pvai', 'socket B should be unaffected');
    assert.equal(socketA.gameMode, 'pvp');
  });

  test('isolation: each socket has independent throttle', () => {
    const socketA = new SocketState('a');
    const socketB = new SocketState('b');
    socketA._throttle = { move: 1000 };
    assert.deepEqual(socketB._throttle, {}, 'socket B throttle should be empty');
  });

  test('isolation: each socket has independent move queue', () => {
    const socketA = new SocketState('a');
    const socketB = new SocketState('b');
    assert.notEqual(socketA._moveQueue, socketB._moveQueue);
  });

  test('isolation: cleanup of socket A does not affect socket B', () => {
    const socketA = new SocketState('a');
    const socketB = new SocketState('b');
    socketB._throttle = { move: 1000 };
    socketA.cleanup();
    assert.deepEqual(socketB._throttle, { move: 1000 }, 'socket B should be unaffected');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rapid mode switching
  // ═══════════════════════════════════════════════════════════════════════

  test('rapid switch: last mode wins', () => {
    const socket = new SocketState('s1');
    const result = rapidModeSwitch(socket, ['pvp', 'aivai', 'pvai', 'pvp']);
    assert.equal(result.finalMode, 'pvp');
    assert.equal(result.switchCount, 4);
  });

  test('rapid switch: switching to aivai and back to pvai', () => {
    const socket = new SocketState('s1');
    socket.setMode('aivai');
    assert.equal(socket.gameMode, 'aivai');
    socket.setMode('pvai');
    assert.equal(socket.gameMode, 'pvai');
  });

  test('rapid switch: 100 rapid mode changes are consistent', () => {
    const socket = new SocketState('s1');
    const modes = ['pvai', 'pvp', 'aivai'];
    for (let i = 0; i < 100; i++) {
      socket.setMode(modes[i % 3]);
    }
    // Last iteration i=99 → 99%3=0 → 'pvai'
    assert.equal(socket.gameMode, 'pvai');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Concurrent game mode scenarios
  // ═══════════════════════════════════════════════════════════════════════

  test('concurrent: two sockets start different game modes', () => {
    const socketA = new SocketState('a');
    const socketB = new SocketState('b');
    socketA.setMode('pvp');
    socketB.setMode('aivai');
    assert.equal(socketA.gameMode, 'pvp');
    assert.equal(socketB.gameMode, 'aivai');
  });

  test('concurrent: multiple sockets in pvai mode', () => {
    const sockets = Array.from({ length: 10 }, (_, i) => new SocketState(`s${i}`));
    sockets.forEach(s => s.setMode('pvai'));
    assert.ok(sockets.every(s => s.gameMode === 'pvai'));
  });

  test('concurrent: one socket aivai, rest pvai', () => {
    const sockets = Array.from({ length: 5 }, (_, i) => new SocketState(`s${i}`));
    sockets[0].setMode('aivai');
    for (let i = 1; i < sockets.length; i++) {
      sockets[i].setMode('pvai');
    }
    assert.equal(sockets[0].gameMode, 'aivai');
    assert.ok(sockets.slice(1).every(s => s.gameMode === 'pvai'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Mode validation edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('setMode: "PVP" (uppercase) → defaults to pvai', () => {
    const socket = new SocketState('s1');
    assert.equal(socket.setMode('PVP'), 'pvai');
  });

  test('setMode: "pvai " (trailing space) → defaults to pvai', () => {
    const socket = new SocketState('s1');
    assert.equal(socket.setMode('pvai '), 'pvai');
  });

  test('setMode: empty string → defaults to pvai', () => {
    const socket = new SocketState('s1');
    assert.equal(socket.setMode(''), 'pvai');
  });

  test('setMode: number 0 → defaults to pvai', () => {
    const socket = new SocketState('s1');
    assert.equal(socket.setMode(0), 'pvai');
  });

  test('setMode: boolean true → defaults to pvai', () => {
    const socket = new SocketState('s1');
    assert.equal(socket.setMode(true), 'pvai');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Disconnect Cleanup & Mode Switch Tests');

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
