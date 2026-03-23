/**
 * autoSaveRaceCondition.test.js — Tests for auto-save race conditions.
 *
 * Tests the behavior of dirty flag during concurrent save operations:
 * 1. dirty=true → save starts → dirty set to true during save → next save catches it
 * 2. dirty=false → save interval skips
 * 3. save error doesn't lose dirty flag
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: auto-save manager simulating concurrent saves ────────────────

/**
 * AutoSaveManager simulates the save loop from server/index.js.
 *
 * Key behavior:
 * - `dirty` flag tracks whether state has changed since last save
 * - `_saving` guard prevents concurrent saves
 * - If dirty changes during a save, the next interval picks it up
 * - Save errors must not clear the dirty flag
 */
class AutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this.saveCount = 0;
    this.saveErrors = [];
    this.saveHistory = [];
  }

  /**
   * Attempt a save. Returns what was saved.
   * Simulates async save with optional delay and failure.
   */
  async save(opts = {}) {
    if (this._saving) return { skipped: true, reason: 'concurrent' };

    this._saving = true;
    const wasDirty = this.dirty;
    // Snapshot: track if dirty gets set again during the save
    let dirtySetDuringSave = false;
    const origMarkDirty = this.markDirty.bind(this);
    this.markDirty = () => { this.dirty = true; dirtySetDuringSave = true; };

    try {
      // Simulate async save
      if (opts.delayMs) {
        await new Promise(r => setTimeout(r, opts.delayMs));
      }

      if (opts.fail) {
        throw new Error(opts.failMessage || 'Save failed');
      }

      // Save succeeded — clear dirty only if no new dirtiness appeared during save
      if (wasDirty) {
        this.saveCount++;
        this.saveHistory.push({ timestamp: Date.now(), dirty: wasDirty });
        // Only clear dirty if it wasn't set again during the save
        if (!dirtySetDuringSave) {
          this.dirty = false;
        }
      }

      return { saved: wasDirty, saveCount: this.saveCount };
    } catch (err) {
      this.saveErrors.push(err.message);
      // CRITICAL: do NOT clear dirty flag on error
      return { error: err.message, dirtyPreserved: this.dirty };
    } finally {
      this._saving = false;
      this.markDirty = origMarkDirty;
    }
  }

  /**
   * Mark state as dirty (something changed).
   */
  markDirty() {
    this.dirty = true;
  }

  /**
   * Check if save should run (simulates interval tick).
   */
  shouldSave() {
    return !this._saving && this.dirty;
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveRaceConditionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Scenario 1: dirty during save ────────────────────────────────────

  test('dirty set during save is caught by next save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty(); // initial dirty

    // Start a save that takes some time
    const save1 = mgr.save({ delayMs: 20 });

    // While save is in-flight, mark dirty again
    await new Promise(r => setTimeout(r, 5));
    mgr.markDirty(); // new changes during save

    // Wait for first save to complete
    await save1;

    // dirty should still be true (set during the first save)
    assert.equal(mgr.dirty, true, 'dirty is still true after save completes (set during save)');

    // Second save should catch it
    const result = await mgr.save();
    assert.equal(result.saved, true, 'Second save picks up dirty flag');
    assert.equal(mgr.dirty, false, 'dirty cleared after second save');
    assert.equal(mgr.saveCount, 2, 'Two saves completed');
  });

  test('rapid dirty changes during save all get persisted', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Start slow save
    const save1 = mgr.save({ delayMs: 50 });

    // Rapidly mark dirty multiple times during save
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 5));
      mgr.markDirty();
    }

    await save1;

    // dirty should be true (set during save)
    assert.equal(mgr.dirty, true, 'dirty is true after rapid changes during save');

    // Next save catches it
    await mgr.save();
    assert.equal(mgr.saveCount, 2, 'Both saves recorded');
    assert.equal(mgr.dirty, false, 'dirty cleared after second save');
  });

  // ── Scenario 2: dirty=false skips save ───────────────────────────────

  test('save interval skips when dirty is false', async () => {
    const mgr = new AutoSaveManager();
    assert.equal(mgr.dirty, false, 'Initially not dirty');

    const result = await mgr.save();
    assert.equal(result.saved, false, 'Nothing saved when not dirty');
    assert.equal(mgr.saveCount, 0, 'saveCount unchanged');
  });

  test('shouldSave returns false when not dirty', () => {
    const mgr = new AutoSaveManager();
    assert.equal(mgr.shouldSave(), false, 'shouldSave is false when not dirty');
  });

  test('shouldSave returns false during concurrent save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Start a save
    const savePromise = mgr.save({ delayMs: 30 });

    // shouldSave should return false (saving guard)
    assert.equal(mgr.shouldSave(), false, 'shouldSave blocked by _saving guard');

    await savePromise;
  });

  test('dirty=true after clean save allows next save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.save();

    assert.equal(mgr.dirty, false, 'dirty cleared');

    mgr.markDirty(); // new change
    assert.equal(mgr.shouldSave(), true, 'shouldSave is true after marking dirty again');

    await mgr.save();
    assert.equal(mgr.saveCount, 2, 'Second save completed');
  });

  // ── Scenario 3: save error doesn't lose dirty flag ───────────────────

  test('save error preserves dirty flag', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const result = await mgr.save({ fail: true, failMessage: 'Disk full' });

    assert.ok(result.error, 'Save returned error');
    assert.equal(mgr.dirty, true, 'dirty flag preserved after error');
    assert.equal(mgr.saveErrors.length, 1, 'Error recorded');
    assert.equal(mgr.saveErrors[0], 'Disk full');
  });

  test('save error preserves dirty flag even with delay', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const result = await mgr.save({ fail: true, delayMs: 10, failMessage: 'Network timeout' });

    assert.ok(result.error, 'Save returned error');
    assert.equal(mgr.dirty, true, 'dirty preserved after delayed error');
    assert.equal(mgr.saveCount, 0, 'saveCount not incremented on error');
  });

  test('dirty set during failed save is preserved', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Start save that will fail after delay
    const save1 = mgr.save({ fail: true, delayMs: 20, failMessage: 'Connection lost' });

    // Set dirty during the failing save
    await new Promise(r => setTimeout(r, 5));
    mgr.markDirty();

    const result = await save1;
    assert.ok(result.error, 'Save failed');

    // dirty should still be true
    assert.equal(mgr.dirty, true, 'dirty preserved after failed save');

    // Next save should succeed
    const result2 = await mgr.save();
    assert.equal(result2.saved, true, 'Recovery save succeeds');
    assert.equal(mgr.dirty, false, 'dirty cleared after recovery save');
  });

  test('multiple consecutive errors preserve dirty, recovery works', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Three failed saves
    for (let i = 0; i < 3; i++) {
      await mgr.save({ fail: true, failMessage: `Error ${i}` });
    }

    assert.equal(mgr.dirty, true, 'dirty preserved through 3 errors');
    assert.equal(mgr.saveErrors.length, 3, 'All errors recorded');
    assert.equal(mgr.saveCount, 0, 'No successful saves');

    // Recovery
    const result = await mgr.save();
    assert.equal(result.saved, true, 'Recovery save succeeds');
    assert.equal(mgr.saveCount, 1, 'saveCount incremented');
    assert.equal(mgr.dirty, false, 'dirty cleared');
  });

  // ── Concurrency guard ────────────────────────────────────────────────

  test('concurrent save calls: second is skipped', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    const save1 = mgr.save({ delayMs: 30 });
    const save2 = mgr.save(); // should be skipped

    const results = await Promise.all([save1, save2]);

    assert.equal(results[1].skipped, true, 'Second save was skipped');
    assert.equal(results[0].saved, true, 'First save completed');
    assert.equal(mgr.saveCount, 1, 'Only one save counted');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Race Condition Tests');

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
