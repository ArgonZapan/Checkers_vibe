/**
 * hunter-v3-autosave-lock-edge.test.js — Auto-save lock and dirty flag edge cases.
 *
 * Covers gaps NOT in autoSaveRaceCondition.test.js:
 * - acquireLock: sequential locking preserves order
 * - acquireLock: multiple concurrent acquireLock calls serialize correctly
 * - Dirty flag set DURING save is captured by next cycle
 * - Save error: dirty flag preserved (shouldn't clear on failure)
 * - Lock held during reset blocks auto-save
 * - Auto-save with lock contention: save waits for reset to finish
 * - Dirty flag race: save clears dirty, but dirty set again → next save runs
 * - Empty interval: nothing dirty → no save
 */

import assert from 'node:assert/strict';

// ── Extracted: lock mechanism (mirrors server/index.js) ────────────────────

function createLockManager() {
  let _saveLock = Promise.resolve();

  function acquireLock() {
    let release;
    const prev = _saveLock;
    _saveLock = new Promise(resolve => { release = resolve; });
    return prev.then(() => release);
  }

  return { acquireLock, getLock: () => _saveLock };
}

// ── Extracted: auto-save with dirty flag and lock ──────────────────────────

class AutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this._saveLock = Promise.resolve();
    this.saveCount = 0;
    this.saveErrors = [];
    this.log = [];
  }

  acquireLock() {
    let release;
    const prev = this._saveLock;
    this._saveLock = new Promise(resolve => { release = resolve; });
    return prev.then(() => release);
  }

  async tick(opts = {}) {
    if (this._saving) {
      this.log.push({ action: 'skip', reason: 'saving' });
      return;
    }

    let release;
    try {
      release = await this.acquireLock();
    } catch (_) {
      this.log.push({ action: 'skip', reason: 'lock-failed' });
      return;
    }

    if (!this.dirty) {
      release();
      this.log.push({ action: 'skip', reason: 'clean' });
      return;
    }

    try {
      this._saving = true;
      // Snapshot dirty BEFORE async save
      this.dirty = false;

      if (opts.simulateDelay) {
        await new Promise(r => setTimeout(r, opts.delayMs || 10));
      }

      if (opts.fail) {
        throw new Error('Save failed');
      }

      this.saveCount++;
      this.log.push({ action: 'save', count: this.saveCount });
    } catch (err) {
      this.saveErrors.push(err.message);
      this.log.push({ action: 'error', error: err.message });
      // IMPORTANT: don't restore dirty on error — let next cycle handle it
      // Actually, we SHOULD keep dirty=true if save failed
      this.dirty = true;
    } finally {
      this._saving = false;
      release();
    }
  }

  markDirty() {
    this.dirty = true;
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveLockEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Lock ordering ───────────────────────────────────────────────────

  test('acquireLock: sequential calls execute in order', async () => {
    const { acquireLock } = createLockManager();
    const log = [];

    const p1 = acquireLock().then(release => {
      log.push('p1-acquired');
      release();
      log.push('p1-released');
    });

    const p2 = acquireLock().then(release => {
      log.push('p2-acquired');
      release();
      log.push('p2-released');
    });

    await Promise.all([p1, p2]);
    // p1 must fully complete before p2 starts
    assert.equal(log[0], 'p1-acquired');
    assert.equal(log[1], 'p1-released');
    assert.equal(log[2], 'p2-acquired');
    assert.equal(log[3], 'p2-released');
  });

  test('acquireLock: 3 concurrent calls serialize correctly', async () => {
    const { acquireLock } = createLockManager();
    const log = [];

    const p1 = acquireLock().then(release => {
      log.push(1);
      release();
    });

    const p2 = acquireLock().then(release => {
      log.push(2);
      release();
    });

    const p3 = acquireLock().then(release => {
      log.push(3);
      release();
    });

    await Promise.all([p1, p2, p3]);
    assert.deepEqual(log, [1, 2, 3]);
  });

  // ── Dirty flag behavior ─────────────────────────────────────────────

  test('clean state: tick skips save', async () => {
    const mgr = new AutoSaveManager();
    await mgr.tick();
    assert.equal(mgr.saveCount, 0);
    assert.ok(mgr.log.some(l => l.reason === 'clean'));
  });

  test('dirty state: tick performs save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.tick();
    assert.equal(mgr.saveCount, 1);
  });

  test('dirty set during save: captured by next tick', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // First tick — will save
    const t1 = mgr.tick({ simulateDelay: true, delayMs: 5 });

    // Set dirty DURING the save
    setTimeout(() => mgr.markDirty(), 1);

    await t1;
    assert.equal(mgr.saveCount, 1);
    assert.equal(mgr.dirty, true, 'dirty should be true (set during save)');

    // Second tick — should save again
    await mgr.tick();
    assert.equal(mgr.saveCount, 2);
  });

  test('save error: dirty flag preserved', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.tick({ fail: true });
    assert.equal(mgr.saveCount, 0);
    assert.equal(mgr.dirty, true, 'dirty preserved after save error');
    assert.ok(mgr.saveErrors.length > 0);
  });

  test('save error: next tick retries', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.tick({ fail: true });
    assert.equal(mgr.saveCount, 0);
    // Next tick should succeed
    await mgr.tick();
    assert.equal(mgr.saveCount, 1);
  });

  // ── Lock contention ──────────────────────────────────────────────────

  test('lock held by reset blocks auto-save tick', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // Acquire lock but don't release
    const release = await mgr.acquireLock();

    // tick should wait for lock — start it
    const tickPromise = mgr.tick({ simulateDelay: true, delayMs: 1 });
    // Give it a moment to try acquiring lock
    await new Promise(r => setTimeout(r, 5));
    // Save should not have completed yet
    assert.equal(mgr.saveCount, 0);

    // Release lock — now tick can proceed
    release();
    await tickPromise;
    assert.equal(mgr.saveCount, 1);
  });

  test('auto-save waits for reset to finish', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    const log = [];

    // Acquire lock first (simulating reset holding it)
    const release = await mgr.acquireLock();
    log.push('reset-start');

    // Start tick (will block on lock)
    const savePromise = mgr.tick().then(() => log.push('save-done'));

    // Let tick try to acquire lock
    await new Promise(r => setTimeout(r, 5));
    assert.equal(log.length, 1, 'save should not have completed yet');
    assert.equal(log[0], 'reset-start');

    // Release lock — save can now proceed
    release();
    await savePromise;

    assert.ok(log.includes('reset-start'));
    assert.ok(log.includes('save-done'));
    assert.ok(log.indexOf('reset-start') < log.indexOf('save-done'), 'reset-start before save-done');
  });

  // ── _saving guard ───────────────────────────────────────────────────

  test('concurrent tick calls: second one skips', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();

    // First tick starts (with delay)
    const t1 = mgr.tick({ simulateDelay: true, delayMs: 20 });
    // Second tick immediately — should skip because _saving is true
    await new Promise(r => setTimeout(r, 1));
    const t2 = mgr.tick();

    await Promise.all([t1, t2]);
    assert.equal(mgr.saveCount, 1);
    assert.ok(mgr.log.some(l => l.reason === 'saving'));
  });

  // ── Rapid dirty/tick cycle ──────────────────────────────────────────

  test('rapid dirty/tick: each dirty is captured', async () => {
    const mgr = new AutoSaveManager();

    for (let i = 0; i < 5; i++) {
      mgr.markDirty();
      await mgr.tick();
    }
    assert.equal(mgr.saveCount, 5);
  });

  test('dirty set between ticks: both ticks save', async () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    await mgr.tick();
    assert.equal(mgr.saveCount, 1);

    // Set dirty again
    mgr.markDirty();
    await mgr.tick();
    assert.equal(mgr.saveCount, 2);
  });

  test('no dirty set: no saves across multiple ticks', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 10; i++) {
      await mgr.tick();
    }
    assert.equal(mgr.saveCount, 0);
    assert.ok(mgr.log.every(l => l.reason === 'clean'));
  });

  // ── Run tests ────────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  Auto-save lock edge: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

if (process.argv[1]?.includes('hunter-v3-autosave-lock-edge')) {
  runAutoSaveLockEdgeTests().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
