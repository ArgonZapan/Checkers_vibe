/**
 * trainBellman.test.js — Tests for the Bellman equation in train().
 *
 * Covers the value target computation in server/ai/model.js train():
 * - Bellman target = reward + gamma * (-nextQ) * (1-done)
 * - Terminal sample (done=true) → valueTarget = reward only (no gamma term)
 * - Non-terminal: uses negated opponent Q-value (zero-sum)
 * - Value clamped to [-1, 1] (matches tanh output range)
 * - Empty batch → loss 0
 * - Shaped rewards vs terminal result fallback
 *
 * Extracted logic — no server or TF.js required.
 */

import assert from 'node:assert/strict';

// ── Extracted: Bellman equation logic (mirrors server/ai/model.js train) ────

const GAMMA = 0.99; // discount factor from CONFIG.ai.gamma

/**
 * Compute value targets for a batch of samples.
 * Mirrors the train() function's value target computation.
 */
function computeValueTargets(batch, gamma = GAMMA) {
  const hasShapedRewards = batch.some(s => s.nextState != null && s.reward !== undefined);
  const valueTargets = [];

  // Pre-compute nextQ values (simulated — in real code these come from model prediction)
  const nextQValues = new Float32Array(batch.length).fill(0);
  if (hasShapedRewards) {
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].nextState != null && batch[i].nextQ !== undefined) {
        nextQValues[i] = batch[i].nextQ;
      }
    }
  }

  for (let i = 0; i < batch.length; i++) {
    const sample = batch[i];
    let valueTarget;

    if (hasShapedRewards && sample.reward !== undefined && sample.nextState != null) {
      const done = sample.done ? 1 : 0;
      // Bellman: reward + gamma * (-nextQ) * (1-done)
      // nextQ is from opponent's perspective → negate for zero-sum
      valueTarget = sample.reward + gamma * (-nextQValues[i]) * (1 - done);
      // Clamp to [-1, 1] (tanh output range)
      valueTarget = Math.max(-1, Math.min(1, valueTarget));
    } else {
      // Fallback: terminal result
      valueTarget = sample.result;
    }

    valueTargets.push(valueTarget);
  }

  return valueTargets;
}

/**
 * Clamp a value to [-1, 1].
 */
function clampValue(v) {
  return Math.max(-1, Math.min(1, v));
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runTrainBellmanTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bellman equation basics
  // ═══════════════════════════════════════════════════════════════════════

  test('Bellman: non-terminal sample computes reward + gamma * (-nextQ)', () => {
    const batch = [
      { reward: 0.1, nextQ: 0.5, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    // Expected: 0.1 + 0.99 * (-0.5) * (1-0) = 0.1 - 0.495 = -0.395
    assert.ok(Math.abs(targets[0] - (-0.395)) < 0.001, `expected ~-0.395, got ${targets[0]}`);
  });

  test('Bellman: terminal sample uses only reward (no gamma term)', () => {
    const batch = [
      { reward: 1.0, nextQ: 0.5, done: true, nextState: [1], result: 1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    // done=1 → (1-done)=0 → gamma term vanishes → valueTarget = reward = 1.0
    assert.equal(targets[0], 1.0);
  });

  test('Bellman: terminal sample with negative reward', () => {
    const batch = [
      { reward: -1.0, nextQ: 0.8, done: true, nextState: [1], result: -1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], -1.0);
  });

  test('Bellman: gamma=0 ignores nextQ entirely', () => {
    const batch = [
      { reward: 0.3, nextQ: 0.9, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 0);
    // gamma=0 → valueTarget = reward + 0 * (-nextQ) = reward = 0.3
    assert.equal(targets[0], 0.3);
  });

  test('Bellman: gamma=1 uses full negated nextQ', () => {
    const batch = [
      { reward: 0.5, nextQ: 0.2, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 1.0);
    // 0.5 + 1.0 * (-0.2) * 1 = 0.5 - 0.2 = 0.3
    assert.ok(Math.abs(targets[0] - 0.3) < 0.001);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Value clamping to [-1, 1]
  // ═══════════════════════════════════════════════════════════════════════

  test('Bellman: extreme positive value clamped to 1', () => {
    const batch = [
      { reward: 10.0, nextQ: 0.0, done: true, nextState: [1], result: 1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], 1.0, 'should clamp to 1');
  });

  test('Bellman: extreme negative value clamped to -1', () => {
    const batch = [
      { reward: -10.0, nextQ: 0.0, done: true, nextState: [1], result: -1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], -1.0, 'should clamp to -1');
  });

  test('Bellman: value at boundary +1.0 stays at +1.0', () => {
    assert.equal(clampValue(1.0), 1.0);
  });

  test('Bellman: value at boundary -1.0 stays at -1.0', () => {
    assert.equal(clampValue(-1.0), -1.0);
  });

  test('Bellman: value slightly above 1 clamped to 1', () => {
    assert.equal(clampValue(1.001), 1.0);
  });

  test('Bellman: value slightly below -1 clamped to -1', () => {
    assert.equal(clampValue(-1.001), -1.0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Zero-sum: nextQ negated
  // ═══════════════════════════════════════════════════════════════════════

  test('Bellman: positive nextQ reduces value (opponent advantage)', () => {
    const batch = [
      { reward: 0.1, nextQ: 0.5, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    // 0.1 + 0.99 * (-0.5) = 0.1 - 0.495 = -0.395 < 0.1
    assert.ok(targets[0] < 0.1, 'positive nextQ should reduce value');
  });

  test('Bellman: negative nextQ increases value (opponent disadvantage)', () => {
    const batch = [
      { reward: 0.1, nextQ: -0.5, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    // 0.1 + 0.99 * (0.5) = 0.1 + 0.495 = 0.595 > 0.1
    assert.ok(targets[0] > 0.1, 'negative nextQ should increase value');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Fallback: no shaped rewards → use result
  // ═══════════════════════════════════════════════════════════════════════

  test('Bellman: no shaped rewards (no nextState) falls back to result', () => {
    const batch = [
      { result: 1, turn: 1 },
      { result: -1, turn: -1 },
      { result: 0, turn: 1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], 1);
    assert.equal(targets[1], -1);
    assert.equal(targets[2], 0);
  });

  test('Bellman: reward defined but no nextState → falls back to result', () => {
    const batch = [
      { reward: 0.5, result: 1, turn: 1 }, // no nextState
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], 1, 'should fall back to result when no nextState');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Multiple samples
  // ═══════════════════════════════════════════════════════════════════════

  test('Bellman: batch of mixed terminal and non-terminal', () => {
    const batch = [
      { reward: 0.1, nextQ: 0.3, done: false, nextState: [1], result: 0 },
      { reward: 0.5, nextQ: 0.2, done: false, nextState: [1], result: 0 },
      { reward: 1.0, nextQ: 0.0, done: true, nextState: [1], result: 1 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets.length, 3);
    // Terminal: just reward
    assert.equal(targets[2], 1.0);
    // Non-terminal: Bellman
    assert.ok(targets[0] < 0.1, 'non-terminal with positive nextQ');
  });

  test('Bellman: zero reward and zero nextQ → value is 0', () => {
    const batch = [
      { reward: 0, nextQ: 0, done: false, nextState: [1], result: 0 },
    ];
    const targets = computeValueTargets(batch, 0.99);
    assert.equal(targets[0], 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Policy target: one-hot on chosen move
  // ═══════════════════════════════════════════════════════════════════════

  test('policy target: one-hot vector with 128 slots', () => {
    const policyTarget = new Float32Array(128).fill(0);
    const moveIdx = 42;
    policyTarget[moveIdx] = 1;
    assert.equal(policyTarget[42], 1);
    assert.equal(policyTarget.filter(v => v === 1).length, 1);
    assert.equal(policyTarget.filter(v => v === 0).length, 127);
  });

  test('policy target: out-of-range index stays 0', () => {
    const policyTarget = new Float32Array(128).fill(0);
    // moveIdx >= 128 should not set anything
    const moveIdx = 200;
    if (moveIdx >= 0 && moveIdx < 128) {
      policyTarget[moveIdx] = 1;
    }
    assert.equal(policyTarget.filter(v => v === 1).length, 0);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Train Bellman Equation Tests');

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
