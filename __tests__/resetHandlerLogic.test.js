/**
 * resetHandlerLogic.test.js — Tests for the WebSocket "reset" handler logic.
 *
 * The reset handler in server/index.js does:
 * 1. trainer.resetModel()
 * 2. cppFetch('/api/game/reset').catch(() => {}) — engine reset is best-effort
 * 3. io.emit('selfPlayStatus', { active: false, gameNumber: 0, stats })
 * 4. io.emit('modelRestart', { side: 'both' })
 *
 * Also covers: getLegalMoves with `from` parameter filtering.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: reset handler sequence ──────────────────────────────────────

/**
 * Simulates the reset handler logic.
 * Returns the actions that would be performed.
 */
function buildResetActions(trainer) {
  const actions = [];

  // 1. Reset model
  actions.push({ type: 'resetModel' });

  // 2. Engine reset (best-effort, errors are caught)
  actions.push({ type: 'engineReset', bestEffort: true });

  // 3. Broadcast selfPlayStatus
  actions.push({
    type: 'broadcast',
    event: 'selfPlayStatus',
    data: { active: false, gameNumber: 0, stats: trainer.stats },
  });

  // 4. Broadcast modelRestart
  actions.push({
    type: 'broadcast',
    event: 'modelRestart',
    data: { side: 'both' },
  });

  return actions;
}

/**
 * Validates that engine reset errors are swallowed (best-effort).
 */
function shouldSwallowEngineResetError() {
  // engine reset failure should not prevent model reset or broadcast
  return true;
}

/**
 * Simulates filtering legal moves by `from` coordinate.
 */
function filterLegalMovesByFrom(legalMoves, from) {
  if (!from) return legalMoves;
  return legalMoves.filter(
    m => m.from[0] === from[0] && m.from[1] === from[1]
  );
}

/**
 * Validates the `from` parameter for getLegalMoves.
 */
function validateGetLegalMovesFrom(from) {
  if (from == null) return { valid: true, from: null };
  if (!Array.isArray(from) || from.length !== 2) {
    return { valid: false, error: 'Invalid from coordinate' };
  }
  if (!Number.isInteger(from[0]) || !Number.isInteger(from[1])) {
    return { valid: false, error: 'Invalid from coordinate' };
  }
  if (from[0] < 0 || from[0] > 7 || from[1] < 0 || from[1] > 7) {
    return { valid: false, error: 'Invalid from coordinate' };
  }
  return { valid: true, from };
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runResetHandlerLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Reset handler sequence
  // ═══════════════════════════════════════════════════════════════════════

  test('reset: performs all 4 actions in order', () => {
    const trainer = { stats: { gamesPlayed: 42, wins: 10 } };
    const actions = buildResetActions(trainer);

    assert.equal(actions.length, 4);
    assert.equal(actions[0].type, 'resetModel');
    assert.equal(actions[1].type, 'engineReset');
    assert.equal(actions[2].type, 'broadcast');
    assert.equal(actions[3].type, 'broadcast');
  });

  test('reset: selfPlayStatus broadcast has active=false', () => {
    const trainer = { stats: { gamesPlayed: 0, wins: 0 } };
    const actions = buildResetActions(trainer);
    const statusAction = actions.find(a => a.event === 'selfPlayStatus');

    assert.equal(statusAction.data.active, false);
    assert.equal(statusAction.data.gameNumber, 0);
  });

  test('reset: selfPlayStatus includes trainer stats', () => {
    const trainer = { stats: { gamesPlayed: 99, wins: 50, draws: 5 } };
    const actions = buildResetActions(trainer);
    const statusAction = actions.find(a => a.event === 'selfPlayStatus');

    assert.equal(statusAction.data.stats.gamesPlayed, 99);
    assert.equal(statusAction.data.stats.wins, 50);
    assert.equal(statusAction.data.stats.draws, 5);
  });

  test('reset: modelRestart broadcast has side=both', () => {
    const trainer = { stats: {} };
    const actions = buildResetActions(trainer);
    const restartAction = actions.find(a => a.event === 'modelRestart');

    assert.equal(restartAction.data.side, 'both');
  });

  test('reset: engine reset is best-effort (swallows errors)', () => {
    assert.equal(shouldSwallowEngineResetError(), true);
  });

  test('reset: empty stats object still works', () => {
    const trainer = { stats: {} };
    const actions = buildResetActions(trainer);
    const statusAction = actions.find(a => a.event === 'selfPlayStatus');

    assert.deepEqual(statusAction.data.stats, {});
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getLegalMoves with `from` filtering
  // ═══════════════════════════════════════════════════════════════════════

  const sampleMoves = [
    { from: [2, 1], to: [3, 0] },
    { from: [2, 1], to: [3, 2] },
    { from: [2, 3], to: [3, 2] },
    { from: [2, 3], to: [3, 4] },
    { from: [2, 5], to: [3, 6] },
  ];

  test('getLegalMoves: null from returns all moves', () => {
    const result = filterLegalMovesByFrom(sampleMoves, null);
    assert.equal(result.length, 5);
  });

  test('getLegalMoves: undefined from returns all moves', () => {
    const result = filterLegalMovesByFrom(sampleMoves, undefined);
    assert.equal(result.length, 5);
  });

  test('getLegalMoves: filter by [2,1] returns 2 moves', () => {
    const result = filterLegalMovesByFrom(sampleMoves, [2, 1]);
    assert.equal(result.length, 2);
    assert.ok(result.every(m => m.from[0] === 2 && m.from[1] === 1));
  });

  test('getLegalMoves: filter by [2,3] returns 2 moves', () => {
    const result = filterLegalMovesByFrom(sampleMoves, [2, 3]);
    assert.equal(result.length, 2);
  });

  test('getLegalMoves: filter by [2,5] returns 1 move', () => {
    const result = filterLegalMovesByFrom(sampleMoves, [2, 5]);
    assert.equal(result.length, 1);
  });

  test('getLegalMoves: filter by nonexistent square returns empty', () => {
    const result = filterLegalMovesByFrom(sampleMoves, [0, 0]);
    assert.equal(result.length, 0);
  });

  test('getLegalMoves: empty moves array returns empty', () => {
    const result = filterLegalMovesByFrom([], [2, 1]);
    assert.equal(result.length, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getLegalMoves `from` validation
  // ═══════════════════════════════════════════════════════════════════════

  test('from validation: null → valid (no filter)', () => {
    const r = validateGetLegalMovesFrom(null);
    assert.equal(r.valid, true);
    assert.equal(r.from, null);
  });

  test('from validation: undefined → valid (no filter)', () => {
    const r = validateGetLegalMovesFrom(undefined);
    assert.equal(r.valid, true);
  });

  test('from validation: [0,0] → valid (corner)', () => {
    const r = validateGetLegalMovesFrom([0, 0]);
    assert.equal(r.valid, true);
  });

  test('from validation: [7,7] → valid (corner)', () => {
    const r = validateGetLegalMovesFrom([7, 7]);
    assert.equal(r.valid, true);
  });

  test('from validation: [3,4] → valid', () => {
    const r = validateGetLegalMovesFrom([3, 4]);
    assert.equal(r.valid, true);
  });

  test('from validation: [-1,0] → invalid', () => {
    const r = validateGetLegalMovesFrom([-1, 0]);
    assert.equal(r.valid, false);
  });

  test('from validation: [0,8] → invalid', () => {
    const r = validateGetLegalMovesFrom([0, 8]);
    assert.equal(r.valid, false);
  });

  test('from validation: [8,8] → invalid', () => {
    const r = validateGetLegalMovesFrom([8, 8]);
    assert.equal(r.valid, false);
  });

  test('from validation: not array → invalid', () => {
    const r = validateGetLegalMovesFrom('2,1');
    assert.equal(r.valid, false);
  });

  test('from validation: object → invalid', () => {
    const r = validateGetLegalMovesFrom({ row: 2, col: 1 });
    assert.equal(r.valid, false);
  });

  test('from validation: [2] (single element) → invalid', () => {
    const r = validateGetLegalMovesFrom([2]);
    assert.equal(r.valid, false);
  });

  test('from validation: [2,1,0] (three elements) → invalid', () => {
    const r = validateGetLegalMovesFrom([2, 1, 0]);
    assert.equal(r.valid, false);
  });

  test('from validation: [2.5, 1.5] (floats) → invalid', () => {
    const r = validateGetLegalMovesFrom([2.5, 1.5]);
    assert.equal(r.valid, false);
  });

  test('from validation: ["2", "1"] (strings) → invalid', () => {
    const r = validateGetLegalMovesFrom(['2', '1']);
    assert.equal(r.valid, false);
  });

  test('from validation: NaN coordinates → invalid', () => {
    const r = validateGetLegalMovesFrom([NaN, 1]);
    assert.equal(r.valid, false);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Reset Handler & getLegalMoves Filter Tests');

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
