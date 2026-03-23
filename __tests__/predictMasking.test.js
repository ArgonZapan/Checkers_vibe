/**
 * predictMasking.test.js — Tests for predict() policy masking with legalMoves.
 *
 * Tests that predict() correctly:
 * - Uses policy indices (not array positions) for move selection
 * - Handles 1, 5, and all 48 legal moves
 * - Returns null/fallback gracefully when legalMoves=[] or invalid
 * - Applies softmax over legal move policy indices only
 *
 * Mocks the model (tf.js not required in test env).
 */

import assert from 'node:assert/strict';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a mock model that returns a deterministic policy vector.
 * policyArr: Float32Array(48) or number[48] — raw logits
 * value: scalar value output (default 0.5)
 */
function mockModel(policyArr, value = 0.5) {
  return {
    predictOnBatch() {
      // Return [policyTensor, valueTensor] with .data() async methods
      const policyData = Float32Array.from(policyArr);
      const valueData = Float32Array.from([value]);
      return [
        { data: async () => policyData, dispose() {} },
        { data: async () => valueData, dispose() {} },
      ];
    }
  };
}

/**
 * Simplified predict() implementation mirroring server/ai/model.js predict().
 * Extracted for testing without tf.js dependency.
 */
async function predict(model, boardArray, legalMoves, turn = 1) {
  const [policyTensor, valueTensor] = model.predictOnBatch(null);
  const policy = await policyTensor.data();
  const value = (await valueTensor.data())[0];

  // Mask illegal moves
  const legalIndices = legalMoves.map(m => {
    if (typeof m === 'number') return m;
    return m.index ?? m;
  });

  if (legalIndices.length === 0) {
    return { move: null, probabilities: {}, value: 0 };
  }

  let maskedPolicy = Array.from(policy);

  // Compute softmax probabilities for legal moves (temperature=1.0)
  const expProbs = {};
  let maxLogit = -Infinity;
  for (const idx of legalIndices) {
    const val = maskedPolicy[idx] || 0;
    if (val > maxLogit) maxLogit = val;
  }
  let totalExp = 0;
  for (const idx of legalIndices) {
    expProbs[idx] = Math.exp((maskedPolicy[idx] || 0) - maxLogit);
    totalExp += expProbs[idx];
  }
  const normalizedProbs = {};
  for (const idx of legalIndices) {
    normalizedProbs[idx] = expProbs[idx] / totalExp;
  }

  // Deterministic selection: pick argmax (for test determinism)
  let bestIdx = legalIndices[0];
  let bestProb = -Infinity;
  for (const idx of legalIndices) {
    if (normalizedProbs[idx] > bestProb) {
      bestProb = normalizedProbs[idx];
      bestIdx = idx;
    }
  }

  // Find the move with matching index
  const selectedMove = legalMoves.find(m => (typeof m === 'number' ? m : m.index ?? m) === bestIdx)
    || legalMoves[0];

  return {
    move: selectedMove,
    probabilities: normalizedProbs,
    value
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runPredictMaskingTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── 1 legal move ──────────────────────────────────────────────────────

  test('predict with 1 legal move: always selects it', async () => {
    // Policy has 48 entries; only index 25 is legal
    const policy = new Float32Array(48).fill(-10);
    policy[25] = 10; // high logit at index 25

    const model = mockModel(policy, 0.8);
    const legalMoves = [{ from: 12, to: 16, captures: [], index: 25 }];

    const result = await predict(model, null, legalMoves, 1);

    assert.equal(result.move.from, 12, 'Selected move has correct from');
    assert.equal(result.move.to, 16, 'Selected move has correct to');
    assert.equal(result.move.index, 25, 'Selected move has correct index');
    assert.ok(Math.abs(result.value - 0.8) < 0.001, 'Value returned correctly');
    // Probabilities: only one legal move, so prob should be 1.0
    assert.ok(Math.abs(result.probabilities[25] - 1.0) < 0.001, 'Single move has probability 1.0');
  });

  // ── 5 legal moves ─────────────────────────────────────────────────────

  test('predict with 5 legal moves: selects highest policy index', async () => {
    // Legal moves at indices 3, 7, 15, 30, 42
    // Set policy so index 15 has the highest value
    const policy = new Float32Array(48).fill(0);
    policy[3] = 1;
    policy[7] = 2;
    policy[15] = 10; // highest
    policy[30] = 3;
    policy[42] = 4;

    const model = mockModel(policy, 0.3);
    const legalMoves = [
      { from: 0, to: 4, captures: [], index: 3 },
      { from: 1, to: 5, captures: [], index: 7 },
      { from: 8, to: 12, captures: [], index: 15 },
      { from: 20, to: 24, captures: [], index: 30 },
      { from: 35, to: 42, captures: [], index: 42 },
    ];

    const result = await predict(model, null, legalMoves, 1);

    assert.equal(result.move.index, 15, 'Selects move with highest policy logit');
    assert.equal(result.move.from, 8, 'Correct from for selected move');
    assert.equal(result.move.to, 12, 'Correct to for selected move');

    // All probabilities should be present and sum to 1
    const probs = Object.values(result.probabilities);
    const sum = probs.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, 'Probabilities sum to 1');

    // Verify all legal indices are in probabilities
    for (const m of legalMoves) {
      assert.ok(m.index in result.probabilities, `Index ${m.index} has probability`);
    }
  });

  test('predict with 5 legal moves: uses policy index not array position', async () => {
    // This is the critical test: policy[40] is high, but it's the 3rd move in the array
    // The bug would be using array position (2) instead of policy index (40)
    const policy = new Float32Array(48).fill(0);
    policy[40] = 100; // very high at index 40
    policy[5] = 1;
    policy[10] = 2;
    policy[20] = 3;
    policy[30] = 4;

    const model = mockModel(policy, 0);
    const legalMoves = [
      { from: 0, to: 4, captures: [], index: 5 },
      { from: 8, to: 12, captures: [], index: 10 },
      { from: 16, to: 20, captures: [], index: 20 },  // array position 2
      { from: 24, to: 28, captures: [], index: 30 },
      { from: 36, to: 40, captures: [], index: 40 },  // policy index 40, array position 4
    ];

    const result = await predict(model, null, legalMoves, 1);

    // Must select the move at policy index 40, NOT array position 40 (which doesn't exist)
    assert.equal(result.move.index, 40, 'Uses policy index 40, not array position');
    assert.equal(result.move.from, 36, 'Correct move selected by policy index');
  });

  // ── All 48 moves ──────────────────────────────────────────────────────

  test('predict with all 48 moves: selects correct one by policy index', async () => {
    // Create 48 legal moves, each with index = i
    const legalMoves = [];
    for (let i = 0; i < 48; i++) {
      legalMoves.push({ from: i, to: i + 1, captures: [], index: i });
    }

    // Set policy so index 47 is highest
    const policy = new Float32Array(48).fill(0);
    for (let i = 0; i < 48; i++) policy[i] = i; // increasing
    policy[47] = 100;

    const model = mockModel(policy, -0.5);
    const result = await predict(model, null, legalMoves, 1);

    assert.equal(result.move.index, 47, 'Selects index 47 (highest policy)');
    assert.equal(result.move.from, 47, 'Correct from');
    assert.ok(Math.abs(result.value - (-0.5)) < 0.001, 'Value correct');

    // All 48 probabilities present
    assert.equal(Object.keys(result.probabilities).length, 48, 'All 48 moves have probabilities');

    // Sum to 1
    const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, 'Probabilities sum to 1');
  });

  test('predict with all 48 moves: even low policy indices work', async () => {
    const legalMoves = [];
    for (let i = 0; i < 48; i++) {
      legalMoves.push({ from: i, to: i + 1, captures: [], index: i });
    }

    // Index 0 is highest
    const policy = new Float32Array(48).fill(0);
    policy[0] = 50;

    const model = mockModel(policy, 1.0);
    const result = await predict(model, null, legalMoves, 1);

    assert.equal(result.move.index, 0, 'Selects index 0 (highest)');
    assert.equal(result.move.from, 0, 'Correct from');
  });

  // ── Empty / invalid legalMoves ─────────────────────────────────────────

  test('predict with empty legalMoves: returns null move gracefully', async () => {
    const policy = new Float32Array(48).fill(1);
    const model = mockModel(policy, 0.5);

    const result = await predict(model, null, [], 1);

    assert.equal(result.move, null, 'Empty legalMoves returns null move');
    assert.deepEqual(result.probabilities, {}, 'Empty probabilities');
    assert.equal(result.value, 0, 'Value is 0 for empty legalMoves');
  });

  test('predict with numeric legalMoves (not objects)', async () => {
    // Some code paths pass legalMoves as plain numbers (policy indices)
    const policy = new Float32Array(48).fill(0);
    policy[10] = 5;
    policy[20] = 8; // highest
    policy[30] = 3;

    const model = mockModel(policy, 0.2);
    const legalMoves = [10, 20, 30]; // plain numbers

    const result = await predict(model, null, legalMoves, 1);

    // bestIdx should be 20, and since legalMoves are numbers, the selected move should be 20
    assert.equal(result.move, 20, 'Selects highest numeric index');
  });

  test('predict: probability distribution is valid (non-negative, sums to 1)', async () => {
    const policy = new Float32Array(48).fill(0);
    policy[5] = 10;
    policy[15] = 5;
    policy[25] = 1;
    policy[35] = -5;

    const model = mockModel(policy, 0);
    const legalMoves = [
      { from: 0, to: 4, captures: [], index: 5 },
      { from: 8, to: 12, captures: [], index: 15 },
      { from: 16, to: 20, captures: [], index: 25 },
      { from: 24, to: 28, captures: [], index: 35 },
    ];

    const result = await predict(model, null, legalMoves, 1);

    for (const [idx, prob] of Object.entries(result.probabilities)) {
      assert.ok(prob >= 0, `Probability at index ${idx} is non-negative: ${prob}`);
      assert.ok(prob <= 1, `Probability at index ${idx} is <= 1: ${prob}`);
    }

    const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, 'Probabilities sum to 1');
  });

  test('predict: softmax reduces to argmax with extreme logits', async () => {
    const policy = new Float32Array(48).fill(0);
    policy[3] = 1000; // extremely high
    policy[7] = 0;
    policy[11] = -1000;

    const model = mockModel(policy, 0);
    const legalMoves = [
      { from: 0, to: 4, captures: [], index: 3 },
      { from: 1, to: 5, captures: [], index: 7 },
      { from: 2, to: 6, captures: [], index: 11 },
    ];

    const result = await predict(model, null, legalMoves, 1);

    assert.equal(result.move.index, 3, 'Extreme logit dominates selection');
    assert.ok(result.probabilities[3] > 0.999, 'Probability near 1.0 for dominant logit');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Predict Masking Tests');

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
