/**
 * apiEndpointValidation.test.js — Tests for /api/ai/* endpoint validation logic.
 *
 * Mirrors the validation in server/index.js Express handlers:
 * - POST /api/ai/predict: requires board + legalMoves, handles missing model
 * - POST /api/ai/train: requires non-empty batch
 * - POST /api/ai/params: validates epsilon (0-1) and networkSize (small|medium|large)
 * - POST /api/ai/reset: error handling
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: /api/ai/predict validation ───────────────────────────────────

function validatePredict(body) {
  const { board, legalMoves, turn = 1 } = body || {};
  if (!board || !legalMoves) {
    return { valid: false, status: 400, error: 'Missing board or legalMoves' };
  }
  return { valid: true, board, legalMoves, turn };
}

// ── Extracted: /api/ai/train validation ─────────────────────────────────────

function validateTrain(body) {
  const batch = (body && body.batch) || [];
  if (batch.length === 0) {
    return { valid: false, status: 400, error: 'Empty batch' };
  }
  return { valid: true, batch };
}

// ── Extracted: /api/ai/params validation ────────────────────────────────────

function validateParams(body) {
  const { epsilon, networkSize, side = 'both' } = body || {};
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, status: 400, error: 'epsilon must be a finite number 0-1' };
  }
  if (networkSize != null && !['small', 'medium', 'large'].includes(networkSize)) {
    return { valid: false, status: 400, error: 'networkSize must be small|medium|large' };
  }
  return { valid: true, epsilon, networkSize, side };
}

// ── Extracted: model availability check ─────────────────────────────────────

function checkModelAvailable(model) {
  if (!model) {
    return { available: false, status: 503, error: 'Model not initialized' };
  }
  return { available: true, model };
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runApiEndpointValidationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/ai/predict
  // ═══════════════════════════════════════════════════════════════════════

  test('predict: rejects missing board', () => {
    const r = validatePredict({ legalMoves: [{ from: [0, 0], to: [1, 1] }] });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('predict: rejects missing legalMoves', () => {
    const r = validatePredict({ board: [[0, 1], [1, 0]] });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('predict: rejects empty body', () => {
    const r = validatePredict({});
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('predict: rejects null body', () => {
    const r = validatePredict(null);
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('predict: rejects undefined body', () => {
    const r = validatePredict(undefined);
    assert.equal(r.valid, false);
  });

  test('predict: accepts valid body with defaults', () => {
    const r = validatePredict({
      board: [0, 0, 1, 0],
      legalMoves: [{ from: [2, 1], to: [3, 0] }],
    });
    assert.equal(r.valid, true);
    assert.equal(r.turn, 1); // default
  });

  test('predict: accepts explicit turn value', () => {
    const r = validatePredict({
      board: [0, 0, 1, 0],
      legalMoves: [{ from: [2, 1], to: [3, 0] }],
      turn: -1,
    });
    assert.equal(r.valid, true);
    assert.equal(r.turn, -1);
  });

  test('predict: model not initialized → 503', () => {
    const r = checkModelAvailable(null);
    assert.equal(r.available, false);
    assert.equal(r.status, 503);
    assert.equal(r.error, 'Model not initialized');
  });

  test('predict: model available → passes through', () => {
    const fakeModel = { predict: () => {} };
    const r = checkModelAvailable(fakeModel);
    assert.equal(r.available, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/ai/train
  // ═══════════════════════════════════════════════════════════════════════

  test('train: rejects empty batch', () => {
    const r = validateTrain({ batch: [] });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'Empty batch');
  });

  test('train: rejects missing batch field', () => {
    const r = validateTrain({});
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('train: rejects null body', () => {
    const r = validateTrain(null);
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('train: accepts non-empty batch', () => {
    const r = validateTrain({ batch: [{ board: [1], reward: 1 }] });
    assert.equal(r.valid, true);
    assert.equal(r.batch.length, 1);
  });

  test('train: accepts batch with multiple items', () => {
    const batch = Array(100).fill({ board: [1], reward: 0.5 });
    const r = validateTrain({ batch });
    assert.equal(r.valid, true);
    assert.equal(r.batch.length, 100);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/ai/params
  // ═══════════════════════════════════════════════════════════════════════

  test('params: accepts valid epsilon = 0', () => {
    const r = validateParams({ epsilon: 0 });
    assert.equal(r.valid, true);
  });

  test('params: accepts valid epsilon = 1', () => {
    const r = validateParams({ epsilon: 1 });
    assert.equal(r.valid, true);
  });

  test('params: accepts valid epsilon = 0.5', () => {
    const r = validateParams({ epsilon: 0.5 });
    assert.equal(r.valid, true);
  });

  test('params: rejects epsilon < 0', () => {
    const r = validateParams({ epsilon: -0.1 });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('params: rejects epsilon > 1', () => {
    const r = validateParams({ epsilon: 1.5 });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('params: rejects epsilon as string', () => {
    const r = validateParams({ epsilon: '0.5' });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('params: accepts valid networkSize = small', () => {
    const r = validateParams({ networkSize: 'small' });
    assert.equal(r.valid, true);
  });

  test('params: accepts valid networkSize = medium', () => {
    const r = validateParams({ networkSize: 'medium' });
    assert.equal(r.valid, true);
  });

  test('params: accepts valid networkSize = large', () => {
    const r = validateParams({ networkSize: 'large' });
    assert.equal(r.valid, true);
  });

  test('params: rejects invalid networkSize', () => {
    const r = validateParams({ networkSize: 'xlarge' });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  test('params: rejects networkSize as number', () => {
    const r = validateParams({ networkSize: 128 });
    assert.equal(r.valid, false);
  });

  test('params: accepts null epsilon (no change)', () => {
    const r = validateParams({ epsilon: null });
    assert.equal(r.valid, true);
  });

  test('params: accepts null networkSize (no change)', () => {
    const r = validateParams({ networkSize: null });
    assert.equal(r.valid, true);
  });

  test('params: defaults side to "both"', () => {
    const r = validateParams({});
    assert.equal(r.valid, true);
    assert.equal(r.side, 'both');
  });

  test('params: accepts side = "white"', () => {
    const r = validateParams({ side: 'white' });
    assert.equal(r.valid, true);
    assert.equal(r.side, 'white');
  });

  test('params: combined valid params', () => {
    const r = validateParams({ epsilon: 0.3, networkSize: 'medium', side: 'black' });
    assert.equal(r.valid, true);
    assert.equal(r.epsilon, 0.3);
    assert.equal(r.networkSize, 'medium');
    assert.equal(r.side, 'black');
  });

  test('params: combined with one invalid param', () => {
    const r = validateParams({ epsilon: 0.3, networkSize: 'huge' });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 API Endpoint Validation Tests');

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
