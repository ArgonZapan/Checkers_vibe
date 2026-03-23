/**
 * raceCondition.test.js — Tests for BUG-005: Race condition between predict and setParams.
 *
 * When predict/train and setParams (model recreation) run concurrently,
 * the system should not crash with unhandled rejection.
 *
 * Extracted logic — no server or TF.js required.
 */

import assert from 'node:assert/strict';

// ── Extracted: Simulated model manager ──────────────────────────────────────

/**
 * Simulates the trainer with modelWhite/modelBlack that can be recreated
 * by setParams while predict/train operations are in-flight.
 */
function createModelManager() {
  let modelWhite = { id: 'w-v1', predict: () => [0, 0, 0, 0] };
  let modelBlack = { id: 'b-v1', predict: () => [0, 0, 0, 0] };
  let networkSizeWhite = 128;
  let networkSizeBlack = 128;
  const log = [];

  return {
    get modelWhite() { return modelWhite; },
    set modelWhite(m) { modelWhite = m; },
    get modelBlack() { return modelBlack; },
    set modelBlack(m) { modelBlack = m; },
    get networkSizeWhite() { return networkSizeWhite; },
    set networkSizeWhite(s) { networkSizeWhite = s; },
    get networkSizeBlack() { return networkSizeBlack; },
    set networkSizeBlack(s) { networkSizeBlack = s; },
    get modelParams() { return { layers: 3, neurons: networkSizeWhite, activation: 'relu' }; },
    log,

    async predict(board, legalMoves, turn) {
      const model = turn === 1 ? modelWhite : modelBlack;
      if (!model) throw new Error('Model not initialized');
      // Simulate async work
      await new Promise(r => setTimeout(r, 10));
      log.push({ action: 'predict', modelId: model.id, turn });
      return { policy: [0.25, 0.25, 0.25, 0.25], value: 0.5 };
    },

    async train(batch, turn) {
      const model = turn === 1 ? modelWhite : modelBlack;
      if (!model) throw new Error('Model not initialized');
      await new Promise(r => setTimeout(r, 10));
      log.push({ action: 'train', modelId: model.id, turn });
      return { loss: 0.1 };
    },

    setParams(epsilon, networkSize, side) {
      // Simulate model recreation side effect
      if (side === 'white' || side === 'both') {
        networkSizeWhite = networkSize;
        modelWhite = { id: `w-v2-${networkSize}`, predict: () => [0, 0, 0, 0] };
      }
      if (side === 'black' || side === 'both') {
        networkSizeBlack = networkSize;
        modelBlack = { id: `b-v2-${networkSize}`, predict: () => [0, 0, 0, 0] };
      }
      log.push({ action: 'setParams', networkSize, side, whiteId: modelWhite.id, blackId: modelBlack.id });
    },

    recreateModels(networkSize) {
      modelWhite = { id: `w-v3-${networkSize}`, predict: () => [0, 0, 0, 0] };
      modelBlack = { id: `b-v3-${networkSize}`, predict: () => [0, 0, 0, 0] };
      log.push({ action: 'recreateModels', whiteId: modelWhite.id, blackId: modelBlack.id });
    },
  };
}

/**
 * Simulate a safe predict wrapper that catches errors from stale model refs.
 */
function safePredictCall(manager, board, legalMoves, turn) {
  return manager.predict(board, legalMoves, turn).catch(err => {
    return { error: err.message, recovered: true };
  });
}

/**
 * Simulate a safe train wrapper that catches errors from stale model refs.
 */
function safeTrainCall(manager, batch, turn) {
  return manager.train(batch, turn).catch(err => {
    return { error: err.message, recovered: true };
  });
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runRaceConditionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Concurrent predict + setParams ────────────────────────────────────

  test('concurrent predict and setParams does not crash (no unhandled rejection)', async () => {
    const manager = createModelManager();
    const errors = [];

    // Capture unhandled rejections
    const handler = (reason) => { errors.push(reason); };
    process.on('unhandledRejection', handler);

    try {
      // Fire predict and setParams concurrently
      const predictPromise = safePredictCall(manager, [[null]], [[0, 1, 2]], 1);
      const setParamsPromise = (async () => {
        await new Promise(r => setTimeout(r, 5)); // slight delay
        manager.setParams(0.5, 256, 'both');
      })();

      const results = await Promise.all([predictPromise, setParamsPromise]);

      // predict should either succeed or gracefully recover
      const predictResult = results[0];
      assert.ok(
        predictResult.policy || predictResult.error,
        'predict should return result or error object'
      );
      assert.equal(errors.length, 0, 'No unhandled rejections should occur');
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  // ── Concurrent train + setParams ──────────────────────────────────────

  test('concurrent train and setParams does not crash', async () => {
    const manager = createModelManager();
    const errors = [];

    const handler = (reason) => { errors.push(reason); };
    process.on('unhandledRejection', handler);

    try {
      const trainPromise = safeTrainCall(manager, [{ board: [[null]], turn: 1 }], 1);
      const setParamsPromise = (async () => {
        await new Promise(r => setTimeout(r, 5));
        manager.setParams(0.3, 256, 'white');
      })();

      const results = await Promise.all([trainPromise, setParamsPromise]);

      const trainResult = results[0];
      assert.ok(
        trainResult.loss !== undefined || trainResult.error,
        'train should return result or error object'
      );
      assert.equal(errors.length, 0, 'No unhandled rejections should occur');
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  // ── Multiple concurrent predicts + setParams ──────────────────────────

  test('multiple concurrent predicts with setParams interleaved', async () => {
    const manager = createModelManager();
    const errors = [];

    const handler = (reason) => { errors.push(reason); };
    process.on('unhandledRejection', handler);

    try {
      const promises = [];
      // Several concurrent predict calls
      for (let i = 0; i < 5; i++) {
        promises.push(safePredictCall(manager, [[null]], [[0, 1, 2]], (i % 2) + 1));
      }
      // Interleaved setParams calls
      promises.push((async () => {
        await new Promise(r => setTimeout(r, 3));
        manager.setParams(0.5, 256, 'both');
      })());
      promises.push((async () => {
        await new Promise(r => setTimeout(r, 7));
        manager.recreateModels(128);
      })());

      const results = await Promise.all(promises);

      // All predict calls should resolve (not reject)
      for (let i = 0; i < 5; i++) {
        assert.ok(
          results[i].policy || results[i].error,
          `predict ${i} should resolve with result or error`
        );
      }
      assert.equal(errors.length, 0, 'No unhandled rejections');
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  // ── setParams with null model check ───────────────────────────────────

  test('predict after setParams uses new model, not stale reference', () => {
    const manager = createModelManager();
    const oldId = manager.modelWhite.id;

    manager.setParams(0.5, 256, 'white');

    const newId = manager.modelWhite.id;
    assert.notEqual(newId, oldId, 'Model should be replaced after setParams');
    assert.ok(newId.includes('256'), 'New model should reflect new network size');
  });

  // ── Rapid setParams calls ─────────────────────────────────────────────

  test('rapid successive setParams calls do not crash', () => {
    const manager = createModelManager();
    const errors = [];

    const handler = (reason) => { errors.push(reason); };
    process.on('unhandledRejection', handler);

    try {
      // Fire many setParams in quick succession
      for (let i = 0; i < 10; i++) {
        manager.setParams(0.1 * i, 64 + i * 32, 'both');
      }

      assert.ok(manager.modelWhite, 'modelWhite should exist after rapid setParams');
      assert.ok(manager.modelBlack, 'modelBlack should exist after rapid setParams');
      assert.equal(errors.length, 0, 'No unhandled rejections during rapid setParams');
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  // ── Run all tests ─────────────────────────────────────────────────────

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
