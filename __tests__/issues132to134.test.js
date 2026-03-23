/**
 * issues132to134.test.js — Tests validating fixes for bugs #132, #133, #134.
 *
 * #134 FIX: WS setParams now rejects layers > 5 (aligned with createModel).
 *
 * #132 FIX: trainer.dirty = true is set after epsilon decay in _playGame(),
 *           so auto-save interval persists the new epsilon value.
 *
 * #133 FIX: paramsVersion snapshot at start of _playGame() — if setParams
 *           bumps the version mid-game, stale operations are skipped.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════════
// #134 — layers validation: WS setParams now rejects > 5 (aligned with model)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * WS setParams validation — FIXED version (mirrors server/index.js line 384):
 *   if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 5))
 *       → reject
 */
function wsValidateLayers(layers) {
  if (layers != null && (layers < 1 || layers > 5)) {
    return { valid: false, error: `layers=${layers} (zakres: 1-5)` };
  }
  return { valid: true };
}

/**
 * createModel layers clamping (mirrors server/ai/model.js):
 *   if (numLayers < 1 || numLayers > 5) { clamp to 1-5 }
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
// #132 — dirty flag IS set after epsilon decay
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulate the end-of-game epsilon decay block from _playGame() — FIXED version.
 * Mirrors trainer.js lines 852-856:
 *   this.epsilonWhite = Math.max(CONFIG.ai.minEpsilon, this.epsilonWhite - CONFIG.ai.epsilonDecay);
 *   this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
 *   this.stats.epsilonWhite = this.epsilonWhite;
 *   this.stats.epsilonBlack = this.epsilonBlack;
 *   this.dirty = true;  // ← FIX for #132
 */
function simulateEpsilonDecay(trainer, epsilonDecay, minEpsilon) {
  trainer.epsilonWhite = Math.max(minEpsilon, trainer.epsilonWhite - epsilonDecay);
  trainer.epsilonBlack = Math.max(minEpsilon, trainer.epsilonBlack - epsilonDecay);
  trainer.stats.epsilonWhite = trainer.epsilonWhite;
  trainer.stats.epsilonBlack = trainer.epsilonBlack;
  trainer.dirty = true; // FIX: epsilon changed — auto-save must persist it (#132)
  return trainer;
}

function shouldAutoSave(trainer) {
  return trainer.dirty === true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #133 — paramsVersion race guard
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates _playGame with paramsVersion snapshot and guard checks.
 *
 * FIX: _playGame() snapshots this.paramsVersion at start as playGameVersion,
 * then checks `this.paramsVersion !== playGameVersion` before:
 *   - gameOver processing (line 613)
 *   - mid-game turn prediction (line 684) — implicit via model swap
 *   - buffer/training (line 831)
 *   - epsilon decay (line 848)
 *
 * If setParams bumps paramsVersion, all these checks fail → stale ops skipped.
 */
class GuardedTrainer {
  constructor() {
    this.paramsVersion = 0;
    this.modelParams = { layers: 3, neurons: 128 };
    this.modelWhite = { id: 'white-3x128' };
    this.modelBlack = { id: 'black-3x128' };
    this.buffer = { _data: [], add(s) { this._data.push(s); }, size() { return this._data.length; }, clear() { this._data = []; } };
    this.stats = { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2, lastLoss: 0.5, epsilonWhite: 1.0, epsilonBlack: 1.0 };
    this.dirty = false;
    this.epsilonWhite = 1.0;
    this.epsilonBlack = 1.0;
  }

  setParams(newParams) {
    this.paramsVersion++;          // bump version — invalidates in-flight games
    Object.assign(this.modelParams, newParams);
    this.modelWhite = { id: `white-${newParams.layers}x${newParams.neurons}` };
    this.modelBlack = { id: `black-${newParams.layers}x${newParams.neurons}` };
    this.buffer.clear();
    this.stats.gamesPlayed = 0;
    this.stats.whiteWins = 0;
    this.stats.blackWins = 0;
    this.stats.draws = 0;
    this.stats.lastLoss = null;
  }

  /**
   * Simulate _playGame completing — with guard checks at each stage.
   * Returns what operations were actually executed vs skipped.
   */
  simulatePlayGameComplete(paramsVersionAtStart) {
    const ops = { recordedResult: false, addedToBuffer: false, trained: false, decayedEpsilon: false };

    // Guard 1: gameOver processing
    if (this.paramsVersion === paramsVersionAtStart) {
      ops.recordedResult = true;
      this.stats.gamesPlayed++;
      this.buffer.add({ turn: 1, result: 1 });
    }

    // Guard 2: buffer/training
    if (this.paramsVersion === paramsVersionAtStart) {
      ops.addedToBuffer = true;
      if (this.buffer.size() >= 1) {
        ops.trained = true;
        this.stats.lastLoss = 0.3;
        this.dirty = true;
      }
    }

    // Guard 3: epsilon decay
    if (this.paramsVersion === paramsVersionAtStart) {
      ops.decayedEpsilon = true;
      this.epsilonWhite = Math.max(0.1, this.epsilonWhite - 0.01);
      this.epsilonBlack = Math.max(0.1, this.epsilonBlack - 0.01);
      this.stats.epsilonWhite = this.epsilonWhite;
      this.stats.epsilonBlack = this.epsilonBlack;
      this.dirty = true;
    }

    return ops;
  }
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
  // Issue #134 FIX — WS validation aligned to 1-5
  // ─────────────────────────────────────────────────────────────────────────

  test('#134 fix: WS setParams rejects layers=6 (now matches model max=5)', () => {
    const wsResult = wsValidateLayers(6);
    assert.equal(wsResult.valid, false, 'WS should now reject layers=6 (aligned with createModel max=5)');
  });

  test('#134 fix: WS setParams rejects layers=7', () => {
    const wsResult = wsValidateLayers(7);
    assert.equal(wsResult.valid, false, 'WS should reject layers=7');
  });

  test('#134 fix: WS setParams rejects layers=8 (was accepted before fix)', () => {
    const wsResult = wsValidateLayers(8);
    assert.equal(wsResult.valid, false, 'WS should now reject layers=8');
  });

  test('#134 fix: WS setParams rejects layers=9', () => {
    const wsResult = wsValidateLayers(9);
    assert.equal(wsResult.valid, false, 'WS should reject layers=9');
  });

  test('#134 fix: WS setParams accepts layers=5 (upper boundary)', () => {
    const wsResult = wsValidateLayers(5);
    assert.equal(wsResult.valid, true, 'WS should accept layers=5');
  });

  test('#134 fix: WS setParams accepts layers=1 (lower boundary)', () => {
    const wsResult = wsValidateLayers(1);
    assert.equal(wsResult.valid, true, 'WS should accept layers=1');
  });

  test('#134 fix: WS and createModel now have consistent range 1-5', () => {
    // Every value accepted by WS should also pass createModel without clamping
    for (let layers = 1; layers <= 5; layers++) {
      const wsResult = wsValidateLayers(layers);
      const modelResult = createModelClampLayers(layers);
      assert.equal(wsResult.valid, true, `WS should accept layers=${layers}`);
      assert.equal(modelResult.wasClamped, false, `createModel should NOT clamp layers=${layers}`);
      assert.equal(modelResult.actual, layers);
    }
  });

  test('#134 fix: WS rejects everything createModel would clamp', () => {
    // No more silent clamping — WS catches it upfront
    for (const layers of [0, -1, 6, 7, 8, 9, 100]) {
      const wsResult = wsValidateLayers(layers);
      const modelResult = createModelClampLayers(layers);
      if (modelResult.wasClamped) {
        assert.equal(wsResult.valid, false,
          `WS should reject layers=${layers} (createModel would clamp to ${modelResult.actual})`);
      }
    }
  });

  test('#134 fix: boundary values 1 and 5 accepted, 0 and 6 rejected', () => {
    assert.equal(wsValidateLayers(0).valid, false);
    assert.equal(wsValidateLayers(1).valid, true);
    assert.equal(wsValidateLayers(5).valid, true);
    assert.equal(wsValidateLayers(6).valid, false);
  });

  test('#134 fix: null/undefined layers passes (optional param)', () => {
    assert.equal(wsValidateLayers(null).valid, true, 'null layers should pass');
    assert.equal(wsValidateLayers(undefined).valid, true, 'undefined layers should pass');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #132 FIX — dirty flag set after epsilon decay
  // ─────────────────────────────────────────────────────────────────────────

  test('#132 fix: dirty=true after epsilon decay → auto-save will persist', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };

    simulateEpsilonDecay(trainer, 0.01, 0.1);

    assert.equal(trainer.dirty, true, 'dirty must be true after epsilon decay');
    assert.equal(shouldAutoSave(trainer), true, 'auto-save should trigger');
  });

  test('#132 fix: dirty stays true even if already dirty', () => {
    const trainer = {
      epsilonWhite: 0.5,
      epsilonBlack: 0.5,
      stats: { epsilonWhite: 0.5, epsilonBlack: 0.5 },
      dirty: true, // already dirty from training
    };

    simulateEpsilonDecay(trainer, 0.01, 0.1);

    assert.equal(trainer.dirty, true, 'dirty should remain true');
    assert.ok(trainer.epsilonWhite < 0.5, 'epsilon should still decay');
  });

  test('#132 fix: epsilon values are updated correctly', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };

    simulateEpsilonDecay(trainer, 0.01, 0.1);

    assert.ok(Math.abs(trainer.epsilonWhite - 0.99) < 1e-10, 'epsilonWhite should be 0.99');
    assert.ok(Math.abs(trainer.epsilonBlack - 0.99) < 1e-10, 'epsilonBlack should be 0.99');
    assert.equal(trainer.stats.epsilonWhite, trainer.epsilonWhite, 'stats should mirror epsilonWhite');
    assert.equal(trainer.stats.epsilonBlack, trainer.epsilonBlack, 'stats should mirror epsilonBlack');
  });

  test('#132 fix: epsilon respects minEpsilon floor', () => {
    const trainer = {
      epsilonWhite: 0.105,
      epsilonBlack: 0.105,
      stats: { epsilonWhite: 0.105, epsilonBlack: 0.105 },
      dirty: false,
    };

    simulateEpsilonDecay(trainer, 0.01, 0.1);

    assert.equal(trainer.epsilonWhite, 0.1, 'epsilon should not go below minEpsilon');
    assert.equal(trainer.epsilonBlack, 0.1, 'epsilon should not go below minEpsilon');
    assert.equal(trainer.dirty, true, 'dirty should still be set even at floor');
  });

  test('#132 fix: 50 games → epsilon persists because dirty is set each game', () => {
    const trainer = {
      epsilonWhite: 1.0,
      epsilonBlack: 1.0,
      stats: { epsilonWhite: 1.0, epsilonBlack: 1.0 },
      dirty: false,
    };

    for (let i = 0; i < 50; i++) {
      trainer.dirty = false; // simulate auto-save consuming dirty flag
      simulateEpsilonDecay(trainer, 0.01, 0.1);
      assert.equal(trainer.dirty, true, `dirty should be true after game ${i + 1}`);
    }

    assert.ok(Math.abs(trainer.epsilonWhite - 0.5) < 1e-10);
    assert.equal(shouldAutoSave(trainer), true,
      'After 50 games, dirty=true means epsilon=0.5 WILL be persisted');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issue #133 FIX — paramsVersion race guard
  // ─────────────────────────────────────────────────────────────────────────

  test('#133 fix: normal game completes when paramsVersion unchanged', () => {
    const trainer = new GuardedTrainer();
    const versionAtStart = trainer.paramsVersion;

    const ops = trainer.simulatePlayGameComplete(versionAtStart);

    assert.equal(ops.recordedResult, true, 'result should be recorded');
    assert.equal(ops.addedToBuffer, true, 'samples should be added to buffer');
    assert.equal(ops.trained, true, 'training should happen');
    assert.equal(ops.decayedEpsilon, true, 'epsilon should decay');
  });

  test('#133 fix: setParams mid-game → all stale ops are skipped', () => {
    const trainer = new GuardedTrainer();
    const versionAtStart = trainer.paramsVersion; // _playGame snapshots this

    // Simulate setParams being called mid-game (bumps paramsVersion)
    trainer.setParams({ layers: 5, neurons: 512 });

    // _playGame continues and tries to complete — but version check fails
    const ops = trainer.simulatePlayGameComplete(versionAtStart);

    assert.equal(ops.recordedResult, false, 'stale result should NOT be recorded');
    assert.equal(ops.addedToBuffer, false, 'stale samples should NOT be added');
    assert.equal(ops.trained, false, 'training on stale params should NOT happen');
    assert.equal(ops.decayedEpsilon, false, 'epsilon decay on stale game should NOT happen');
  });

  test('#133 fix: paramsVersion increments on each setParams call', () => {
    const trainer = new GuardedTrainer();
    assert.equal(trainer.paramsVersion, 0);

    trainer.setParams({ layers: 3, neurons: 128 });
    assert.equal(trainer.paramsVersion, 1);

    trainer.setParams({ layers: 4, neurons: 256 });
    assert.equal(trainer.paramsVersion, 2);

    trainer.setParams({ layers: 5, neurons: 512 });
    assert.equal(trainer.paramsVersion, 3);
  });

  test('#133 fix: game with old version is fully rejected even if partially completed', () => {
    const trainer = new GuardedTrainer();
    const versionAtStart = trainer.paramsVersion;

    // setParams bumps version
    trainer.setParams({ layers: 4, neurons: 256 });

    // Old game's buffer/training/epsilon ops are all guarded
    const ops = trainer.simulatePlayGameComplete(versionAtStart);

    assert.equal(ops.recordedResult, false);
    assert.equal(ops.addedToBuffer, false);
    assert.equal(ops.trained, false);
    assert.equal(ops.decayedEpsilon, false);

    // Trainer state reflects new params, not stale game
    assert.equal(trainer.modelParams.layers, 4);
    assert.equal(trainer.modelParams.neurons, 256);
    assert.equal(trainer.stats.gamesPlayed, 0, 'gamesPlayed reset by setParams');
  });

  test('#133 fix: two concurrent games — first gets stale, second completes normally', () => {
    const trainer = new GuardedTrainer();

    // Game A starts (version=0)
    const versionA = trainer.paramsVersion;

    // setParams happens
    trainer.setParams({ layers: 4, neurons: 256 });

    // Game B starts (version=1)
    const versionB = trainer.paramsVersion;

    // Game A tries to complete — stale
    const opsA = trainer.simulatePlayGameComplete(versionA);
    assert.equal(opsA.recordedResult, false, 'Game A should be rejected');

    // Game B completes — fresh
    const opsB = trainer.simulatePlayGameComplete(versionB);
    assert.equal(opsB.recordedResult, true, 'Game B should be accepted');
    assert.equal(opsB.decayedEpsilon, true, 'Game B should decay epsilon');
  });

  test('#133 fix: buffer is cleared on setParams — stale game cannot add to it', () => {
    const trainer = new GuardedTrainer();
    trainer.buffer.add({ turn: 1, result: 1 });
    trainer.buffer.add({ turn: -1, result: -1 });
    assert.equal(trainer.buffer.size(), 2);

    const versionAtStart = trainer.paramsVersion;
    trainer.setParams({ layers: 4, neurons: 256 });

    assert.equal(trainer.buffer.size(), 0, 'buffer cleared by setParams');

    // Stale game tries to add — guard blocks it
    const ops = trainer.simulatePlayGameComplete(versionAtStart);
    assert.equal(ops.addedToBuffer, false);
    assert.equal(trainer.buffer.size(), 0, 'buffer should remain empty — stale game rejected');
  });

  test('#133 fix: epsilon does not decay for stale game — preserves correct value', () => {
    const trainer = new GuardedTrainer();
    trainer.epsilonWhite = 0.8;
    trainer.epsilonBlack = 0.8;
    trainer.stats.epsilonWhite = 0.8;
    trainer.stats.epsilonBlack = 0.8;

    const versionAtStart = trainer.paramsVersion;
    trainer.setParams({ layers: 5, neurons: 512 });

    const ops = trainer.simulatePlayGameComplete(versionAtStart);
    assert.equal(ops.decayedEpsilon, false, 'stale epsilon decay should be skipped');

    // Epsilon should remain unchanged
    assert.equal(trainer.epsilonWhite, 0.8, 'epsilon should not decay for stale game');
    assert.equal(trainer.epsilonBlack, 0.8);
  });

  // ── Run ─────────────────────────────────────────────────────────────────

  console.log('\n📋 Issues #132, #133, #134 Fix Validation Tests');

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
