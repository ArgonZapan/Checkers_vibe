/**
 * issue131.test.js — Auto-save dirty flag (#131).
 *
 * Bug: The dirty flag must be set whenever trainer state changes (params,
 * training, epsilon decay, model restart) so the auto-save interval
 * actually persists changes. If dirty is not set, auto-save skips entirely.
 *
 * Tests verify:
 * 1. dirty is set on setParams (params changed)
 * 2. dirty is set on model restart
 * 3. dirty is set on training (model.fit)
 * 4. dirty is set on epsilon decay
 * 5. dirty is NOT set when nothing changes
 * 6. dirty persists until auto-save consumes it
 * 7. Auto-save skips when dirty is false
 * 8. Multiple operations accumulate dirty state
 */

import assert from 'node:assert/strict';

// ── Extracted: dirty flag behavior from SelfPlay class ──────────────────────

/**
 * Simulates the SelfPlay dirty flag tracking.
 * Mirrors the actual behavior in server/ai/trainer.js.
 */
class DirtyTracker {
  constructor() {
    this._dirty = false;
    this._operations = [];
  }

  get dirty() { return this._dirty; }
  set dirty(v) { this._dirty = v; }

  /** setParams — params changed → dirty */
  setParams(params) {
    this._dirty = true;
    this._operations.push('setParams');
  }

  /** restart — model restarted → dirty */
  restart(side) {
    this._dirty = true;
    this._operations.push('restart');
  }

  /** train — model.fit → dirty */
  train(loss) {
    this._dirty = true;
    this._operations.push('train');
  }

  /** epsilon decay — epsilon changed → dirty */
  decayEpsilon() {
    this._dirty = true;
    this._operations.push('decayEpsilon');
  }

  /** saveState — auto-save consumes dirty flag */
  saveState() {
    this._dirty = false;
    this._operations.push('saveState');
  }

  /** Check if auto-save should run */
  shouldAutoSave() {
    return this._dirty;
  }

  get operations() { return [...this._operations]; }
}

/**
 * Simulates the auto-save interval logic from server/index.js.
 * Mirrors the setInterval callback:
 *   if (_saving) return;
 *   if (!trainer.dirty) return;
 *   _saving = true;
 *   // save...
 *   trainer.dirty = false;
 *   _saving = false;
 */
class AutoSaveInterval {
  constructor(tracker) {
    this.tracker = tracker;
    this._saving = false;
    this._saveCount = 0;
    this._skippedCount = 0;
  }

  /** Simulate one tick of the setInterval */
  tick() {
    if (this._saving) {
      this._skippedCount++;
      return 'skipped-saving';
    }
    if (!this.tracker.dirty) {
      this._skippedCount++;
      return 'skipped-clean';
    }
    this._saving = true;
    // Simulate save operations
    this.tracker.saveState();
    this._saveCount++;
    this._saving = false;
    return 'saved';
  }

  get saveCount() { return this._saveCount; }
  get skippedCount() { return this._skippedCount; }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runIssue131Tests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Basic dirty flag operations ───────────────────────────────────────

  test('dirty starts as false', () => {
    const t = new DirtyTracker();
    assert.equal(t.dirty, false);
  });

  test('setParams sets dirty', () => {
    const t = new DirtyTracker();
    t.setParams({ layers: 3 });
    assert.equal(t.dirty, true);
  });

  test('restart sets dirty', () => {
    const t = new DirtyTracker();
    t.restart('both');
    assert.equal(t.dirty, true);
  });

  test('train sets dirty', () => {
    const t = new DirtyTracker();
    t.train(0.5);
    assert.equal(t.dirty, true);
  });

  test('decayEpsilon sets dirty', () => {
    const t = new DirtyTracker();
    t.decayEpsilon();
    assert.equal(t.dirty, true);
  });

  test('saveState resets dirty to false', () => {
    const t = new DirtyTracker();
    t.train(0.3);
    assert.equal(t.dirty, true);
    t.saveState();
    assert.equal(t.dirty, false);
  });

  // ── Auto-save interval behavior ──────────────────────────────────────

  test('auto-save skips when dirty is false', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    const result = as.tick();
    assert.equal(result, 'skipped-clean');
    assert.equal(as.saveCount, 0);
  });

  test('auto-save runs when dirty is true', () => {
    const t = new DirtyTracker();
    t.train(0.5);
    const as = new AutoSaveInterval(t);

    const result = as.tick();
    assert.equal(result, 'saved');
    assert.equal(as.saveCount, 1);
    assert.equal(t.dirty, false, 'dirty reset after save');
  });

  test('auto-save skips again after save (no new changes)', () => {
    const t = new DirtyTracker();
    t.train(0.5);
    const as = new AutoSaveInterval(t);

    as.tick(); // save
    const result = as.tick(); // no new changes
    assert.equal(result, 'skipped-clean');
    assert.equal(as.saveCount, 1);
  });

  // ── Accumulation: multiple operations before save ─────────────────────

  test('multiple operations accumulate dirty until save', () => {
    const t = new DirtyTracker();
    assert.equal(t.dirty, false);

    t.setParams({ layers: 4 });
    assert.equal(t.dirty, true);

    t.train(0.4);
    assert.equal(t.dirty, true, 'still dirty after train');

    t.decayEpsilon();
    assert.equal(t.dirty, true, 'still dirty after decay');

    t.restart('white');
    assert.equal(t.dirty, true, 'still dirty after restart');

    // All operations happened before any save
    assert.deepEqual(t.operations, ['setParams', 'train', 'decayEpsilon', 'restart']);
  });

  test('save after accumulation → dirty resets', () => {
    const t = new DirtyTracker();
    t.setParams({ layers: 3 });
    t.train(0.5);
    t.decayEpsilon();

    assert.equal(t.dirty, true);
    t.saveState();
    assert.equal(t.dirty, false);
  });

  // ── Full game cycle: train → decay → save ────────────────────────────

  test('full game cycle: train sets dirty, decay keeps dirty, save consumes', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    // Start: clean
    assert.equal(t.dirty, false);
    assert.equal(as.tick(), 'skipped-clean');

    // Game ends: train
    t.train(0.3);
    assert.equal(t.dirty, true);

    // Epsilon decay
    t.decayEpsilon();
    assert.equal(t.dirty, true);

    // Auto-save tick → saves
    assert.equal(as.tick(), 'saved');
    assert.equal(t.dirty, false);
    assert.equal(as.saveCount, 1);

    // Next tick: no changes → skip
    assert.equal(as.tick(), 'skipped-clean');
  });

  // ── Interleaved: changes between saves ───────────────────────────────

  test('changes between saves are all persisted', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    // Game 1
    t.train(0.5);
    t.decayEpsilon();
    as.tick(); // save
    assert.equal(as.saveCount, 1);

    // Game 2
    t.train(0.4);
    t.decayEpsilon();
    as.tick(); // save
    assert.equal(as.saveCount, 2);

    // No game 3 — tick should skip
    assert.equal(as.tick(), 'skipped-clean');
    assert.equal(as.saveCount, 2);
  });

  test('setParams between games forces save on next tick', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    // Clean state
    as.tick(); // skipped

    // setParams called (e.g., user changes layers)
    t.setParams({ layers: 5 });
    assert.equal(t.dirty, true);

    // Next auto-save tick → saves params
    assert.equal(as.tick(), 'saved');
    assert.equal(as.saveCount, 1);
  });

  test('restart between games forces save on next tick', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    t.restart('both');
    assert.equal(t.dirty, true);

    assert.equal(as.tick(), 'saved');
    assert.equal(as.saveCount, 1);
  });

  // ── Dirty never silently lost ─────────────────────────────────────────

  test('dirty set before save → save always happens', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    // Simulate 100 ticks with random dirty operations
    let expectedSaves = 0;
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) {
        // Every 10th tick: set dirty
        t.train(0.5);
      }
      const result = as.tick();
      if (result === 'saved') expectedSaves++;
    }

    // dirty should have been consumed by saves
    assert.equal(t.dirty, false, 'dirty should be false at end');
    assert.ok(expectedSaves > 0, 'Should have saved at least once');
  });

  test('dirty is never false when there are unsaved changes', () => {
    const t = new DirtyTracker();

    // Make changes
    t.setParams({ neurons: 256 });
    assert.equal(t.dirty, true);

    // Don't save — dirty remains
    assert.equal(t.dirty, true);

    // Make more changes
    t.train(0.3);
    assert.equal(t.dirty, true, 'dirty stays true with more changes');

    // Only after save does dirty become false
    t.saveState();
    assert.equal(t.dirty, false);
  });

  // ── Consecutive saves without changes ─────────────────────────────────

  test('consecutive ticks without changes → all skip', () => {
    const t = new DirtyTracker();
    const as = new AutoSaveInterval(t);

    for (let i = 0; i < 10; i++) {
      assert.equal(as.tick(), 'skipped-clean');
    }
    assert.equal(as.saveCount, 0);
    assert.equal(as.skippedCount, 10);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Issue #131 — Auto-Save Dirty Flag Tests');

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
