/**
 * wsConnectionLifecycle.test.js — Tests for WebSocket connection lifecycle logic.
 *
 * Covers: connect/disconnect handling, state emission on connect,
 *         selfPlayStatus emission, error event patterns, move queue serialization.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: WebSocket connection handler logic ───────────────────────────

/**
 * Simulates the connection handler from server/index.js.
 * Returns what events would be emitted to a new client.
 */
function buildConnectEmissions(gameState, trainerStatus, lastLoss) {
  const events = [];

  // Always emit state (or error if state fetch fails)
  if (gameState) {
    events.push({ event: 'state', data: gameState });
  }

  // Always emit selfPlayStatus
  events.push({
    event: 'selfPlayStatus',
    data: {
      active: trainerStatus.running,
      currentGame: trainerStatus.stats.gamesPlayed,
      stats: trainerStatus.stats,
    },
  });

  // Emit loss if available
  if (lastLoss != null) {
    events.push({ event: 'loss', data: { loss: lastLoss } });
  }

  return events;
}

/**
 * Simulates disconnect handler
 */
function buildDisconnectEmissions(socketId) {
  return { disconnected: true, socketId };
}

/**
 * Simulates move queue serialization (per-socket promise chain).
 * Ensures moves are processed sequentially, not in parallel.
 */
class MoveQueue {
  constructor() {
    this.queue = Promise.resolve();
    this.processed = [];
  }

  enqueue(moveData) {
    this.queue = this.queue
      .then(() => {
        this.processed.push(moveData);
        return moveData;
      })
      .catch(() => {});
    return this.queue;
  }
}

/**
 * Extracted: selfPlayStatus emission on startSelfPlay
 */
function buildStartSelfPlayEmissions(stats) {
  return {
    event: 'selfPlayStatus',
    data: { active: true, gameNumber: stats.gamesPlayed },
  };
}

/**
 * Extracted: selfPlayStatus emission on stopSelfPlay
 */
function buildStopSelfPlayEmissions() {
  return {
    event: 'selfPlayStatus',
    data: { active: false },
  };
}

/**
 * Extracted: error emission pattern used across WS handlers
 */
function buildErrorEmission(message) {
  return { event: 'error', data: { message } };
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runWsConnectionLifecycleTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Connection handler
  // ═══════════════════════════════════════════════════════════════════════

  test('connect: emits state to new client', () => {
    const gameState = { board: [[0]], turn: 'white', gameOver: false };
    const trainer = {
      running: false,
      stats: { gamesPlayed: 5, whiteWins: 2, blackWins: 1, draws: 2, lastLoss: null },
    };
    const events = buildConnectEmissions(gameState, trainer, null);
    assert.ok(events.find(e => e.event === 'state'));
    assert.deepEqual(events.find(e => e.event === 'state').data, gameState);
  });

  test('connect: emits selfPlayStatus with trainer state', () => {
    const trainer = {
      running: true,
      stats: { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2, lastLoss: 0.5 },
    };
    const events = buildConnectEmissions({ board: [] }, trainer, null);
    const statusEvent = events.find(e => e.event === 'selfPlayStatus');
    assert.ok(statusEvent);
    assert.equal(statusEvent.data.active, true);
    assert.equal(statusEvent.data.currentGame, 10);
  });

  test('connect: emits loss when lastLoss is not null', () => {
    const trainer = {
      running: false,
      stats: { gamesPlayed: 3, whiteWins: 1, blackWins: 1, draws: 1, lastLoss: 0.42 },
    };
    const events = buildConnectEmissions({ board: [] }, trainer, 0.42);
    const lossEvent = events.find(e => e.event === 'loss');
    assert.ok(lossEvent);
    assert.equal(lossEvent.data.loss, 0.42);
  });

  test('connect: does NOT emit loss when lastLoss is null', () => {
    const trainer = {
      running: false,
      stats: { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null },
    };
    const events = buildConnectEmissions({ board: [] }, trainer, null);
    assert.ok(!events.find(e => e.event === 'loss'));
  });

  test('connect: emits selfPlayStatus even when trainer not running', () => {
    const trainer = {
      running: false,
      stats: { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null },
    };
    const events = buildConnectEmissions({ board: [] }, trainer, null);
    const statusEvent = events.find(e => e.event === 'selfPlayStatus');
    assert.ok(statusEvent);
    assert.equal(statusEvent.data.active, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Disconnect handler
  // ═══════════════════════════════════════════════════════════════════════

  test('disconnect: returns socket id for logging', () => {
    const result = buildDisconnectEmissions('abc-123');
    assert.equal(result.disconnected, true);
    assert.equal(result.socketId, 'abc-123');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Move queue serialization
  // ═══════════════════════════════════════════════════════════════════════

  test('moveQueue: processes moves sequentially', async () => {
    const mq = new MoveQueue();
    const order = [];

    // Simulate 3 moves enqueued simultaneously
    const p1 = mq.enqueue('move1').then(() => order.push(1));
    const p2 = mq.enqueue('move2').then(() => order.push(2));
    const p3 = mq.enqueue('move3').then(() => order.push(3));

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(order, [1, 2, 3]);
    assert.deepEqual(mq.processed, ['move1', 'move2', 'move3']);
  });

  test('moveQueue: handles empty queue', async () => {
    const mq = new MoveQueue();
    assert.deepEqual(mq.processed, []);
    await mq.enqueue('first');
    assert.deepEqual(mq.processed, ['first']);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Self-play control emissions
  // ═══════════════════════════════════════════════════════════════════════

  test('startSelfPlay: emits active=true with gameNumber', () => {
    const e = buildStartSelfPlayEmissions({ gamesPlayed: 42 });
    assert.equal(e.event, 'selfPlayStatus');
    assert.equal(e.data.active, true);
    assert.equal(e.data.gameNumber, 42);
  });

  test('stopSelfPlay: emits active=false', () => {
    const e = buildStopSelfPlayEmissions();
    assert.equal(e.event, 'selfPlayStatus');
    assert.equal(e.data.active, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error emission patterns
  // ═══════════════════════════════════════════════════════════════════════

  test('error emission: has correct structure', () => {
    const e = buildErrorEmission('Something failed');
    assert.equal(e.event, 'error');
    assert.equal(e.data.message, 'Something failed');
    assert.ok(typeof e.data.message === 'string');
  });

  test('error emission: startGame failure', () => {
    const e = buildErrorEmission('Failed to start game');
    assert.equal(e.data.message, 'Failed to start game');
  });

  test('error emission: move failure', () => {
    const e = buildErrorEmission('Move failed');
    assert.equal(e.data.message, 'Move failed');
  });

  test('error emission: reset failure', () => {
    const e = buildErrorEmission('Reset failed');
    assert.equal(e.data.message, 'Reset failed');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Connection Lifecycle Tests');

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
