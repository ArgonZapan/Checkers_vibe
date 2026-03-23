/**
 * autoSaveDirtySnapshot.test.js — Tests for auto-save dirty flag snapshot behavior.
 *
 * Covers gaps in autoSaveRaceCondition.test.js:
 *
 * The ACTUAL server behavior (server/index.js:782-785):
 *   _saving = true;
 *   trainer.dirty = false;   // snapshot: reset BEFORE async save
 *   await trainer.saveState();
 *
 * This is DIFFERENT from the test simulation in autoSaveRaceCondition.test.js
 * which conditionally clears dirty. The server's approach works because:
 * - dirty is only set to true by markDirty()
 * - dirty is only set to false by the save interval
 * - If markDirty() fires during save, dirty=true survives (server already set false)
 *
 * Tests here verify the ACTUAL server behavior, not the optimistic simulation.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: ACTUAL server auto-save behavior ────────────────────────────

/**
 * AutoSaveManager that mirrors the EXACT server/index.js behavior:
 *   _saving = true;
 *   trainer.dirty = false;  // reset BEFORE save
 *   await trainer.saveState();
 *
 * NOT the optimistic "only clear if not re-dirtied" approach.
 */
class ServerAutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this.saveCount = 0;
    this.saveErrors = [];
    this._intervalId = null;
    this.bufferSaveCount = 0;
    this.modelSaveCount = 0;
    this._lastBufferSave = 0;
    this._lastModelSave = 0;
  }

  markDirty() {
    this.dirty = true;
  }

  /**
   * Simulates a single auto-save tick — mirrors server/index.js setInterval body.
   */
  async tick(now = Date.now()) {
    if (this._saving) return { skipped: 'saving' };
    if (!this.dirty) return { skipped: 'clean' };

    try {
      this._saving = true;
      // CRITICAL: snapshot dirty BEFORE save (server behavior)
      this.dirty = false;

      // State save (always when dirty)
      await this._saveState();

      // Buffer save (every 2 min)
      if (now - this._lastBufferSave >= 120_000) {
        await this._saveBuffer();
        this._lastBufferSave = now;
      }

      // Model save (every 5 min)
      if (now - this._lastModelSave >= 300_000) {
        await this._saveModel();
        this._lastModelSave = now;
      }

      return { saved: true };
    } catch (err) {
      this.saveErrors.push(err.message);
      return { error: err.message };
    } finally {
      this._saving = false;
    }
  }

  async _saveState(delayMs = 5) {
    await new Promise(r => setTimeout(r, delayMs));
    this.saveCount++;
  }

  async _saveBuffer() {
    this.bufferSaveCount++;
  }

  async _saveModel() {
    this.modelSaveCount++;
  }

  /**
   * Start a repeating interval (like setInterval in server).
   */
  startInterval(intervalMs = 30_000) {
    this._intervalId = setInterval(() => this.tick(), intervalMs);
  }

  stopInterval() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveDirtySnapshotTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Server behavior: dirty=false BEFORE save
  // ═══════════════════════════════════════════════════════════════════════

  test('server behavior: dirty is reset to false BEFORE async save starts', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    // Start tick — dirty should be false immediately (before save completes)
    const tickPromise = mgr.tick();
    // Check immediately — dirty should already be false
    assert.equal(mgr.dirty, false, 'dirty should be false immediately when tick starts');

    await tickPromise;
    assert.equal(mgr.saveCount, 1, 'Save should have completed');
  });

  test('server behavior: dirty set during save survives (already false, set to true)', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    // Start a slow save
    const tickPromise = mgr.tick(Date.now());

    // Mark dirty during save — this sets dirty=true on top of dirty=false
    await new Promise(r => setTimeout(r, 2));
    mgr.markDirty();

    await tickPromise;

    // dirty should be true (markDirty set it during save)
    assert.equal(mgr.dirty, true, 'dirty=true set during save survives');
  });

  test('server behavior: second tick catches dirty set during first save', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    // First tick
    const tick1 = mgr.tick();
    await new Promise(r => setTimeout(r, 2));
    mgr.markDirty(); // dirty during save
    await tick1;

    assert.equal(mgr.dirty, true);

    // Second tick should save again
    const result = await mgr.tick();
    assert.equal(result.saved, true);
    assert.equal(mgr.saveCount, 2, 'Both saves should complete');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // No changes between ticks → skip
  // ═══════════════════════════════════════════════════════════════════════

  test('tick skips when no changes since last save', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();
    await mgr.tick();

    // No markDirty() between ticks
    const result = await mgr.tick();
    assert.equal(result.skipped, 'clean');
    assert.equal(mgr.saveCount, 1, 'Only first tick should save');
  });

  test('multiple clean ticks all skip', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();
    await mgr.tick();

    for (let i = 0; i < 5; i++) {
      const result = await mgr.tick();
      assert.equal(result.skipped, 'clean', `Tick ${i + 1} should skip`);
    }
    assert.equal(mgr.saveCount, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Concurrent save guard
  // ═══════════════════════════════════════════════════════════════════════

  test('concurrent tick skipped while save in progress', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Second tick while first is in-flight
    const result = await mgr.tick();
    assert.equal(result.skipped, 'saving', 'Second tick should be skipped');

    await tick1;
    assert.equal(mgr.saveCount, 1);
  });

  test('tick resumes after save completes', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();
    await mgr.tick();

    // New change
    mgr.markDirty();
    const result = await mgr.tick();
    assert.equal(result.saved, true);
    assert.equal(mgr.saveCount, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error handling — server behavior
  // ═══════════════════════════════════════════════════════════════════════

  test('save error: dirty was already reset (server sets false before save)', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr._saveState = async () => { throw new Error('Disk full'); };

    mgr.markDirty();
    const result = await mgr.tick();

    assert.ok(result.error);
    // In server behavior: dirty was set to false BEFORE the error
    // If no one called markDirty() during save, dirty stays false!
    // This means the state change is LOST (potential data loss)
    assert.equal(mgr.dirty, false, 'dirty was reset before save (server behavior)');
    assert.equal(mgr.saveCount, 0, 'No save completed');
  });

  test('save error + markDirty during save: dirty survives', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr._saveState = async () => {
      await new Promise(r => setTimeout(r, 10));
      throw new Error('Disk full');
    };

    mgr.markDirty();
    const tickPromise = mgr.tick();

    // Mark dirty during the failing save
    await new Promise(r => setTimeout(r, 5));
    mgr.markDirty();

    const result = await tickPromise;
    assert.ok(result.error);
    assert.equal(mgr.dirty, true, 'dirty set during error save survives');

    // Recovery save
    mgr._saveState = async function() { this.saveCount++; }.bind(mgr);
    const recovery = await mgr.tick();
    assert.equal(recovery.saved, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Buffer/model save timing
  // ═══════════════════════════════════════════════════════════════════════

  test('buffer save triggered at 2 min mark', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    // First tick at t=0: no buffer save (0 < 120000)
    await mgr.tick(0);
    assert.equal(mgr.bufferSaveCount, 0);

    mgr.markDirty();

    // Second tick at t=120000: buffer save triggered
    await mgr.tick(120_000);
    assert.equal(mgr.bufferSaveCount, 1);
    assert.equal(mgr.saveCount, 2);
  });

  test('model save triggered at 5 min mark', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    await mgr.tick(0);
    assert.equal(mgr.modelSaveCount, 0);

    mgr.markDirty();

    await mgr.tick(300_000);
    assert.equal(mgr.modelSaveCount, 1);
  });

  test('all three saves triggered at 5 min mark', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    await mgr.tick(300_000);
    assert.equal(mgr.saveCount, 1, 'state saved');
    assert.equal(mgr.bufferSaveCount, 1, 'buffer saved (120s elapsed)');
    assert.equal(mgr.modelSaveCount, 1, 'model saved (300s elapsed)');
  });

  test('buffer save respects interval (not triggered at 1 min)', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr._lastBufferSave = 100_000;
    mgr.markDirty();

    await mgr.tick(160_000); // 60s since last buffer save
    assert.equal(mgr.bufferSaveCount, 0, 'buffer not saved (only 60s elapsed)');
  });

  test('buffer save triggered after interval (not before)', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr._lastBufferSave = 100_000;
    mgr.markDirty();

    await mgr.tick(220_000); // 120s since last buffer save
    assert.equal(mgr.bufferSaveCount, 1, 'buffer saved (120s elapsed)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Rapid dirty cycle (simulates fast gameplay)
  // ═══════════════════════════════════════════════════════════════════════

  test('rapid dirty→save→dirty→save cycle works correctly', async () => {
    const mgr = new ServerAutoSaveManager();

    for (let i = 0; i < 10; i++) {
      mgr.markDirty();
      const result = await mgr.tick();
      assert.equal(result.saved, true, `Cycle ${i}: saved`);
    }
    assert.equal(mgr.saveCount, 10);
  });

  test('dirty set 100 times between saves only triggers 1 save', async () => {
    const mgr = new ServerAutoSaveManager();
    mgr.markDirty();

    // Simulate 100 rapid state changes
    for (let i = 0; i < 100; i++) {
      mgr.markDirty();
    }

    await mgr.tick();
    assert.equal(mgr.saveCount, 1, 'Only one save despite 100 dirty marks');
    assert.equal(mgr.dirty, false);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Dirty Snapshot (Server Behavior) Tests');

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
