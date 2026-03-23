/**
 * issues132to134.test.js — Tests for bugs #132, #133, #134.
 *
 * #134: WebSocket setParams accepts layers 1-8, createModel clamps to 1-5.
 *       → Inconsistent validation — user thinks 8 layers, model gets max 5.
 *
 * #132: trainer.dirty not set after epsilon decay in _playGame().
 *       → After a game finishes and epsilon decays, dirty=false means
 *         auto-save interval skips persisting the new epsilon value.
 *
 * #133: Race condition in setParams — _playGame may still be running
 *       when setParams swaps models, so the in-flight game uses stale params.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════════
// #134 — layers validation mismatch between WS setParams and createModel
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * WS setParams validation (mirrors server/index.js):
 *   if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 8))
 *       → reject
 */
function wsValidateLayers(layers) {
  if (layers != null && (layers < 1 || layers > 8)) {
    return { valid: false, error: `layers=${layers} (zakres: 1-8)` };
  }
  return { valid: true };
}

/**
 * createModel layers clamping (mirrors server/ai/model.js):
 *   if (numLayers < 1 || numLayers > 5) {
 *     numLayers = Math.max(1, Math.min(5, numLayers));
 *   }
 */
function createModelClampLayers(numLayers) {
  let clamped = numLayers;
  let wasClamped = false;
  if (numLayers < 1 || numLayers > 5) {
    clamped = Math.max(1, Math.min(5, numLayers));
    wasClamped = true;
  }
  return { requested: numLayers, actual: clamped, wasClamped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #132 — dirty flag after epsilon decay
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulate the end-of-game epsilon decay block from _playGame().
 * Mirrors trainer.js lines:
 *   this.epsilonWhite = Math.max(CONFIG.ai.minEpsilon, this.epsilonWhite - CONFIG.ai.epsilonDecay);
 *   this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
 *   this.stats.epsilonWhite = this.epsilonWhite;
 *   this.stats.epsilonBlack = this.epsilonBlack;
 *
 * Returns the trainer state after decay.
 */
function simulateEpsilonDecay(trainer, epsilonDecay, minEpsilon) {
  trainer.epsilonWhite = Math.max(minEpsilon, trainer.epsilonWhite - epsilonDecay);
  trainer.epsilonBlack = Math.max(minEpsilon, trainer.epsilonBlack - epsilonDecay);
  trainer.stats.epsilonWhite = trainer.epsilonWhite;
  trainer.stats.epsilonBlack = trainer.epsilonBlack;
  // NOTE: the actual code does NOT set trainer.dirty = true here — that's the bug
  return trainer;
}

/**
 * Simulate auto-save interval check.
 * Mirrors server/index.js setInterval:
 *   if (!trainer.dirty) return; // skip save
 */
function shouldAutoSave(trainer) {
  return trainer.dirty === true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #133 — Race condition in setParams
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates the trainer with a running _playGame loop and setParams.
 *
 * The race condition:
 *   1. _playGame() is running (awaiting cppFetch calls)
 *   2. setParams() is called — stops trainer, swaps models, restarts
 *   3. But the old _playGame() iteration may still reference old models/params
 *      because it captured them at the start of the iteration.
 *
 * We model this by tracking what params _playGame uses vs what setParams sets.
 */

class MockTrainer {
  constructor() {
    this.running = false;
    this.modelParams = { layers: 3, neurons: 128 };
    this.modelWhite = { id: 'initial-white' };
    this.modelBlack = { id: 'initial-black' };
    this.buffer = { clear() { this._data = []; }, _data: [] };
    this.stats = { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2, lastLoss: 0.5 };
    this.dirty = false;
  }

  stop() {
    this.running = false;
  }

  async start() {
    this.running = true;
  }

  setModelParams(newParams) {
    Object.assign(this.modelParams, newParams);
  }

  /**
   * Simulates _playGame capturing references at the start.
   * Returns what the game "sees" — captured before setParams might run.
   */
  captureGameState() {
    return {
      modelWhite: this.modelWhite,
      modelBlack: this.modelBlack,
      modelParams: { ...this.modelParams },
    };
  }
}

/**
 * Simulate the setParams flow from server/index.js WS handler.
 * Returns what happens — highlights if running game uses stale params.
 */
function simulateSetParams(trainer, newParams) {
  const wasRunning = trainer.running;

  // Capture what an in-flight _playGame might have
  const inFlightState = trainer.captureGameState();

  // 1. Stop self-play
  trainer.stop();

  // 2. Update params
  trainer.setModelParams(newParams);

  // 3. Create fresh models
  trainer.modelWhite = { id: `white-${newParams.layers}x${newParams.neurons}` };
  trainer.modelBlack = { id: `black-${newParams.layers}x${newParams.neurons}` };

  // 4. Clear buffer
  trainer.buffer.clear();

  // 5. Reset stats
  trainer.stats.gamesPlayed = 0;
  trainer.stats.whiteWins = 0;
  trainer.stats.blackWins = 0;
  trainer.stats.draws = 0;
  trainer.stats.lastLoss = null;

  // 7. Restart if was running
  if (wasRunning) {
    trainer.running = true;
  }

  const newState = {
    modelWhite: trainer.modelWhite,
    modelBlack: trainer.modelBlack,
    modelParams: { ...trainer.modelParams },
  };

  return { inFlightState, newState, wasRunning };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════════

export async function runIssues132to134Tests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #134 — layers validation mismatch
  // ─────────────────────────────────────────────────────────────────────────

  test('#134: WS setParams accepts layers=8 (within 1-8 range)', () => {
    const wsResult = wsValidateLayers(8);
    assert.equal(wsResult.valid, true, 'WS should accept layers=8');
  });

  test('#134: WS setParams accepts layers=6', () => {
    const wsResult = wsValidateLayers(6);
    assert.equal(wsResult.valid, true, 'WS should accept layers=6');
  });

  test('#134: WS setParams accepts layers=7', () => {
    const wsResult = wsValidateLayers(7);
    assert.equal(wsResult.valid, true, 'WS should accept layers=7');
  });

  test('#134: WS setParams rejects layers=9', () => {
    const wsResult = wsValidateLayers(9);
    assert.equal(wsResult.valid, false, 'WS should reject layers=9');
  });

  test('#134: createModel clamps layers=8 to 5', () => {
    const modelResult = createModelClampLayers(8);
    assert.equal(modelResult.actual, 5, 'createModel should clamp 8 → 5');
    assert.equal(modelResult.wasClamped, true);
  });

  test('#134: createModel clamps layers=6 to 5', () => {
    const modelResult = createModelClampLayers(6);
    assert.equal(modelResult.actual, 5, 'createModel should clamp 6 → 5');
  });

  test('#134: createModel accepts layers=5 (boundary)', () => {
    const modelResult = createModelClampLayers(5);
    assert.equal(modelResult.actual, 5);
    assert.equal(modelResult.wasClamped, false);
  });

  test('#134: createModel accepts layers=1 (boundary)', () => {
    const modelResult = createModelClampLayers(1);
    assert.equal(modelResult.actual, 1);
    assert.equal(modelResult.wasClamped, false);
  });

  test('#134: BUG — WS accepts layers=8 but createModel silently clamps to 5', () => {
    // This is the core bug: layers 6-8 pass WS validation but get clamped
    for (const layers of [6, 7, 8]) {
      const wsResult = wsValidateLayers(layers);
      const modelResult = createModelClampLayers(layers);
      assert.equal(wsResult.valid, true, `WS should accept layers=${layers}`);
      assert.equal(modelResult.wasClamped, true, `createModel should clamp layers=${layers}`);
      assert.equal(modelResult.actual, 5, `createModel should clamp ${layers} → 5`);
    }
  });

  test('#134: consistent range — layers 1-5 pass both validations', () => {
    for (let layers = 1; layers <= 5; layers++) {
      const wsResult = wsValidateLayers(layers);
      const modelResult = createModelClampLayers(layers);
      assert.equal(wsResult.valid, true, `WS should accept layers=${layers}`);
      assert.equal(modelResult.wasClamped, false, `createModel should NOT clamp layers=${layers}`);
      assert.equal(modelResult.actual, layers, `createModel actual should equal requested for ${layers}`);
    }
  });

  test('#134: WS max=8, createModel max=5 — gap of 3 values silently accepted then clamped', () => {
    // Quantify the gap
    const wsMax = 8;
    const modelMax = 5;
    const gap = wsMax - modelMax;
    assert.equal(gap, 3, 'Gap between WS max (8) and model max (5) should be 3');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #132 — dirty flag not set after epsilon decay
  // ─────────────────────────────────────────────────────────────────────────

  test('#132: epsilon decays after each game', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };
    const result = simulateEpsilonDecay(trainer, 0.01, 0.1);
    assert.ok(result.epsilonWhite < 1.0, 'epsilonWhite should decrease');
    assert.ok(result.epsilonBlack < 1.0, 'epsilonBlack should decrease');
  });

  test('#132: BUG — dirty flag not set after epsilon decay → auto-save skips', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false, // not dirty before game
    };

    // Simulate a game finishing and epsilon decaying
    simulateEpsilonDecay(trainer, 0.01, 0.1);

    // After epsilon decay, dirty should be true so auto-save persists the new epsilon
    // BUG: dirty is still false
    const canSave = shouldAutoSave(trainer);
    assert.equal(canSave, false,
      'BUG: dirty=false after epsilon decay → auto-save interval will skip, ' +
      'epsilon changes will not be persisted until some other action sets dirty=true');
  });

  test('#132: WORKAROUND — if dirty were set after decay, auto-save would work', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };

    simulateEpsilonDecay(trainer, 0.01, 0.1);

    // Fix: set dirty after epsilon decay
    trainer.dirty = true;

    const canSave = shouldAutoSave(trainer);
    assert.equal(canSave, true, 'After setting dirty=true, auto-save should persist epsilon');
  });

  test('#132: epsilon decays to minEpsilon and stops', () => {
    const trainer = {
      epsilonWhite: 0.105,
      epsilonBlack: 0.105,
      stats: { epsilonWhite: 0.105, epsilonBlack: 0.105 },
      dirty: false,
    };
    simulateEpsilonDecay(trainer, 0.01, 0.1);
    assert.equal(trainer.epsilonWhite, 0.1, 'epsilon should not go below minEpsilon');
    assert.equal(trainer.epsilonBlack, 0.1, 'epsilon should not go below minEpsilon');
  });

  test('#132: multiple games without dirty flag — epsilon drifts unsaved', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };

    // Simulate 50 games with epsilon decay but no dirty flag
    for (let i = 0; i < 50; i++) {
      simulateEpsilonDecay(trainer, 0.01, 0.1);
    }

    assert.ok(Math.abs(trainer.epsilonWhite - 0.5) < 1e-10, 'After 50 decays of 0.01, epsilon should be ~0.5');
    assert.ok(Math.abs(trainer.epsilonBlack - 0.5) < 1e-10, 'After 50 decays of 0.01, epsilon should be ~0.5');
    assert.equal(shouldAutoSave(trainer), false,
      'BUG: After 50 games, dirty=false means epsilon=0.5 is never persisted. ' +
      'On restart, epsilon resets to 1.0 — 50 games of exploration lost.');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #133 — Race condition in setParams
  // ─────────────────────────────────────────────────────────────────────────

  test('#133: setParams creates new model objects', () => {
    const trainer = new MockTrainer();
    const oldWhite = trainer.modelWhite;
    const oldBlack = trainer.modelBlack;

    simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.notEqual(trainer.modelWhite, oldWhite, 'modelWhite should be a new object');
    assert.notEqual(trainer.modelBlack, oldBlack, 'modelBlack should be a new object');
  });

  test('#133: setParams updates modelParams', () => {
    const trainer = new MockTrainer();
    simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.equal(trainer.modelParams.layers, 4);
    assert.equal(trainer.modelParams.neurons, 256);
  });

  test('#133: setParams resets stats', () => {
    const trainer = new MockTrainer();
    assert.equal(trainer.stats.gamesPlayed, 10);

    simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.equal(trainer.stats.gamesPlayed, 0);
    assert.equal(trainer.stats.whiteWins, 0);
    assert.equal(trainer.stats.lastLoss, null);
  });

  test('#133: BUG — in-flight _playGame captured old model reference before setParams', () => {
    const trainer = new MockTrainer();
    trainer.running = true; // self-play is active

    const result = simulateSetParams(trainer, { layers: 4, neurons: 256 });

    // The in-flight game captured the old models
    assert.notEqual(result.inFlightState.modelWhite, result.newState.modelWhite,
      'In-flight game has old modelWhite — setParams swapped it');
    assert.notEqual(result.inFlightState.modelBlack, result.newState.modelBlack,
      'In-flight game has old modelBlack — setParams swapped it');

    // The in-flight game has old params
    assert.equal(result.inFlightState.modelParams.layers, 3,
      'In-flight game captured layers=3 (old) — setParams set layers=4');
    assert.equal(result.newState.modelParams.layers, 4,
      'New state has layers=4');
  });

  test('#133: BUG — in-flight _playGame uses stale params while new game uses new params', () => {
    const trainer = new MockTrainer();
    trainer.running = true;

    const result = simulateSetParams(trainer, { layers: 5, neurons: 512 });

    // Prove the mismatch
    const inFlightLayers = result.inFlightState.modelParams.layers;
    const newLayers = result.newState.modelParams.layers;
    assert.notEqual(inFlightLayers, newLayers,
      `In-flight game uses layers=${inFlightLayers} but new games use layers=${newLayers}`);

    // The old game's model ID doesn't reflect new params
    assert.equal(result.inFlightState.modelWhite.id, 'initial-white',
      'In-flight model is still the initial one');
    assert.equal(result.newState.modelWhite.id, 'white-5x512',
      'New model reflects the new params');
  });

  test('#133: setParams restarts if was running', () => {
    const trainer = new MockTrainer();
    trainer.running = true;

    const result = simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.equal(result.wasRunning, true);
    assert.equal(trainer.running, true, 'Should restart after setParams');
  });

  test('#133: setParams does not restart if was stopped', () => {
    const trainer = new MockTrainer();
    trainer.running = false;

    const result = simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.equal(result.wasRunning, false);
    assert.equal(trainer.running, false, 'Should not restart if was not running');
  });

  test('#133: buffer is cleared by setParams', () => {
    const trainer = new MockTrainer();
    trainer.buffer._data = [{}, {}, {}]; // some samples

    simulateSetParams(trainer, { layers: 4, neurons: 256 });

    assert.equal(trainer.buffer._data.length, 0, 'Buffer should be cleared');
  });

  // ── Run ─────────────────────────────────────────────────────────────────

  console.log('\n📋 Issues #132, #133, #134 Tests');

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
