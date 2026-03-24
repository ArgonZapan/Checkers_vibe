/**
 * autoSave-rapid-dirty.test.js — Tests for auto-save dirty flag under
 * rapid state changes (bursts, interleaved saves, edge timing).
 *
 * Covers gaps beyond autoSaveDirtySnapshot.test.js:
 * - Rapid dirty→save→dirty bursts (simulating fast gameplay)
 * - Dirty flag preserved across multiple markDirty calls between saves
 * - Dirty flag interaction with _saving guard under burst load
 * - Alternating dirty/clean patterns
 * - Mark dirty during async save (the critical race window)
 * - Dirty coalescing: many marks → one save
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: auto-save manager mirroring server behavior ──────────────────

class AutoSaveManager {
  constructor() {
    this.dirty = false;
    this._saving = false;
    this.saveCount = 0;
    this.dirtyMarkCount = 0;
    this.skipCount = 0;
    this._saveDelay = 5; // ms — simulate async save
  }

  markDirty() {
    this.dirty = true;
    this.dirtyMarkCount++;
  }

  async tick(now = Date.now()) {
    if (this._saving) {
      this.skipCount++;
      return { skipped: 'saving' };
    }
    if (!this.dirty) {
      this.skipCount++;
      return { skipped: 'clean' };
    }

    try {
      this._saving = true;
      // CRITICAL: snapshot dirty BEFORE save (server behavior)
      this.dirty = false;
      await this._doSave();
      return { saved: true };
    } catch (err) {
      return { error: err.message };
    } finally {
      this._saving = false;
    }
  }

  async _doSave() {
    await new Promise(r => setTimeout(r, this._saveDelay));
    this.saveCount++;
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAutoSaveRapidDirtyTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Rapid markDirty bursts
  // ═══════════════════════════════════════════════════════════════════════

  test('1000 rapid markDirty calls → only 1 save (coalescing)', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 1000; i++) {
      mgr.markDirty();
    }
    assert.equal(mgr.dirtyMarkCount, 1000);
    assert.equal(mgr.dirty, true);
    await mgr.tick();
    assert.equal(mgr.saveCount, 1);
    assert.equal(mgr.dirty, false);
  });

  test('burst of 50 markDirty between ticks → exactly 1 save', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 10; i++) {
      // Each cycle: 5 rapid marks, then 1 tick
      for (let j = 0; j < 5; j++) mgr.markDirty();
      await mgr.tick();
    }
    assert.equal(mgr.saveCount, 10, 'Each tick should save once');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Interleaved markDirty during save (critical race window)
  // ═══════════════════════════════════════════════════════════════════════

  test('markDirty during save → dirty survives → next tick saves again', async () => {
    const mgr = new AutoSaveManager();
    mgr._saveDelay = 20; // slow save
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Mark dirty DURING the save
    await new Promise(r => setTimeout(r, 5));
    mgr.markDirty();

    await tick1;
    assert.equal(mgr.dirty, true, 'dirty set during save should survive');
    assert.equal(mgr.saveCount, 1);

    // Second tick catches the dirty
    const result = await mgr.tick();
    assert.equal(result.saved, true);
    assert.equal(mgr.saveCount, 2);
  });

  test('5 markDirty calls during a slow save → all coalesce to 1 dirty flag', async () => {
    const mgr = new AutoSaveManager();
    mgr._saveDelay = 30;
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Mark dirty 5 times during save
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3));
      mgr.markDirty();
    }
    await tick1;

    assert.equal(mgr.dirty, true);
    // Next tick: 1 save for the coalesced dirty
    await mgr.tick();
    assert.equal(mgr.saveCount, 2, '5 marks during save → 1 additional save');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Concurrent tick guard under rapid changes
  // ═══════════════════════════════════════════════════════════════════════

  test('second tick while save in progress → skipped (saving guard)', async () => {
    const mgr = new AutoSaveManager();
    mgr._saveDelay = 20;
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Try second tick immediately
    const result2 = await mgr.tick();
    assert.equal(result2.skipped, 'saving', 'Second tick should be skipped');
    await tick1;
    assert.equal(mgr.saveCount, 1);
  });

  test('burst of ticks during slow save → all but first skipped', async () => {
    const mgr = new AutoSaveManager();
    mgr._saveDelay = 50;
    mgr.markDirty();

    const tick1 = mgr.tick();
    // Try 10 more ticks during save
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(await mgr.tick());
    }
    await tick1;

    const skippedCount = results.filter(r => r.skipped === 'saving').length;
    assert.equal(skippedCount, 10, 'All 10 concurrent ticks should be skipped');
    assert.equal(mgr.saveCount, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Alternating dirty/clean patterns
  // ═══════════════════════════════════════════════════════════════════════

  test('alternating dirty/clean: only dirty ticks save', async () => {
    const mgr = new AutoSaveManager();
    const results = [];
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) mgr.markDirty();
      results.push(await mgr.tick());
    }
    const savedCount = results.filter(r => r.saved).length;
    const cleanSkips = results.filter(r => r.skipped === 'clean').length;
    assert.equal(savedCount, 10, 'Half the ticks should save');
    assert.equal(cleanSkips, 10, 'Half the ticks should skip (clean)');
    assert.equal(mgr.saveCount, 10);
  });

  test('dirty→save→clean→clean→dirty→save cycle works', async () => {
    const mgr = new AutoSaveManager();

    mgr.markDirty();
    assert.equal((await mgr.tick()).saved, true);  // save 1
    assert.equal((await mgr.tick()).skipped, 'clean'); // clean
    assert.equal((await mgr.tick()).skipped, 'clean'); // clean
    mgr.markDirty();
    assert.equal((await mgr.tick()).saved, true);  // save 2

    assert.equal(mgr.saveCount, 2);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Stress test: rapid alternating mark/tick cycles
  // ═══════════════════════════════════════════════════════════════════════

  test('stress: 100 markDirty→tick cycles → 100 saves', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 100; i++) {
      mgr.markDirty();
      const r = await mgr.tick();
      assert.equal(r.saved, true, `Cycle ${i} should save`);
    }
    assert.equal(mgr.saveCount, 100);
  });

  test('stress: 100 clean ticks in a row → 0 saves', async () => {
    const mgr = new AutoSaveManager();
    for (let i = 0; i < 100; i++) {
      const r = await mgr.tick();
      assert.equal(r.skipped, 'clean');
    }
    assert.equal(mgr.saveCount, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Dirty flag state transitions
  // ═══════════════════════════════════════════════════════════════════════

  test('dirty flag lifecycle: false → markDirty → true → tick → false', () => {
    const mgr = new AutoSaveManager();
    assert.equal(mgr.dirty, false);
    mgr.markDirty();
    assert.equal(mgr.dirty, true);
    // tick sets dirty=false immediately (before async save)
    mgr.tick();
    assert.equal(mgr.dirty, false, 'dirty should be false right after tick starts');
  });

  test('multiple markDirty while already dirty → still just true', () => {
    const mgr = new AutoSaveManager();
    mgr.markDirty();
    mgr.markDirty();
    mgr.markDirty();
    assert.equal(mgr.dirty, true);
    assert.equal(mgr.dirtyMarkCount, 3);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Save error + subsequent dirty
  // ═══════════════════════════════════════════════════════════════════════

  test('save error: dirty was already false, new markDirty → next tick saves', async () => {
    const mgr = new AutoSaveManager();
    mgr._doSave = async () => { throw new Error('Disk full'); };

    mgr.markDirty();
    const r1 = await mgr.tick();
    assert.ok(r1.error);
    assert.equal(mgr.dirty, false, 'dirty reset before error');

    // New state change
    mgr.markDirty();
    mgr._doSave = async function () { this.saveCount++; }.bind(mgr);
    const r2 = await mgr.tick();
    assert.equal(r2.saved, true);
    assert.equal(mgr.saveCount, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Simulated fast game scenario
  // ═══════════════════════════════════════════════════════════════════════

  test('fast game simulation: 50 moves, save every 10 moves', async () => {
    const mgr = new AutoSaveManager();
    let savedMoves = 0;
    let tickCount = 0;

    for (let move = 0; move < 50; move++) {
      // Each move marks dirty
      mgr.markDirty();
      // Save interval fires every 10 ticks
      tickCount++;
      if (tickCount % 10 === 0) {
        const r = await mgr.tick();
        if (r.saved) savedMoves++;
      }
    }
    // Final tick to catch remaining dirty
    const r = await mgr.tick();
    if (r.saved) savedMoves++;

    // Each save captures all dirty marks since last save
    assert.equal(savedMoves, 5, '5 saves for 50 moves (every 10)');
    assert.equal(mgr.saveCount, 5);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Auto-Save Rapid Dirty Flag Tests');

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
