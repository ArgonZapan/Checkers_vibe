/**
 * wsHandlerLogic.test.js — Tests for WebSocket handler logic not covered elsewhere.
 *
 * Covers: startGame mode handling, setParams auth & validation, setSpeedMode,
 *         getLegalMoves filtering, proxy filter logic.
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: startGame mode logic ─────────────────────────────────────────

function handleStartGame(mode, trainerRunning, currentMode) {
  const gameMode = mode || 'pvai';
  const shouldStopTrainer = trainerRunning && gameMode !== 'aivai';
  const shouldAutoStartTrainer = gameMode === 'aivai';
  return { gameMode, shouldStopTrainer, shouldAutoStartTrainer };
}

// ── Extracted: setParams auth ───────────────────────────────────────────────

function validateSetParamsAuth(gameMode) {
  if (gameMode !== 'aivai') {
    return { allowed: false, error: 'Zmiana parametrów modelu dozwolona tylko w trybie AI vs AI' };
  }
  return { allowed: true };
}

// ── Extracted: setParams validation ─────────────────────────────────────────

function validateSetParams(params) {
  const errors = [];
  if (params.layers != null && (params.layers < 1 || params.layers > 8)) {
    errors.push(`layers=${params.layers} (zakres: 1-8)`);
  }
  if (params.neurons != null && (params.neurons < 32 || params.neurons > 1024)) {
    errors.push(`neurons=${params.neurons} (zakres: 32-1024)`);
  }
  if (params.batchSize != null && (params.batchSize < 8 || params.batchSize > 256)) {
    errors.push(`batchSize=${params.batchSize} (zakres: 8-256)`);
  }
  if (params.dropout != null && (params.dropout < 0 || params.dropout > 0.5)) {
    errors.push(`dropout=${params.dropout} (zakres: 0-0.5)`);
  }
  return { valid: errors.length === 0, errors };
}

// ── Extracted: getLegalMoves filtering ──────────────────────────────────────

function filterLegalMoves(legalMoves, from) {
  return legalMoves.filter(
    m => m.from[0] === from[0] && m.from[1] === from[1]
  );
}

// ── Extracted: proxy filter ────────────────────────────────────────────────

function proxyFilter(pathname) {
  return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
}

// ── Extracted: move coord validation (for completeness) ────────────────────

function isValidCoord(c) {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    c[0] >= 0 && c[0] <= 7 &&
    c[1] >= 0 && c[1] <= 7
  );
}

function validateMoveData(data) {
  if (!data || typeof data !== 'object') return { valid: false };
  const { from, to, captures } = data;
  if (!isValidCoord(from)) return { valid: false };
  if (!isValidCoord(to)) return { valid: false };
  if (captures != null && !Array.isArray(captures)) return { valid: false };
  return { valid: true };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runWsHandlerLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // startGame mode handling
  // ═══════════════════════════════════════════════════════════════════════

  test('startGame: default mode is pvai', () => {
    const r = handleStartGame(undefined, false, 'pvai');
    assert.equal(r.gameMode, 'pvai');
  });

  test('startGame: pvai mode stops trainer if running', () => {
    const r = handleStartGame('pvai', true, 'pvai');
    assert.equal(r.shouldStopTrainer, true);
    assert.equal(r.shouldAutoStartTrainer, false);
  });

  test('startGame: pvp mode stops trainer if running', () => {
    const r = handleStartGame('pvp', true, 'pvai');
    assert.equal(r.shouldStopTrainer, true);
    assert.equal(r.shouldAutoStartTrainer, false);
  });

  test('startGame: aivai mode does NOT stop trainer', () => {
    const r = handleStartGame('aivai', true, 'pvai');
    assert.equal(r.shouldStopTrainer, false);
    assert.equal(r.shouldAutoStartTrainer, true);
  });

  test('startGame: aivai mode auto-starts trainer', () => {
    const r = handleStartGame('aivai', false, 'pvai');
    assert.equal(r.shouldAutoStartTrainer, true);
  });

  test('startGame: pvai when trainer not running — no stop needed', () => {
    const r = handleStartGame('pvai', false, 'pvai');
    assert.equal(r.shouldStopTrainer, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setParams auth
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams auth: allowed in aivai mode', () => {
    const r = validateSetParamsAuth('aivai');
    assert.equal(r.allowed, true);
  });

  test('setParams auth: rejected in pvai mode', () => {
    const r = validateSetParamsAuth('pvai');
    assert.equal(r.allowed, false);
    assert.ok(r.error.includes('AI vs AI'));
  });

  test('setParams auth: rejected in pvp mode', () => {
    const r = validateSetParamsAuth('pvp');
    assert.equal(r.allowed, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // setParams validation
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams: valid params pass', () => {
    const r = validateSetParams({ layers: 3, neurons: 128, batchSize: 64, dropout: 0.1 });
    assert.equal(r.valid, true);
    assert.equal(r.errors.length, 0);
  });

  test('setParams: layers boundary 1 passes', () => {
    assert.equal(validateSetParams({ layers: 1 }).valid, true);
  });

  test('setParams: layers boundary 8 passes', () => {
    assert.equal(validateSetParams({ layers: 8 }).valid, true);
  });

  test('setParams: layers=0 rejected', () => {
    const r = validateSetParams({ layers: 0 });
    assert.equal(r.valid, false);
    assert.ok(r.errors[0].includes('layers'));
  });

  test('setParams: layers=9 rejected', () => {
    const r = validateSetParams({ layers: 9 });
    assert.equal(r.valid, false);
  });

  test('setParams: neurons=31 rejected', () => {
    const r = validateSetParams({ neurons: 31 });
    assert.equal(r.valid, false);
  });

  test('setParams: neurons=32 passes', () => {
    assert.equal(validateSetParams({ neurons: 32 }).valid, true);
  });

  test('setParams: neurons=1024 passes', () => {
    assert.equal(validateSetParams({ neurons: 1024 }).valid, true);
  });

  test('setParams: neurons=1025 rejected', () => {
    const r = validateSetParams({ neurons: 1025 });
    assert.equal(r.valid, false);
  });

  test('setParams: batchSize=7 rejected', () => {
    assert.equal(validateSetParams({ batchSize: 7 }).valid, false);
  });

  test('setParams: batchSize=8 passes', () => {
    assert.equal(validateSetParams({ batchSize: 8 }).valid, true);
  });

  test('setParams: batchSize=256 passes', () => {
    assert.equal(validateSetParams({ batchSize: 256 }).valid, true);
  });

  test('setParams: batchSize=257 rejected', () => {
    assert.equal(validateSetParams({ batchSize: 257 }).valid, false);
  });

  test('setParams: dropout=-0.1 rejected', () => {
    assert.equal(validateSetParams({ dropout: -0.1 }).valid, false);
  });

  test('setParams: dropout=0 passes', () => {
    assert.equal(validateSetParams({ dropout: 0 }).valid, true);
  });

  test('setParams: dropout=0.5 passes', () => {
    assert.equal(validateSetParams({ dropout: 0.5 }).valid, true);
  });

  test('setParams: dropout=0.6 rejected', () => {
    assert.equal(validateSetParams({ dropout: 0.6 }).valid, false);
  });

  test('setParams: multiple invalid params — all reported', () => {
    const r = validateSetParams({ layers: 0, neurons: 0, batchSize: 0, dropout: -1 });
    assert.equal(r.valid, false);
    assert.equal(r.errors.length, 4);
  });

  test('setParams: empty object passes', () => {
    assert.equal(validateSetParams({}).valid, true);
  });

  // setSpeedMode

  function validateSpeedMode(mode) {
    return mode === 'fast' || mode === 'normal';
  }

  test('setSpeedMode: "fast" is valid', () => {
    assert.ok(validateSpeedMode('fast'));
  });

  test('setSpeedMode: "normal" is valid', () => {
    assert.ok(validateSpeedMode('normal'));
  });

  test('setSpeedMode: "FAST" is invalid', () => {
    assert.ok(!validateSpeedMode('FAST'));
  });

  test('setSpeedMode: "" is invalid', () => {
    assert.ok(!validateSpeedMode(''));
  });

  test('setSpeedMode: null is invalid', () => {
    assert.ok(!validateSpeedMode(null));
  });

  test('setSpeedMode: undefined is invalid', () => {
    assert.ok(!validateSpeedMode(undefined));
  });

  test('setSpeedMode: "turbo" is invalid', () => {
    assert.ok(!validateSpeedMode('turbo'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getLegalMoves filtering
  // ═══════════════════════════════════════════════════════════════════════

  test('filterLegalMoves: filters by from coordinate', () => {
    const moves = [
      { from: [2, 1], to: [3, 0] },
      { from: [2, 1], to: [3, 2] },
      { from: [2, 3], to: [3, 4] },
    ];
    const filtered = filterLegalMoves(moves, [2, 1]);
    assert.equal(filtered.length, 2);
    assert.deepEqual(filtered[0].to, [3, 0]);
    assert.deepEqual(filtered[1].to, [3, 2]);
  });

  test('filterLegalMoves: no matches returns empty', () => {
    const moves = [{ from: [2, 1], to: [3, 0] }];
    const filtered = filterLegalMoves(moves, [5, 5]);
    assert.equal(filtered.length, 0);
  });

  test('filterLegalMoves: empty moves returns empty', () => {
    assert.equal(filterLegalMoves([], [0, 0]).length, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // proxy filter
  // ═══════════════════════════════════════════════════════════════════════

  test('proxyFilter: /ai/predict is excluded (false)', () => {
    assert.equal(proxyFilter('/ai/predict'), false);
  });

  test('proxyFilter: /ai/info is excluded', () => {
    assert.equal(proxyFilter('/ai/info'), false);
  });

  test('proxyFilter: /selfplay/start is excluded', () => {
    assert.equal(proxyFilter('/selfplay/start'), false);
  });

  test('proxyFilter: /selfplay/status is excluded', () => {
    assert.equal(proxyFilter('/selfplay/status'), false);
  });

  test('proxyFilter: /game/state is proxied (true)', () => {
    assert.equal(proxyFilter('/game/state'), true);
  });

  test('proxyFilter: /legal-moves is proxied', () => {
    assert.equal(proxyFilter('/legal-moves'), true);
  });

  test('proxyFilter: /move is proxied', () => {
    assert.equal(proxyFilter('/move'), true);
  });

  test('proxyFilter: / is proxied', () => {
    assert.equal(proxyFilter('/'), true);
  });

  test('proxyFilter: /ai (no trailing slash) is proxied', () => {
    // Exact /ai without / is NOT excluded by startsWith('/ai/')
    assert.equal(proxyFilter('/ai'), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Move validation with captures
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMoveData: valid move with captures array', () => {
    const r = validateMoveData({ from: [2, 1], to: [4, 3], captures: [[3, 2]] });
    assert.equal(r.valid, true);
  });

  test('validateMoveData: captures as non-array rejects', () => {
    const r = validateMoveData({ from: [2, 1], to: [4, 3], captures: 'bad' });
    assert.equal(r.valid, false);
  });

  test('validateMoveData: captures as number rejects', () => {
    const r = validateMoveData({ from: [2, 1], to: [4, 3], captures: 5 });
    assert.equal(r.valid, false);
  });

  test('validateMoveData: null data rejects', () => {
    assert.equal(validateMoveData(null).valid, false);
  });

  test('validateMoveData: empty object rejects', () => {
    assert.equal(validateMoveData({}).valid, false);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Handler Logic Tests');

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
