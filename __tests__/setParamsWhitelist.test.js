/**
 * setParamsWhitelist.test.js — Tests for prototype pollution protection in setParams.
 *
 * Covers the ALLOWED_PARAMS whitelist in server/index.js socket.on('setParams'):
 * - __proto__ is filtered out
 * - constructor is filtered out
 * - prototype pollution keys are rejected
 * - Only whitelisted keys pass through
 * - Type validation: non-object / array → rejected
 * - wasRunning flag triggers trainer restart after update
 * - paramsVersion incremented to invalidate in-flight games
 * - Buffer cleared on param change
 * - Speed settings applied to CONFIG
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: setParams logic (mirrors server/index.js) ───────────────────

const ALLOWED_PARAMS = new Set([
  'layers', 'neurons', 'activation', 'lr', 'batchSize', 'dropout',
  'minEpsilon', 'epsilonDecay', 'gamma', 'bufferSize', 'epochs',
  'rewardCapture', 'rewardLosePiece', 'rewardPromotion', 'rewardWin', 'rewardLose',
  'speedMode', 'aiMoveDelayMs',
]);

/**
 * Filter params by whitelist (prevents prototype pollution).
 */
function filterParams(newParams) {
  const filtered = {};
  for (const key of Object.keys(newParams)) {
    if (ALLOWED_PARAMS.has(key)) {
      filtered[key] = newParams[key];
    }
  }
  return filtered;
}

/**
 * Validate setParams input type.
 */
function validateSetParamsInput(newParams) {
  if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) {
    return { valid: false, error: 'Invalid params — expected object' };
  }
  return { valid: true };
}

/**
 * Full setParams simulation.
 */
function simulateSetParams(newParams, gameState) {
  const log = [];

  // 1. Type check
  const inputValidation = validateSetParamsInput(newParams);
  if (!inputValidation.valid) {
    log.push({ action: 'reject', error: inputValidation.error });
    return log;
  }

  // 2. Whitelist filter
  const filtered = filterParams(newParams);
  log.push({ action: 'filter', filtered });

  // 3. Auth check
  if (gameState.gameMode !== 'aivai') {
    log.push({ action: 'reject', error: 'not aivai mode' });
    return log;
  }

  // 4. Validation
  const errors = [];
  if (filtered.layers != null && (filtered.layers < 1 || filtered.layers > 5)) {
    errors.push(`layers=${filtered.layers} (zakres: 1-5)`);
  }
  if (filtered.neurons != null && (filtered.neurons < 32 || filtered.neurons > 512)) {
    errors.push(`neurons=${filtered.neurons} (zakres: 32-512)`);
  }
  if (filtered.batchSize != null && (filtered.batchSize < 8 || filtered.batchSize > 256)) {
    errors.push(`batchSize=${filtered.batchSize} (zakres: 8-256)`);
  }
  if (filtered.dropout != null && (filtered.dropout < 0 || filtered.dropout > 0.5)) {
    errors.push(`dropout=${filtered.dropout} (zakres: 0-0.5)`);
  }
  if (errors.length > 0) {
    log.push({ action: 'reject', error: `Nieprawidłowe parametry: ${errors.join('; ')}` });
    return log;
  }

  // 5. Apply speed settings to CONFIG
  if (filtered.speedMode != null) {
    if (filtered.speedMode === 'fast' || filtered.speedMode === 'normal') {
      log.push({ action: 'configUpdate', key: 'speedMode', value: filtered.speedMode });
    }
  }
  if (filtered.aiMoveDelayMs != null && typeof filtered.aiMoveDelayMs === 'number') {
    const clamped = Math.max(0, Math.min(filtered.aiMoveDelayMs, 10000));
    log.push({ action: 'configUpdate', key: 'aiMoveDelayMs', value: clamped });
  }

  // 6. Stop trainer
  log.push({ action: 'trainer.stop' });

  // 7. Increment paramsVersion
  log.push({ action: 'paramsVersion++' });

  // 8. Update model params
  log.push({ action: 'setModelParams', params: filtered });

  // 9. Create fresh models
  log.push({ action: 'createModels' });

  // 10. Clear buffer
  log.push({ action: 'buffer.clear' });

  // 11. Reset stats
  log.push({ action: 'resetStats' });

  // 12. Broadcast
  log.push({ action: 'io.emit', event: 'paramsUpdate' });
  log.push({ action: 'io.emit', event: 'selfPlayStatus' });

  // 13. Restart if was running
  if (gameState.wasRunning) {
    log.push({ action: 'trainer.start' });
  }

  return log;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runSetParamsWhitelistTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Whitelist filtering — prototype pollution protection
  // ═══════════════════════════════════════════════════════════════════════

  test('filterParams: __proto__ key is not copied as own property', () => {
    const params = { layers: 3, __proto__: { isAdmin: true } };
    const filtered = filterParams(params);
    assert.equal(filtered.layers, 3);
    // __proto__ is not enumerated by Object.keys(), so it's not in output
    assert.ok(!Object.keys(filtered).includes('__proto__'), '__proto__ should not be an own key');
    assert.equal(filtered.isAdmin, undefined);
  });

  test('filterParams: constructor key is not copied as own property', () => {
    const params = { constructor: { name: 'Evil' }, layers: 2 };
    const filtered = filterParams(params);
    assert.equal(filtered.layers, 2);
    // 'constructor' is NOT in ALLOWED_PARAMS → not copied as own property
    assert.ok(!Object.keys(filtered).includes('constructor'), 'constructor should not be an own key');
  });

  test('filterParams: prototype pollution via __proto__ is blocked', () => {
    const params = JSON.parse('{"__proto__": {"admin": true}}');
    const filtered = filterParams(params);
    assert.equal(filtered.admin, undefined, '__proto__ pollution should not leak');
  });

  test('filterParams: only whitelisted keys pass through', () => {
    const params = {
      layers: 3,
      neurons: 128,
      activation: 'relu',
      lr: 0.001,
      batchSize: 64,
      dropout: 0.1,
      evilKey: 'malicious',
      anotherEvil: 42,
    };
    const filtered = filterParams(params);
    assert.equal(filtered.layers, 3);
    assert.equal(filtered.neurons, 128);
    assert.equal(filtered.activation, 'relu');
    assert.equal(filtered.lr, 0.001);
    assert.equal(filtered.batchSize, 64);
    assert.equal(filtered.dropout, 0.1);
    assert.equal(filtered.evilKey, undefined);
    assert.equal(filtered.anotherEvil, undefined);
  });

  test('filterParams: speedMode and aiMoveDelayMs are whitelisted', () => {
    const params = { speedMode: 'fast', aiMoveDelayMs: 500 };
    const filtered = filterParams(params);
    assert.equal(filtered.speedMode, 'fast');
    assert.equal(filtered.aiMoveDelayMs, 500);
  });

  test('filterParams: reward params are whitelisted', () => {
    const params = { rewardCapture: 0.5, rewardWin: 1.0, rewardLose: -1.0 };
    const filtered = filterParams(params);
    assert.equal(filtered.rewardCapture, 0.5);
    assert.equal(filtered.rewardWin, 1.0);
    assert.equal(filtered.rewardLose, -1.0);
  });

  test('filterParams: empty object returns empty', () => {
    assert.deepEqual(filterParams({}), {});
  });

  test('filterParams: all whitelisted keys pass through', () => {
    const allParams = {};
    for (const key of ALLOWED_PARAMS) {
      allParams[key] = 'test';
    }
    const filtered = filterParams(allParams);
    assert.equal(Object.keys(filtered).length, ALLOWED_PARAMS.size);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Input type validation
  // ═══════════════════════════════════════════════════════════════════════

  test('validateSetParamsInput: null → reject', () => {
    const r = validateSetParamsInput(null);
    assert.equal(r.valid, false);
  });

  test('validateSetParamsInput: undefined → reject', () => {
    const r = validateSetParamsInput(undefined);
    assert.equal(r.valid, false);
  });

  test('validateSetParamsInput: array → reject', () => {
    const r = validateSetParamsInput([1, 2, 3]);
    assert.equal(r.valid, false);
  });

  test('validateSetParamsInput: string → reject', () => {
    const r = validateSetParamsInput('hello');
    assert.equal(r.valid, false);
  });

  test('validateSetParamsInput: number → reject', () => {
    const r = validateSetParamsInput(42);
    assert.equal(r.valid, false);
  });

  test('validateSetParamsInput: empty object → accept', () => {
    const r = validateSetParamsInput({});
    assert.equal(r.valid, true);
  });

  test('validateSetParamsInput: valid object → accept', () => {
    const r = validateSetParamsInput({ layers: 3 });
    assert.equal(r.valid, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full flow simulation
  // ═══════════════════════════════════════════════════════════════════════

  test('simulateSetParams: valid params in aivai mode → full flow', () => {
    const gameState = { gameMode: 'aivai', wasRunning: true };
    const log = simulateSetParams({ layers: 3, neurons: 128 }, gameState);
    const actions = log.map(l => l.action);
    assert.ok(actions.includes('trainer.stop'));
    assert.ok(actions.includes('paramsVersion++'));
    assert.ok(actions.includes('setModelParams'));
    assert.ok(actions.includes('createModels'));
    assert.ok(actions.includes('buffer.clear'));
    assert.ok(actions.includes('resetStats'));
    assert.ok(actions.includes('trainer.start'), 'wasRunning → should restart');
  });

  test('simulateSetParams: wasRunning=false → no restart', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ layers: 3 }, gameState);
    const actions = log.map(l => l.action);
    assert.ok(!actions.includes('trainer.start'), 'wasRunning=false → should NOT restart');
  });

  test('simulateSetParams: not aivai mode → reject', () => {
    const gameState = { gameMode: 'pvai', wasRunning: false };
    const log = simulateSetParams({ layers: 3 }, gameState);
    // Filter happens first, then auth check rejects
    const rejectStep = log.find(l => l.action === 'reject');
    assert.ok(rejectStep, 'should have a reject step');
    assert.ok(rejectStep.error.includes('not aivai'));
  });

  test('simulateSetParams: invalid layers → reject with validation error', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ layers: 10 }, gameState);
    assert.equal(log[log.length - 1].action, 'reject');
    assert.ok(log[log.length - 1].error.includes('layers'));
  });

  test('simulateSetParams: __proto__ in params → filtered before validation', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const evilParams = JSON.parse('{"__proto__": {"admin": true}, "layers": 3}');
    const log = simulateSetParams(evilParams, gameState);
    const filterStep = log.find(l => l.action === 'filter');
    assert.equal(filterStep.filtered.layers, 3);
    assert.equal(filterStep.filtered.admin, undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Speed settings applied to CONFIG
  // ═══════════════════════════════════════════════════════════════════════

  test('simulateSetParams: speedMode=fast → configUpdate', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ speedMode: 'fast' }, gameState);
    const configUpdates = log.filter(l => l.action === 'configUpdate');
    assert.ok(configUpdates.some(c => c.key === 'speedMode' && c.value === 'fast'));
  });

  test('simulateSetParams: aiMoveDelayMs=500 → configUpdate with clamped value', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ aiMoveDelayMs: 500 }, gameState);
    const configUpdates = log.filter(l => l.action === 'configUpdate');
    assert.ok(configUpdates.some(c => c.key === 'aiMoveDelayMs' && c.value === 500));
  });

  test('simulateSetParams: aiMoveDelayMs=99999 → clamped to 10000', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ aiMoveDelayMs: 99999 }, gameState);
    const configUpdates = log.filter(l => l.action === 'configUpdate');
    assert.ok(configUpdates.some(c => c.key === 'aiMoveDelayMs' && c.value === 10000));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // paramsVersion increment
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams always increments paramsVersion', () => {
    const gameState = { gameMode: 'aivai', wasRunning: false };
    const log = simulateSetParams({ layers: 3 }, gameState);
    const pvIdx = log.findIndex(l => l.action === 'paramsVersion++');
    const stopIdx = log.findIndex(l => l.action === 'trainer.stop');
    assert.ok(pvIdx > stopIdx, 'paramsVersion++ should come after stop');
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Set Params Whitelist Tests');

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
