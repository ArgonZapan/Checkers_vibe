/**
 * autoSaveLogic.test.js — Tests for auto-save scheduling logic (server/index.js).
 *
 * The setInterval in server/index.js has complex scheduling:
 * - Always saves state when dirty
 * - Buffer save every 2 minutes
 * - Model save every 5 minutes
 * - Skips entirely when not dirty (_saving guard + dirty flag)
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: auto-save scheduling logic ───────────────────────────────────

/**
 * Creates an auto-save scheduler that tracks what should be saved
 * based on elapsed time and dirty state.
 *
 * Mirrors the setInterval logic in server/index.js:
 *   if (_saving) return;
 *   if (!trainer.dirty) return;
 *   // State: every tick when dirty
 *   // Buffer: every 2 min
 *   // Models: every 5 min
 */
class AutoSaveScheduler {
  constructor(opts = {}) {
    this.bufferIntervalMs = opts.bufferIntervalMs || 2 * 60 * 1000;
    this.modelIntervalMs = opts.modelIntervalMs || 5 * 60 * 1000;
    this._saving = false;
    this._dirty = false;
    this._lastBufferSave = 0;
    this._lastModelSave = 0;
    this._lastStateSave = 0;
  }

  get dirty() { return this._dirty; }
  set dirty(v) { this._dirty = v; }

  /**
   * Determines what needs to be saved at a given timestamp.
   * Returns { state, buffer, model } booleans.
   */
  shouldSave(now) {
    if (this._saving) return { state: false, buffer: false, model: false };
    if (!this._dirty) return { state: false, buffer: false, model: false };

    const needsBuffer = (now - this._lastBufferSave) >= this.bufferIntervalMs;
    const needsModel = (now - this._lastModelSave) >= this.modelIntervalMs;

    return {
      state: true, // always save state when dirty
      buffer: needsBuffer,
      model: needsModel,
    };
  }

  /**
   * Records that saves were performed.
   */
  recordSave(now, what) {
    if (what.state) this._lastStateSave = now;
    if (what.buffer) this._lastBufferSave = now;
    if (what.model) this._lastModelSave = now;
    if (what.state) this._dirty = false;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runAutoSaveLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Dirty flag ────────────────────────────────────────────────────────

  test('skips everything when not dirty', () => {
    const s = new AutoSaveScheduler();
    s._dirty = false;
    const result = s.shouldSave(1000000);
    assert.deepEqual(result, { state: false, buffer: false, model: false });
  });

  test('saves state when dirty (first tick)', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    const result = s.shouldSave(1000);
    assert.equal(result.state, true);
  });

  // ── Buffer timing ─────────────────────────────────────────────────────

  test('buffer NOT saved before 2 minutes elapsed', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s._lastBufferSave = 1000000;
    const result = s.shouldSave(1000000 + 60000); // +1min
    assert.equal(result.buffer, false);
  });

  test('buffer saved after 2 minutes elapsed', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s._lastBufferSave = 1000000;
    const result = s.shouldSave(1000000 + 120000); // +2min
    assert.equal(result.buffer, true);
  });

  test('buffer: first tick at t=0, elapsed < interval → not saved', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    // _lastBufferSave defaults to 0
    const result = s.shouldSave(30000); // first autoSaveMs tick
    assert.equal(result.buffer, false); // 30000 - 0 < 120000
  });

  test('buffer: tick at t=120001 → saved', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    const result = s.shouldSave(120001);
    assert.equal(result.buffer, true);
  });

  // ── Model timing ──────────────────────────────────────────────────────

  test('model NOT saved before 5 minutes elapsed', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s._lastModelSave = 1000000;
    const result = s.shouldSave(1000000 + 240000); // +4min
    assert.equal(result.model, false);
  });

  test('model saved after 5 minutes elapsed', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s._lastModelSave = 1000000;
    const result = s.shouldSave(1000000 + 300000); // +5min
    assert.equal(result.model, true);
  });

  test('model: first tick at t=30000 → not saved (30000 < 300000)', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    const result = s.shouldSave(30000);
    assert.equal(result.model, false);
  });

  // ── Saving guard ──────────────────────────────────────────────────────

  test('skips when _saving is true (concurrent save guard)', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s._saving = true;
    const result = s.shouldSave(999999999);
    assert.deepEqual(result, { state: false, buffer: false, model: false });
  });

  // ── recordSave ────────────────────────────────────────────────────────

  test('recordSave: resets dirty flag after state save', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;
    s.recordSave(1000, { state: true, buffer: false, model: false });
    assert.equal(s.dirty, false);
  });

  test('recordSave: updates lastBufferSave timestamp', () => {
    const s = new AutoSaveScheduler();
    s.recordSave(5000, { state: true, buffer: true, model: false });
    assert.equal(s._lastBufferSave, 5000);
  });

  test('recordSave: updates lastModelSave timestamp', () => {
    const s = new AutoSaveScheduler();
    s.recordSave(9999, { state: true, buffer: false, model: true });
    assert.equal(s._lastModelSave, 9999);
  });

  // ── Complex scheduling scenarios ──────────────────────────────────────

  test('full cycle: state+buffer at 2min, state+model at 5min', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;

    // Tick 1: t=30000 (first autoSaveMs tick)
    let r = s.shouldSave(30000);
    assert.equal(r.state, true);
    assert.equal(r.buffer, false); // 30000 < 120000
    assert.equal(r.model, false);  // 30000 < 300000
    s.recordSave(30000, r);

    // Set dirty again (game continues)
    s._dirty = true;

    // Tick 2: t=150000 (+2min from start)
    r = s.shouldSave(150000);
    assert.equal(r.state, true);
    assert.equal(r.buffer, true);  // 150000 - 0 >= 120000 (never saved buffer)
    assert.equal(r.model, false);  // 150000 - 0 < 300000
    s.recordSave(150000, r);

    s._dirty = true;

    // Tick 3: t=300000 (+5min from start)
    r = s.shouldSave(300000);
    assert.equal(r.state, true);
    assert.equal(r.buffer, true);  // 300000 - 150000 = 150000 >= 120000
    assert.equal(r.model, true);   // 300000 - 0 >= 300000
  });

  test('dirty reset after save, next tick without dirty change skips', () => {
    const s = new AutoSaveScheduler();
    s._dirty = true;

    // Save
    const r1 = s.shouldSave(150000);
    assert.equal(r1.state, true);
    s.recordSave(150000, r1);

    // Don't set dirty → next tick should skip
    const r2 = s.shouldSave(180000);
    assert.deepEqual(r2, { state: false, buffer: false, model: false });
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Logic Tests');

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
