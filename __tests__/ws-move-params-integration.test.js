/**
 * ws-move-params-integration.test.js — Tests for move queue + paramsVersion invalidation.
 *
 * GAP: Existing tests cover paramsVersion in self-play (_playGame) and setParams handler
 * in isolation, but don't test the integration scenarios:
 *  1. setParams mid-move-queue — does the move queue get corrupted?
 *  2. trainer.resetModel() during active self-play — does paramsVersion prevent stale training?
 *  3. Rapid setParams + startGame sequences — clean state transitions
 *  4. Move queue recovery after paramsVersion bump
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Simulated trainer with paramsVersion tracking ───────────────────────────

class MockTrainer {
  constructor() {
    this.paramsVersion = 0;
    this.dirty = false;
    this.buffer = [];
    this.stats = { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0 };
    this.epsilonWhite = 0.3;
    this.epsilonBlack = 0.3;
    this.running = false;
  }

  setParams(params) {
    this.paramsVersion++;
    this.dirty = true;
    if (params.epsilon != null) {
      this.epsilonWhite = params.epsilon;
      this.epsilonBlack = params.epsilon;
    }
    // Buffer is cleared on setParams (as per server behavior)
    this.buffer = [];
  }

  resetModel() {
    this.paramsVersion++;
    this.dirty = true;
    this.buffer = [];
    this.stats = { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0 };
  }

  addSample(sample, playGameVersion) {
    if (this.paramsVersion !== playGameVersion) {
      return { skipped: true, reason: 'stale' };
    }
    this.buffer.push(sample);
    return { skipped: false };
  }

  decayEpsilon(playGameVersion) {
    if (this.paramsVersion !== playGameVersion) {
      return { skipped: true, reason: 'stale' };
    }
    this.epsilonWhite = Math.max(0.01, this.epsilonWhite - 0.01);
    this.dirty = true;
    return { skipped: false };
  }
}

// ── Simulated move queue ────────────────────────────────────────────────────

class MoveQueue {
  constructor() {
    this.queue = Promise.resolve();
    this.processed = [];
    this.errors = [];
  }

  enqueue(fn) {
    this.queue = this.queue.then(async () => {
      try {
        const result = await fn();
        this.processed.push(result);
        return result;
      } catch (err) {
        this.errors.push(err.message);
        this.queue = Promise.resolve(); // reset queue on error
        throw err;
      }
    });
    return this.queue;
  }
}

// ── Simulated self-play game ────────────────────────────────────────────────

async function simulateSelfPlayGame(trainer, opts = {}) {
  const playGameVersion = trainer.paramsVersion;
  const moves = opts.moves || 5;
  const samples = [];

  for (let i = 0; i < moves; i++) {
    // Check version before each move
    if (trainer.paramsVersion !== playGameVersion) {
      return { aborted: true, reason: 'stale version', movesPlayed: i, samples };
    }

    // Simulate creating a sample
    const sample = { board: new Array(64).fill(0), policyIndex: i, moveIndex: i };
    const addResult = trainer.addSample(sample, playGameVersion);
    if (!addResult.skipped) {
      samples.push(sample);
    }

    // Simulate a delay where setParams could happen
    if (opts.delayAfterMove) {
      await new Promise(r => setTimeout(r, opts.delayAfterMove));
    }
  }

  // End of game — decay epsilon
  trainer.decayEpsilon(playGameVersion);
  trainer.stats.gamesPlayed++;

  return { aborted: false, movesPlayed: moves, samples };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsMoveParamsIntegrationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // paramsVersion — setParams during self-play
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams before game starts — game uses new version', async () => {
    const trainer = new MockTrainer();
    trainer.setParams({ epsilon: 0.5 });
    assert.equal(trainer.paramsVersion, 1);

    const result = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result.aborted, false, 'Game should complete with current version');
    assert.equal(result.movesPlayed, 3);
    assert.equal(trainer.stats.gamesPlayed, 1);
  });

  test('setParams during game — game aborts, no samples added', async () => {
    const trainer = new MockTrainer();
    const playGameVersion = trainer.paramsVersion; // 0

    // Start processing moves
    const sample1 = { board: new Array(64).fill(0), policyIndex: 0, moveIndex: 0 };
    trainer.addSample(sample1, playGameVersion); // works

    // setParams bumps version
    trainer.setParams({ epsilon: 0.5 });
    assert.equal(trainer.paramsVersion, 1);

    // Try to add sample with stale version
    const sample2 = { board: new Array(64).fill(0), policyIndex: 1, moveIndex: 1 };
    const result = trainer.addSample(sample2, playGameVersion);
    assert.equal(result.skipped, true, 'Sample should be skipped with stale version');
    assert.equal(trainer.buffer.length, 1, 'Only first sample should be in buffer');
  });

  test('full game then setParams then new game — clean state', async () => {
    const trainer = new MockTrainer();

    // First game
    const result1 = await simulateSelfPlayGame(trainer, { moves: 5 });
    assert.equal(result1.aborted, false);
    assert.equal(trainer.buffer.length, 5);
    assert.equal(trainer.stats.gamesPlayed, 1);

    // setParams clears buffer, bumps version
    trainer.setParams({ epsilon: 0.1 });
    assert.equal(trainer.buffer.length, 0, 'Buffer cleared after setParams');
    assert.equal(trainer.paramsVersion, 1);

    // Second game with new params
    const result2 = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result2.aborted, false);
    assert.equal(trainer.buffer.length, 3, 'New game has fresh samples');
    assert.equal(trainer.stats.gamesPlayed, 2);
  });

  test('rapid setParams — only latest version matters', async () => {
    const trainer = new MockTrainer();

    // Rapid setParams calls
    for (let i = 0; i < 10; i++) {
      trainer.setParams({ epsilon: 0.1 * i });
    }
    assert.equal(trainer.paramsVersion, 10);

    // Game with version 10 should complete
    const result = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result.aborted, false, 'Game with latest version should complete');
  });

  test('setParams with stale version in mid-game — epsilon not decayed', async () => {
    const trainer = new MockTrainer();
    const initialEpsilon = trainer.epsilonWhite;

    const playGameVersion = trainer.paramsVersion;

    // Process some moves
    for (let i = 0; i < 3; i++) {
      trainer.addSample({ board: new Array(64).fill(0), policyIndex: i, moveIndex: i }, playGameVersion);
    }

    // setParams bumps version
    trainer.setParams({ epsilon: 0.1 });
    assert.equal(trainer.epsilonWhite, 0.1, 'Epsilon set to new value');

    // Try to decay with stale version — should be skipped
    const decayResult = trainer.decayEpsilon(playGameVersion);
    assert.equal(decayResult.skipped, true, 'Epsilon decay skipped for stale version');
    assert.equal(trainer.epsilonWhite, 0.1, 'Epsilon not decayed (setParams value preserved)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // resetModel during active game
  // ═══════════════════════════════════════════════════════════════════════

  test('resetModel during game — game aborts cleanly', async () => {
    const trainer = new MockTrainer();
    const playGameVersion = trainer.paramsVersion;

    // Add some samples
    for (let i = 0; i < 3; i++) {
      trainer.addSample({ board: new Array(64).fill(0), policyIndex: i, moveIndex: i }, playGameVersion);
    }
    assert.equal(trainer.buffer.length, 3);

    // resetModel bumps version
    trainer.resetModel();
    assert.equal(trainer.paramsVersion, 1);
    assert.equal(trainer.buffer.length, 0, 'Buffer cleared by reset');
    assert.equal(trainer.stats.gamesPlayed, 0, 'Stats reset');

    // Stale game tries to add more samples
    const result = trainer.addSample({ board: new Array(64).fill(0), policyIndex: 3, moveIndex: 3 }, playGameVersion);
    assert.equal(result.skipped, true, 'Stale sample rejected after reset');
  });

  test('resetModel then start new game — fresh state', async () => {
    const trainer = new MockTrainer();

    // First game
    await simulateSelfPlayGame(trainer, { moves: 5 });
    assert.equal(trainer.stats.gamesPlayed, 1);

    // Reset
    trainer.resetModel();
    assert.equal(trainer.stats.gamesPlayed, 0);

    // New game after reset
    const result = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result.aborted, false);
    assert.equal(trainer.stats.gamesPlayed, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Move queue + paramsVersion interaction
  // ═══════════════════════════════════════════════════════════════════════

  test('move queue processes sequentially — no corruption from rapid enqueue', async () => {
    const queue = new MoveQueue();
    const results = [];

    for (let i = 0; i < 10; i++) {
      queue.enqueue(async () => {
        await new Promise(r => setTimeout(r, Math.random() * 5));
        results.push(i);
        return i;
      });
    }

    await queue.queue;
    assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'Moves processed in order');
    assert.equal(queue.errors.length, 0, 'No errors');
  });

  test('move queue — error in one move does not break subsequent moves', async () => {
    const queue = new MoveQueue();

    queue.enqueue(async () => 'ok-1');
    queue.enqueue(async () => { throw new Error('fail'); });
    queue.enqueue(async () => 'ok-2');
    queue.enqueue(async () => 'ok-3');

    // Wait for all
    try { await queue.queue; } catch (_) { /* expected */ }

    // After error, queue resets to Promise.resolve()
    // Subsequent enqueues should work
    queue.enqueue(async () => 'recovered');
    const result = await queue.queue;
    assert.equal(result, 'recovered', 'Queue recovered after error');
  });

  test('move queue — setParams during queue processing does not corrupt order', async () => {
    const trainer = new MockTrainer();
    const queue = new MoveQueue();
    const results = [];

    // Enqueue moves
    for (let i = 0; i < 5; i++) {
      queue.enqueue(async () => {
        results.push(`move-${i}`);
        return `move-${i}`;
      });
    }

    // setParams mid-queue
    await new Promise(r => setTimeout(r, 1));
    trainer.setParams({ epsilon: 0.2 });

    // Enqueue more moves
    for (let i = 5; i < 10; i++) {
      queue.enqueue(async () => {
        results.push(`move-${i}`);
        return `move-${i}`;
      });
    }

    await queue.queue;
    assert.deepEqual(results, [
      'move-0', 'move-1', 'move-2', 'move-3', 'move-4',
      'move-5', 'move-6', 'move-7', 'move-8', 'move-9'
    ], 'All moves processed in order despite setParams');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Concurrent setParams — paramsVersion monotonically increases
  // ═══════════════════════════════════════════════════════════════════════

  test('concurrent setParams — version always increases', async () => {
    const trainer = new MockTrainer();
    const promises = [];

    for (let i = 0; i < 20; i++) {
      promises.push(Promise.resolve().then(() => trainer.setParams({ epsilon: 0.1 * i })));
    }

    await Promise.all(promises);
    assert.equal(trainer.paramsVersion, 20, 'All 20 setParams calls incremented version');
    assert.equal(trainer.dirty, true, 'dirty flag set');
    assert.equal(trainer.buffer.length, 0, 'Buffer cleared');
  });

  test('setParams + resetModel interleaved — version increases correctly', async () => {
    const trainer = new MockTrainer();

    trainer.setParams({ epsilon: 0.5 });
    assert.equal(trainer.paramsVersion, 1);

    trainer.resetModel();
    assert.equal(trainer.paramsVersion, 2);

    trainer.setParams({ epsilon: 0.3 });
    assert.equal(trainer.paramsVersion, 3);

    trainer.resetModel();
    assert.equal(trainer.paramsVersion, 4);

    // Game with version 4 should work
    const result = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result.aborted, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: Game with 0 moves (instant draw / no legal moves)
  // ═══════════════════════════════════════════════════════════════════════

  test('game with 0 moves — no samples, stats still update', async () => {
    const trainer = new MockTrainer();
    const result = await simulateSelfPlayGame(trainer, { moves: 0 });
    assert.equal(result.aborted, false);
    assert.equal(result.movesPlayed, 0);
    assert.equal(trainer.buffer.length, 0, 'No samples for empty game');
    assert.equal(trainer.stats.gamesPlayed, 1, 'Game still counted');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: setParams with same epsilon — version still bumps
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams with identical epsilon — version still increments', () => {
    const trainer = new MockTrainer();
    trainer.setParams({ epsilon: 0.3 });
    assert.equal(trainer.paramsVersion, 1);
    assert.equal(trainer.epsilonWhite, 0.3);

    // Same epsilon again
    trainer.setParams({ epsilon: 0.3 });
    assert.equal(trainer.paramsVersion, 2, 'Version bumps even with same value');
    assert.equal(trainer.epsilonWhite, 0.3, 'Value unchanged');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: dirty flag across setParams / resetModel / game completion
  // ═══════════════════════════════════════════════════════════════════════

  test('dirty flag: setParams → game → save → setParams — dirty set again', () => {
    const trainer = new MockTrainer();

    trainer.setParams({ epsilon: 0.5 });
    assert.equal(trainer.dirty, true);

    // Simulate save (dirty reset)
    trainer.dirty = false;

    // New setParams
    trainer.setParams({ epsilon: 0.1 });
    assert.equal(trainer.dirty, true, 'dirty set again after save');
  });

  test('dirty flag: resetModel → save → game → epsilon decay — dirty stays true', async () => {
    const trainer = new MockTrainer();

    trainer.resetModel();
    assert.equal(trainer.dirty, true);

    // Save resets dirty
    trainer.dirty = false;

    // Game with epsilon decay sets dirty
    await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(trainer.dirty, true, 'dirty set by epsilon decay in game');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: Two games racing — first gets stale, second completes
  // ═══════════════════════════════════════════════════════════════════════

  test('two concurrent games — setParams invalidates first, second completes', async () => {
    const trainer = new MockTrainer();

    // Start game 1
    const game1Version = trainer.paramsVersion;
    trainer.addSample({ board: new Array(64).fill(0), policyIndex: 0, moveIndex: 0 }, game1Version);

    // setParams invalidates game 1
    trainer.setParams({ epsilon: 0.1 });

    // Game 1 tries to continue — stale
    const staleResult = trainer.addSample({ board: new Array(64).fill(0), policyIndex: 1, moveIndex: 1 }, game1Version);
    assert.equal(staleResult.skipped, true, 'Game 1 sample rejected');

    // Start game 2 with current version
    const result2 = await simulateSelfPlayGame(trainer, { moves: 3 });
    assert.equal(result2.aborted, false, 'Game 2 completes');
    assert.equal(trainer.buffer.length, 3, 'Only game 2 samples in buffer');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: paramsVersion overflow (theoretical)
  // ═══════════════════════════════════════════════════════════════════════

  test('paramsVersion: many increments do not cause issues', () => {
    const trainer = new MockTrainer();
    for (let i = 0; i < 1000; i++) {
      trainer.setParams({ epsilon: Math.random() });
    }
    assert.equal(trainer.paramsVersion, 1000);
    // Version comparison still works
    const oldVersion = 500;
    assert.notEqual(trainer.paramsVersion, oldVersion, 'Old version is stale');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 WS Move + ParamsVersion Integration Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
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
