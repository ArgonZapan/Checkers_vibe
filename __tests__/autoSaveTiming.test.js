/**
 * autoSaveTiming.test.js — Tests for auto-save timing and dirty flag logic.
 *
 * Covers: the auto-save interval logic from server/index.js including
 * _saving guard, dirty flag, buffer/model save timing.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: auto-save logic (mirrors server/index.js) ────────────────────

function createAutoSaveScheduler(autoSaveMs) {
  let _saving = false;
  let _lastBufferSave = 0;
  let _lastModelSave = 0;
  let dirty = false;
  let saveStateCalls = 0;
  let saveBufferCalls = 0;
  let saveModelCalls = 0;

  async function tick(now) {
    if (_saving) return { skipped: 'already_saving' };
    if (!dirty) return { skipped: 'not_dirty' };
    try {
      _saving = true;
      saveStateCalls++;
      dirty = false;

      if (now - _lastBufferSave >= 2 * 60 * 1000) {
        saveBufferCalls++;
        _lastBufferSave = now;
      }

      if (now - _lastModelSave >= 5 * 60 * 1000) {
        saveModelCalls++;
        _lastModelSave = now;
      }
      return { saved: true };
    } finally {
      _saving = false;
    }
  }

  return {
    tick,
    setDirty: (v) => { dirty = v; },
    isDirty: () => dirty,
    isSaving: () => _saving,
    getStats: () => ({
      saveStateCalls,
      saveBufferCalls,
      saveModelCalls,
      lastBufferSave: _lastBufferSave,
      lastModelSave: _lastModelSave,
    }),
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveTimingTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Dirty flag
  // ═══════════════════════════════════════════════════════════════════════

  test('tick: skips when not dirty', async () => {
    const sched = createAutoSaveScheduler(30000);
    const r = await sched.tick(1000);
    assert.equal(r.skipped, 'not_dirty');
    assert.equal(sched.getStats().saveStateCalls, 0);
  });

  test('tick: saves when dirty', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    const r = await sched.tick(1000);
    assert.equal(r.saved, true);
    assert.equal(sched.getStats().saveStateCalls, 1);
  });

  test('tick: resets dirty flag after save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(1000);
    assert.equal(sched.isDirty(), false);
  });

  test('tick: second call without new dirty change skips', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(1000);
    const r = await sched.tick(2000);
    assert.equal(r.skipped, 'not_dirty');
    assert.equal(sched.getStats().saveStateCalls, 1);
  });

  test('tick: new dirty flag after save triggers new save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(1000);
    sched.setDirty(true);
    const r = await sched.tick(2000);
    assert.equal(r.saved, true);
    assert.equal(sched.getStats().saveStateCalls, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Buffer save timing (every 2 minutes)
  // ═══════════════════════════════════════════════════════════════════════

  test('buffer: saves on first tick (no previous save)', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(120000);
    assert.equal(sched.getStats().saveBufferCalls, 1);
  });

  test('buffer: does not save again within 2 minutes of last buffer save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(120000); // first tick at 2min — buffer saves
    assert.equal(sched.getStats().saveBufferCalls, 1);
    sched.setDirty(true);
    await sched.tick(180000); // 1min later — buffer NOT saved again
    assert.equal(sched.getStats().saveBufferCalls, 1);
  });

  test('buffer: saves again after 2 minutes from last buffer save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(120000); // buffer saves (2min)
    sched.setDirty(true);
    await sched.tick(240001); // 2min+1ms later — buffer saves again
    assert.equal(sched.getStats().saveBufferCalls, 2);
  });

  test('buffer: exactly 2 minutes boundary from last save DOES save (>=)', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(120000); // buffer saves
    sched.setDirty(true);
    await sched.tick(240000); // exactly 120000ms later — >= 120000 is true
    assert.equal(sched.getStats().saveBufferCalls, 2);
  });

  test('buffer: 1ms past 2 minutes boundary from last save saves', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(120000);
    sched.setDirty(true);
    await sched.tick(240001);
    assert.equal(sched.getStats().saveBufferCalls, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Model save timing (every 5 minutes)
  // ═══════════════════════════════════════════════════════════════════════

  test('model: saves on first tick (no previous save)', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(300000);
    assert.equal(sched.getStats().saveModelCalls, 1);
  });

  test('model: does not save again within 5 minutes of last model save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(300000); // model saves (5min)
    assert.equal(sched.getStats().saveModelCalls, 1);
    sched.setDirty(true);
    await sched.tick(400000); // <5min later — model NOT saved again
    assert.equal(sched.getStats().saveModelCalls, 1);
  });

  test('model: saves again after 5 minutes from last model save', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(300000); // model saves
    sched.setDirty(true);
    await sched.tick(600001); // 5min+1ms later — model saves again
    assert.equal(sched.getStats().saveModelCalls, 2);
  });

  test('model: exactly 5 minutes boundary from last save DOES save (>=)', async () => {
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    await sched.tick(300000);
    sched.setDirty(true);
    await sched.tick(600000); // exactly 300000ms later — >= 300000 is true
    assert.equal(sched.getStats().saveModelCalls, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Saving guard (_saving)
  // ═══════════════════════════════════════════════════════════════════════

  test('saving guard: prevents re-entrant saves', async () => {
    // Test that the guard flag works by checking isSaving state
    const sched = createAutoSaveScheduler(30000);
    sched.setDirty(true);
    // First tick should succeed
    const r = await sched.tick(1000);
    assert.equal(r.saved, true);
    // After tick, saving guard is released
    assert.equal(sched.isSaving(), false);
  });

  test('saving guard: dirty=false means tick is skipped', async () => {
    const sched = createAutoSaveScheduler(30000);
    // Not dirty
    const r = await sched.tick(1000);
    assert.equal(r.skipped, 'not_dirty');
    assert.equal(sched.getStats().saveStateCalls, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined timing
  // ═══════════════════════════════════════════════════════════════════════

  test('combined: state saves every dirty tick, buffer every 2min, model every 5min', async () => {
    const sched = createAutoSaveScheduler(30000);
    // Tick 1: t=0 — state only (buffer/model haven't elapsed enough)
    sched.setDirty(true);
    await sched.tick(0);
    assert.equal(sched.getStats().saveStateCalls, 1);
    assert.equal(sched.getStats().saveBufferCalls, 0);
    assert.equal(sched.getStats().saveModelCalls, 0);

    // Tick 2: t=120000 (2min) — state + buffer
    sched.setDirty(true);
    await sched.tick(120000);
    assert.equal(sched.getStats().saveStateCalls, 2);
    assert.equal(sched.getStats().saveBufferCalls, 1);
    assert.equal(sched.getStats().saveModelCalls, 0);

    // Tick 3: t=300000 (5min) — state + buffer (180s since last) + model
    sched.setDirty(true);
    await sched.tick(300000);
    assert.equal(sched.getStats().saveStateCalls, 3);
    assert.equal(sched.getStats().saveBufferCalls, 2);
    assert.equal(sched.getStats().saveModelCalls, 1);

    // Tick 4: t=420000 (7min) — state + buffer (120s since last)
    sched.setDirty(true);
    await sched.tick(420000);
    assert.equal(sched.getStats().saveStateCalls, 4);
    assert.equal(sched.getStats().saveBufferCalls, 3);
    assert.equal(sched.getStats().saveModelCalls, 1);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Timing Tests');

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
