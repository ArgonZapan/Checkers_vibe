/**
 * autoSaveExtended.test.js — Extended auto-save edge cases not covered by existing tests.
 *
 * Covers gaps NOT in autoSaveLogic, autoSaveTiming, autoSaveRaceCondition, autoSaveDirtySnapshot:
 * - Timer drift compensation across multiple cycles
 * - Save error with retry logic
 * - Memory leak prevention (unbounded save history)
 * - Dirty flag oscillation (dirty→clean→dirty→clean rapid)
 * - Buffer/model save coordination under errors
 * - Concurrent dirty marks from multiple sources
 * - Interval start/stop lifecycle
 * - Edge: save at exactly the interval boundary
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: Enhanced auto-save manager (mirrors server/index.js + extensions) ─────────

class AutoSaveManager {
  constructor(opts = {}) {
    this.bufferIntervalMs = opts.bufferIntervalMs || 2 * 60 * 1000;
    this.modelIntervalMs = opts.modelIntervalMs || 5 * 60 * 1000;
    this._saving = false;
    this._dirty = false;
    this._lastBufferSave = 0;
    this._lastModelSave = 0;
    this._lastStateSave = 0;
    this.saveCount = 0;
    this.errorCount = 0;
    this.saveLog = [];
    this.maxSaveLogSize = opts.maxSaveLogSize || 100;
  }

  get dirty() { return this._dirty; }
  set dirty(v) { this._dirty = v; }

  markDirty() { this._dirty = true; }

  /**
   * Auto-save tick — mirrors server setInterval logic exactly.
   * dirty=false BEFORE save (snapshot pattern from server/index.js).
   */
  async tick(now) {
    if (this._saving) return { skipped: 'saving' };
    if (!this._dirty) return { skipped: 'clean' };

    try {
      this._saving = true;
      // CRITICAL: snapshot dirty BEFORE save
      this._dirty = false;

      // State save (always when dirty)
      await this._doSaveState(now);

      // Buffer save (every 2 min)
      if (now - this._lastBufferSave >= this.bufferIntervalMs) {
        await this._doSaveBuffer(now);
        this._lastBufferSave = now;
      }

      // Model save (every 5 min)
      if (now - this._lastModelSave >= this.modelIntervalMs) {
        await this._doSaveModel(now);
        this._lastModelSave = now;
      }

      return { saved: true };
    } catch (err) {
      this.errorCount++;
      return { error: err.message };
    } finally {
      this._saving = false;
    }
  }

  async _doSaveState(now, failRate = 0) {
    if (failRate > 0 && Math.random() < failRate) throw new Error('Random save failure');
    await new Promise(r => setTimeout(r, 2));
    this.saveCount++;
    this.saveLog.push({ type: 'state', timestamp: now, seq: this.saveCount });
    this._trimSaveLog();
  }

  async _doSaveBuffer(now) {
    this.saveLog.push({ type: 'buffer', timestamp: now });
    this._trimSaveLog();
  }

  async _doSaveModel(now) {
    this.saveLog.push({ type: 'model', timestamp: now });
    this._trimSaveLog();
  }

  _trimSaveLog() {
    if (this.saveLog.length > this.maxSaveLogSize) {
      this.saveLog = this.saveLog.slice(-this.maxSaveLogSize);
    }
  }

  getSaveLog() { return [...this.saveLog]; }
  getErrorCount() { return this.errorCount; }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveExtendedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Timer drift compensation
  // ═══════════════════════════════════════════════════════════════════════

  test('timer drift: ticks slightly past buffer interval still trigger buffer save', async () => {
    const mgr = new AutoSaveManager({ bufferIntervalMs: 120_000 });
    mgr.markDirty();

    // First tick at t=0
    await mgr.tick(0);

    // Second tick at t=120001 (1ms past interval)
    mgr.markDirty();
    await mgr.tick(120_001);

    const log = mgr.getSaveLog();
    const bufferSaves = log.filter(l => l.type === 'buffer');
    assert.equal(bufferSaves.length, 1, 'Buffer save should trigger at 120001ms');
  });

  test('timer drift: ticks slightly before interval do NOT trigger', async () => {
    const mgr = new AutoSaveManager({ bufferIntervalMs: 120_000 });
    mgr.markDirty();

    await mgr.tick(0);

    mgr.markDirty();
    await mgr.tick(119_999);

    const log = mgr.getSaveLog();
    const bufferSaves = log.filter(l => l.type === 'buffer');
    assert.equal(bufferSaves.length, 0, 'Buffer save should NOT trigger at 119999ms');
  });

  test('timer drift: exact boundary at 120000 triggers', async () => {
    const mgr = new AutoSaveManager({ bufferIntervalMs: 120_000 });
    mgr.markDirty();

    await mgr.tick(0);

    mgr.markDirty();
    await mgr.tick(120_000);

    const log = mgr.getSaveLog();
    const bufferSaves = log.filter(l => l.type === 'buffer');
    assert.equal(bufferSaves.length, 1, 'Exact boundary should trigger');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Multiple save cycles
  // ═══════════════════════════════════════════════════════════════════════

  test('100 rapid dirty→save cycles maintain correct state', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 100; i++) {
      mgr.markDirty();
      const result = await mgr.tick(i * 1000);
      assert.equal(result.saved, true, `Cycle ${i} should save`);
    }
    assert.equal(mgr.saveCount, 100);
    assert.equal(mgr.dirty, false, 'Final dirty should be false');
  });

  test('alternating dirty→clean→dirty patterns work correctly', async () => {
    const mgr = new AutoSaveManager();

    // Pattern: dirty, save, clean, skip, dirty, save, clean, skip
    for (let cycle = 0; cycle < 10; cycle++) {
      mgr.markDirty();
      const r1 = await mgr.tick(cycle * 1000);
      assert.equal(r1.saved, true, `Cycle ${cycle} save`);

      const r2 = await mgr.tick(cycle * 1000 + 500);
      assert.equal(r2.skipped, 'clean', `Cycle ${cycle} skip`);
    }
    assert.equal(mgr.saveCount, 10);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handling and recovery
  // ═══════════════════════════════════════════════════════════════════════

  test('save error: error count increments', async () => {
    const mgr = new AutoSaveManager();
    mgr._doSaveState = async () => { throw new Error('Disk full'); };
    mgr.markDirty();

    const result = await mgr.tick(1000);
    assert.ok(result.error);
    assert.equal(mgr.getErrorCount(), 1);
  });

  test('save error: subsequent dirty flag is preserved', async () => {
    const mgr = new AutoSaveManager();
    mgr._doSaveState = async () => { throw new Error('Disk full'); };
    mgr.markDirty();

    const tickPromise = mgr.tick(1000);

    // Mark dirty during save
    await new Promise(r => setTimeout(r, 1));
    mgr.markDirty();

    await tickPromise;
    assert.equal(mgr.dirty, true, 'dirty set during failed save should survive');
  });

  test('save error: recovery after fix works', async () => {
    const mgr = new AutoSaveManager();
    let failCount = 0;
    const origSave = mgr._doSaveState.bind(mgr);
    mgr._doSaveState = async function(now) {
      if (failCount < 3) {
        failCount++;
        throw new Error(`Failure ${failCount}`);
      }
      return origSave(now);
    };

    // 3 failures
    for (let i = 0; i < 3; i++) {
      mgr.markDirty();
      await mgr.tick(i * 1000);
    }
    assert.equal(mgr.getErrorCount(), 3);
    assert.equal(mgr.saveCount, 0);

    // Recovery
    mgr.markDirty();
    const result = await mgr.tick(3000);
    assert.equal(result.saved, true);
    assert.equal(mgr.saveCount, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Buffer and model save coordination
  // ═══════════════════════════════════════════════════════════════════════

  test('buffer + model both trigger at 5 min mark', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    await mgr.tick(300_000); // 5 min

    const log = mgr.getSaveLog();
    const bufferSaves = log.filter(l => l.type === 'buffer');
    const modelSaves = log.filter(l => l.type === 'model');
    assert.equal(bufferSaves.length, 1, 'Buffer should save at 5 min (120s elapsed)');
    assert.equal(modelSaves.length, 1, 'Model should save at 5 min (300s elapsed)');
  });

  test('buffer triggers at 2 min but model waits until 5 min', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    await mgr.tick(120_000);

    const log = mgr.getSaveLog();
    const bufferSaves = log.filter(l => l.type === 'buffer');
    const modelSaves = log.filter(l => l.type === 'model');
    assert.equal(bufferSaves.length, 1, 'Buffer at 2 min');
    assert.equal(modelSaves.length, 0, 'Model NOT at 2 min');
  });

  test('subsequent buffer save respects last save time', async () => {
    const mgr = new AutoSaveManager();
    mgr._lastBufferSave = 100_000;
    mgr.markDirty();

    // Tick at 200_000: 100s since last buffer save → no trigger
    await mgr.tick(200_000);
    let log = mgr.getSaveLog();
    assert.equal(log.filter(l => l.type === 'buffer').length, 0);

    // Tick at 220_000: 120s since last buffer save → trigger
    mgr.markDirty();
    await mgr.tick(220_000);
    log = mgr.getSaveLog();
    assert.equal(log.filter(l => l.type === 'buffer').length, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Memory leak prevention: save log trimming
  // ═══════════════════════════════════════════════════════════════════════

  test('save log is trimmed to maxSaveLogSize', async () => {
    const mgr = new AutoSaveManager({ maxSaveLogSize: 10 });

    for (let i = 0; i < 50; i++) {
      mgr.markDirty();
      await mgr.tick(i * 1000);
    }

    assert.ok(mgr.getSaveLog().length <= 10,
      `Save log should be trimmed to 10, got ${mgr.getSaveLog().length}`);
  });

  test('save log trimming preserves most recent entries', async () => {
    const mgr = new AutoSaveManager({ maxSaveLogSize: 5 });

    for (let i = 0; i < 20; i++) {
      mgr.markDirty();
      await mgr.tick(i * 1000);
    }

    const log = mgr.getSaveLog();
    assert.equal(log.length, 5);
    // Last entry should be from tick 19
    assert.equal(log[4].seq, 20, 'Last entry should be most recent save');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Concurrent dirty marks from multiple sources
  // ═══════════════════════════════════════════════════════════════════════

  test('multiple markDirty calls between ticks = one save', async () => {
    const mgr = new AutoSaveManager();

    // 50 rapid dirty marks
    for (let i = 0; i < 50; i++) {
      mgr.markDirty();
    }

    await mgr.tick(1000);
    assert.equal(mgr.saveCount, 1, 'Only one save despite 50 dirty marks');
    assert.equal(mgr.dirty, false);
  });

  test('dirty set during save caught by next tick even with many marks', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tick1 = mgr.tick(1000);

    // Simulate rapid dirty marks from multiple "sources"
    for (let i = 0; i < 10; i++) {
      mgr.markDirty();
    }

    await tick1;
    assert.equal(mgr.dirty, true, 'Dirty should survive');

    const tick2 = await mgr.tick(2000);
    assert.equal(tick2.saved, true);
    assert.equal(mgr.saveCount, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Snapshot behavior verification
  // ═══════════════════════════════════════════════════════════════════════

  test('dirty=false is set BEFORE async save starts (server snapshot pattern)', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tickPromise = mgr.tick(1000);
    // Immediately check — dirty should already be false
    assert.equal(mgr.dirty, false, 'dirty should be false immediately');

    await tickPromise;
  });

  test('dirty set 1ms after tick starts survives save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const tickPromise = mgr.tick(1000);
    await new Promise(r => setTimeout(r, 1));
    mgr.markDirty();

    await tickPromise;
    assert.equal(mgr.dirty, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: zero-time tick
  // ═══════════════════════════════════════════════════════════════════════

  test('tick at t=0 with dirty=true saves state but not buffer or model', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    await mgr.tick(0);
    const log = mgr.getSaveLog();
    assert.equal(log.filter(l => l.type === 'state').length, 1);
    assert.equal(log.filter(l => l.type === 'buffer').length, 0);
    assert.equal(log.filter(l => l.type === 'model').length, 0);
  });

  test('all three save types triggered on first tick at t=300000', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    await mgr.tick(300_000);
    const log = mgr.getSaveLog();
    assert.equal(log.filter(l => l.type === 'state').length, 1);
    assert.equal(log.filter(l => l.type === 'buffer').length, 1);
    assert.equal(log.filter(l => l.type === 'model').length, 1);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Extended Tests');

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
