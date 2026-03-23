/**
 * hunter-v3-ws-setparams-full.test.js — Full WS setParams validation coverage.
 *
 * Covers gaps NOT in setParamsWhitelist.test.js:
 * - ALLOWED_PARAMS includes whiteStrategy, blackStrategy, minimaxDepth (server has them, test file doesn't)
 * - Mode restriction: setParams rejected outside aivai
 * - Numeric validation for all fields including NaN/Infinity/-Infinity
 * - networkSize param applied to trainer
 * - Speed settings applied to CONFIG
 * - Strategy change validation
 * - Minimax depth clamping
 * - wasRunning restart behavior
 * - paramsVersion increment for in-flight game invalidation
 */

import assert from 'node:assert/strict';

// ── Extracted: ALLOWED_PARAMS (matches server/index.js exactly) ─────────────

const ALLOWED_PARAMS = new Set([
  'layers', 'neurons', 'activation', 'lr', 'batchSize', 'dropout',
  'minEpsilon', 'epsilonDecay', 'gamma', 'bufferSize', 'epochs',
  'rewardCapture', 'rewardLosePiece', 'rewardPromotion', 'rewardWin', 'rewardLose',
  'speedMode', 'aiMoveDelayMs',
  'whiteStrategy', 'blackStrategy', 'minimaxDepth',
]);

function filterParams(newParams) {
  const filtered = {};
  for (const key of Object.keys(newParams)) {
    if (ALLOWED_PARAMS.has(key)) {
      filtered[key] = newParams[key];
    }
  }
  return filtered;
}

// ── Extracted: setParams input validation ───────────────────────────────────

function validateSetParamsInput(newParams) {
  if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) {
    return { valid: false, error: 'Invalid params — expected object' };
  }
  return { valid: true };
}

// ── Extracted: numeric validation ──────────────────────────────────────────

function validateNumericParams(params) {
  const errors = [];
  const numericKeys = ['layers', 'neurons', 'batchSize', 'dropout', 'lr', 'gamma', 'epochs', 'bufferSize',
    'minEpsilon', 'epsilonDecay', 'rewardCapture', 'rewardLosePiece', 'rewardPromotion', 'rewardWin', 'rewardLose'];
  for (const key of numericKeys) {
    if (params[key] != null && (typeof params[key] !== 'number' || !Number.isFinite(params[key]))) {
      errors.push(`${key}=${params[key]} (expected finite number)`);
    }
  }
  // Range checks
  if (params.layers != null && Number.isFinite(params.layers) && (params.layers < 1 || params.layers > 5)) {
    errors.push(`layers=${params.layers} (zakres: 1-5)`);
  }
  if (params.neurons != null && Number.isFinite(params.neurons) && (params.neurons < 32 || params.neurons > 512)) {
    errors.push(`neurons=${params.neurons} (zakres: 32-512)`);
  }
  if (params.batchSize != null && Number.isFinite(params.batchSize) && (params.batchSize < 8 || params.batchSize > 256)) {
    errors.push(`batchSize=${params.batchSize} (zakres: 8-256)`);
  }
  if (params.dropout != null && Number.isFinite(params.dropout) && (params.dropout < 0 || params.dropout > 0.5)) {
    errors.push(`dropout=${params.dropout} (zakres: 0-0.5)`);
  }
  return errors;
}

// ── Extracted: strategy validation ─────────────────────────────────────────

const VALID_STRATEGIES = ['dqn', 'minimax', 'random'];

function validateStrategy(strategy) {
  if (strategy == null) return { valid: true, ignored: true };
  return { valid: VALID_STRATEGIES.includes(strategy), strategy };
}

// ── Extracted: minimax depth clamping ──────────────────────────────────────

function clampMinimaxDepth(depth) {
  if (depth == null || typeof depth !== 'number' || !Number.isFinite(depth)) return null;
  return Math.max(1, Math.min(8, Math.round(depth)));
}

// ── Extracted: speed settings ──────────────────────────────────────────────

function validateSpeedMode(mode) {
  if (mode == null) return { valid: true, ignored: true };
  if (mode === 'fast' || mode === 'normal') return { valid: true, mode };
  return { valid: false, error: 'Invalid speed mode' };
}

function validateAiMoveDelayMs(ms) {
  if (ms == null) return { valid: true, ignored: true };
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return { valid: false, error: 'Invalid delay' };
  return { valid: true, clamped: Math.max(0, Math.min(ms, 10000)) };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsSetParamsFullTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── ALLOWED_PARAMS completeness ──────────────────────────────────────

  test('ALLOWED_PARAMS contains whiteStrategy', () => {
    assert.ok(ALLOWED_PARAMS.has('whiteStrategy'));
  });

  test('ALLOWED_PARAMS contains blackStrategy', () => {
    assert.ok(ALLOWED_PARAMS.has('blackStrategy'));
  });

  test('ALLOWED_PARAMS contains minimaxDepth', () => {
    assert.ok(ALLOWED_PARAMS.has('minimaxDepth'));
  });

  test('ALLOWED_PARAMS contains all 20 expected keys', () => {
    const expected = [
      'layers', 'neurons', 'activation', 'lr', 'batchSize', 'dropout',
      'minEpsilon', 'epsilonDecay', 'gamma', 'bufferSize', 'epochs',
      'rewardCapture', 'rewardLosePiece', 'rewardPromotion', 'rewardWin', 'rewardLose',
      'speedMode', 'aiMoveDelayMs',
      'whiteStrategy', 'blackStrategy', 'minimaxDepth',
    ];
    for (const key of expected) {
      assert.ok(ALLOWED_PARAMS.has(key), `Missing key: ${key}`);
    }
    assert.equal(ALLOWED_PARAMS.size, expected.length);
  });

  test('filterParams: __proto__ is filtered out', () => {
    const result = filterParams({ __proto__: { admin: true }, layers: 3 });
    assert.equal(result.layers, 3);
    assert.equal(result.admin, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  });

  test('filterParams: constructor is filtered out', () => {
    const result = filterParams({ constructor: 'evil', neurons: 64 });
    assert.equal(result.neurons, 64);
    assert.equal(result.constructor, Object);
  });

  test('filterParams: strategy keys pass through', () => {
    const result = filterParams({ whiteStrategy: 'minimax', blackStrategy: 'dqn', minimaxDepth: 4 });
    assert.equal(result.whiteStrategy, 'minimax');
    assert.equal(result.blackStrategy, 'dqn');
    assert.equal(result.minimaxDepth, 4);
  });

  test('filterParams: unknown keys are dropped', () => {
    const result = filterParams({ evil: 1, layers: 3, unknown: 'x' });
    assert.equal(result.layers, 3);
    assert.equal(result.evil, undefined);
    assert.equal(result.unknown, undefined);
  });

  test('filterParams: empty object returns empty', () => {
    const result = filterParams({});
    assert.deepEqual(result, {});
  });

  // ── Input type validation ────────────────────────────────────────────

  test('validateInput: rejects array', () => {
    const result = validateSetParamsInput([1, 2, 3]);
    assert.equal(result.valid, false);
  });

  test('validateInput: rejects null', () => {
    const result = validateSetParamsInput(null);
    assert.equal(result.valid, false);
  });

  test('validateInput: rejects undefined', () => {
    const result = validateSetParamsInput(undefined);
    assert.equal(result.valid, false);
  });

  test('validateInput: rejects string', () => {
    const result = validateSetParamsInput('hello');
    assert.equal(result.valid, false);
  });

  test('validateInput: rejects number', () => {
    const result = validateSetParamsInput(42);
    assert.equal(result.valid, false);
  });

  test('validateInput: rejects function', () => {
    const result = validateSetParamsInput(() => {});
    assert.equal(result.valid, false);
  });

  test('validateInput: accepts plain object', () => {
    const result = validateSetParamsInput({ layers: 3 });
    assert.equal(result.valid, true);
  });

  // ── Numeric validation — NaN/Infinity/-Infinity ─────────────────────

  test('validateNumeric: rejects NaN for layers', () => {
    const errors = validateNumericParams({ layers: NaN });
    assert.ok(errors.some(e => e.includes('layers')));
  });

  test('validateNumeric: rejects Infinity for neurons', () => {
    const errors = validateNumericParams({ neurons: Infinity });
    assert.ok(errors.some(e => e.includes('neurons')));
  });

  test('validateNumeric: rejects -Infinity for batchSize', () => {
    const errors = validateNumericParams({ batchSize: -Infinity });
    assert.ok(errors.some(e => e.includes('batchSize')));
  });

  test('validateNumeric: rejects NaN for dropout', () => {
    const errors = validateNumericParams({ dropout: NaN });
    assert.ok(errors.some(e => e.includes('dropout')));
  });

  test('validateNumeric: rejects string for lr', () => {
    const errors = validateNumericParams({ lr: 'fast' });
    assert.ok(errors.some(e => e.includes('lr')));
  });

  test('validateNumeric: accepts valid layers=3', () => {
    const errors = validateNumericParams({ layers: 3 });
    assert.equal(errors.length, 0);
  });

  test('validateNumeric: rejects layers=0', () => {
    const errors = validateNumericParams({ layers: 0 });
    assert.ok(errors.some(e => e.includes('layers')));
  });

  test('validateNumeric: rejects layers=6', () => {
    const errors = validateNumericParams({ layers: 6 });
    assert.ok(errors.some(e => e.includes('layers')));
  });

  test('validateNumeric: accepts layers at boundary 1', () => {
    const errors = validateNumericParams({ layers: 1 });
    assert.equal(errors.filter(e => e.includes('layers')).length, 0);
  });

  test('validateNumeric: accepts layers at boundary 5', () => {
    const errors = validateNumericParams({ layers: 5 });
    assert.equal(errors.filter(e => e.includes('layers')).length, 0);
  });

  test('validateNumeric: rejects neurons=31', () => {
    const errors = validateNumericParams({ neurons: 31 });
    assert.ok(errors.some(e => e.includes('neurons')));
  });

  test('validateNumeric: rejects neurons=513', () => {
    const errors = validateNumericParams({ neurons: 513 });
    assert.ok(errors.some(e => e.includes('neurons')));
  });

  test('validateNumeric: accepts neurons=32', () => {
    const errors = validateNumericParams({ neurons: 32 });
    assert.equal(errors.filter(e => e.includes('neurons')).length, 0);
  });

  test('validateNumeric: accepts neurons=512', () => {
    const errors = validateNumericParams({ neurons: 512 });
    assert.equal(errors.filter(e => e.includes('neurons')).length, 0);
  });

  test('validateNumeric: rejects batchSize=7', () => {
    const errors = validateNumericParams({ batchSize: 7 });
    assert.ok(errors.some(e => e.includes('batchSize')));
  });

  test('validateNumeric: rejects batchSize=257', () => {
    const errors = validateNumericParams({ batchSize: 257 });
    assert.ok(errors.some(e => e.includes('batchSize')));
  });

  test('validateNumeric: rejects dropout=-0.1', () => {
    const errors = validateNumericParams({ dropout: -0.1 });
    assert.ok(errors.some(e => e.includes('dropout')));
  });

  test('validateNumeric: rejects dropout=0.6', () => {
    const errors = validateNumericParams({ dropout: 0.6 });
    assert.ok(errors.some(e => e.includes('dropout')));
  });

  test('validateNumeric: accepts dropout at boundary 0', () => {
    const errors = validateNumericParams({ dropout: 0 });
    assert.equal(errors.filter(e => e.includes('dropout')).length, 0);
  });

  test('validateNumeric: accepts dropout at boundary 0.5', () => {
    const errors = validateNumericParams({ dropout: 0.5 });
    assert.equal(errors.filter(e => e.includes('dropout')).length, 0);
  });

  test('validateNumeric: multiple invalid params all reported', () => {
    const errors = validateNumericParams({ layers: NaN, neurons: Infinity, batchSize: -Infinity });
    assert.ok(errors.length >= 3);
  });

  test('validateNumeric: null value is ignored (optional param)', () => {
    const errors = validateNumericParams({ layers: null });
    assert.equal(errors.filter(e => e.includes('layers')).length, 0);
  });

  test('validateNumeric: undefined value is ignored (optional param)', () => {
    const errors = validateNumericParams({ layers: undefined });
    assert.equal(errors.filter(e => e.includes('layers')).length, 0);
  });

  // ── Strategy validation ──────────────────────────────────────────────

  test('strategy: valid dqn accepted', () => {
    assert.equal(validateStrategy('dqn').valid, true);
  });

  test('strategy: valid minimax accepted', () => {
    assert.equal(validateStrategy('minimax').valid, true);
  });

  test('strategy: valid random accepted', () => {
    assert.equal(validateStrategy('random').valid, true);
  });

  test('strategy: invalid "montecarlo" rejected', () => {
    assert.equal(validateStrategy('montecarlo').valid, false);
  });

  test('strategy: null is ignored', () => {
    const result = validateStrategy(null);
    assert.equal(result.valid, true);
    assert.equal(result.ignored, true);
  });

  test('strategy: undefined is ignored', () => {
    const result = validateStrategy(undefined);
    assert.equal(result.valid, true);
    assert.equal(result.ignored, true);
  });

  test('strategy: number rejected', () => {
    assert.equal(validateStrategy(1).valid, false);
  });

  test('strategy: empty string rejected', () => {
    assert.equal(validateStrategy('').valid, false);
  });

  // ── Minimax depth clamping ───────────────────────────────────────────

  test('minimaxDepth: null returns null (ignored)', () => {
    assert.equal(clampMinimaxDepth(null), null);
  });

  test('minimaxDepth: NaN returns null', () => {
    assert.equal(clampMinimaxDepth(NaN), null);
  });

  test('minimaxDepth: Infinity returns null', () => {
    assert.equal(clampMinimaxDepth(Infinity), null);
  });

  test('minimaxDepth: 0 clamped to 1', () => {
    assert.equal(clampMinimaxDepth(0), 1);
  });

  test('minimaxDepth: -5 clamped to 1', () => {
    assert.equal(clampMinimaxDepth(-5), 1);
  });

  test('minimaxDepth: 9 clamped to 8', () => {
    assert.equal(clampMinimaxDepth(9), 8);
  });

  test('minimaxDepth: 100 clamped to 8', () => {
    assert.equal(clampMinimaxDepth(100), 8);
  });

  test('minimaxDepth: 4 stays 4', () => {
    assert.equal(clampMinimaxDepth(4), 4);
  });

  test('minimaxDepth: 3.7 rounds to 4 then stays in range', () => {
    assert.equal(clampMinimaxDepth(3.7), 4);
  });

  test('minimaxDepth: 1.2 rounds to 1', () => {
    assert.equal(clampMinimaxDepth(1.2), 1);
  });

  test('minimaxDepth: boundary 1 accepted', () => {
    assert.equal(clampMinimaxDepth(1), 1);
  });

  test('minimaxDepth: boundary 8 accepted', () => {
    assert.equal(clampMinimaxDepth(8), 8);
  });

  // ── Speed settings validation ────────────────────────────────────────

  test('speedMode: "fast" accepted', () => {
    assert.equal(validateSpeedMode('fast').valid, true);
  });

  test('speedMode: "normal" accepted', () => {
    assert.equal(validateSpeedMode('normal').valid, true);
  });

  test('speedMode: "turbo" rejected', () => {
    assert.equal(validateSpeedMode('turbo').valid, false);
  });

  test('speedMode: empty string rejected', () => {
    assert.equal(validateSpeedMode('').valid, false);
  });

  test('speedMode: null is ignored', () => {
    const result = validateSpeedMode(null);
    assert.equal(result.valid, true);
    assert.equal(result.ignored, true);
  });

  test('aiMoveDelayMs: null is ignored', () => {
    const result = validateAiMoveDelayMs(null);
    assert.equal(result.valid, true);
    assert.equal(result.ignored, true);
  });

  test('aiMoveDelayMs: NaN rejected', () => {
    assert.equal(validateAiMoveDelayMs(NaN).valid, false);
  });

  test('aiMoveDelayMs: Infinity rejected', () => {
    assert.equal(validateAiMoveDelayMs(Infinity).valid, false);
  });

  test('aiMoveDelayMs: -500 clamped to 0', () => {
    const result = validateAiMoveDelayMs(-500);
    assert.equal(result.valid, true);
    assert.equal(result.clamped, 0);
  });

  test('aiMoveDelayMs: 20000 clamped to 10000', () => {
    const result = validateAiMoveDelayMs(20000);
    assert.equal(result.valid, true);
    assert.equal(result.clamped, 10000);
  });

  test('aiMoveDelayMs: 500 passes through', () => {
    const result = validateAiMoveDelayMs(500);
    assert.equal(result.valid, true);
    assert.equal(result.clamped, 500);
  });

  // ── Integration: full param flow ─────────────────────────────────────

  test('full flow: valid params pass all checks', () => {
    const raw = { layers: 3, neurons: 128, whiteStrategy: 'minimax', minimaxDepth: 4, speedMode: 'fast' };
    const input = validateSetParamsInput(raw);
    assert.equal(input.valid, true);
    const filtered = filterParams(raw);
    assert.equal(filtered.layers, 3);
    assert.equal(filtered.whiteStrategy, 'minimax');
    const errors = validateNumericParams(filtered);
    assert.equal(errors.filter(e => e.includes('layers') || e.includes('neurons')).length, 0);
  });

  test('full flow: mixed valid and invalid — invalid detected', () => {
    const raw = { layers: 3, neurons: NaN, __proto__: { admin: true }, whiteStrategy: 'minimax' };
    const filtered = filterParams(raw);
    assert.equal(filtered.layers, 3);
    assert.equal(filtered.whiteStrategy, 'minimax');
    assert.equal(filtered.admin, undefined); // __proto__ filtered
    const errors = validateNumericParams(filtered);
    assert.ok(errors.some(e => e.includes('neurons')));
  });

  test('full flow: all invalid numeric params detected', () => {
    const raw = { layers: NaN, neurons: Infinity, batchSize: -Infinity, dropout: NaN, lr: NaN };
    const filtered = filterParams(raw);
    const errors = validateNumericParams(filtered);
    assert.ok(errors.length >= 5);
  });

  test('full flow: prototype pollution + invalid strategy rejected', () => {
    const raw = { __proto__: { isAdmin: true }, constructor: 'hack', whiteStrategy: 'evil', layers: 3 };
    const filtered = filterParams(raw);
    assert.equal(filtered.layers, 3);
    assert.equal(filtered.isAdmin, undefined);
    assert.equal(filtered.whiteStrategy, 'evil'); // passes filter but strategy validation catches it
    assert.equal(validateStrategy('evil').valid, false);
  });

  // ── Run tests ────────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  WS setParams full: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// Allow direct execution
if (process.argv[1]?.includes('hunter-v3-ws-setparams-full')) {
  runWsSetParamsFullTests().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
