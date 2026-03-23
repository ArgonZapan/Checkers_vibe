# Bug Report — dynamic-bug-finder
**Date:** 2026-03-23
**Scope:** /opt/Checkers_vibe — runtime bugs, edge cases, logic errors
**Test suite:** 806/806 passed ✅

---

## Summary

Inspected `trainer.js`, `model.js`, `index.js`, `buffer.js` + git diff HEAD~3. All 806 unit tests pass. Found **4 bugs** (2 medium, 2 low) and **2 improvement notes**.

Recent commits (HEAD~3) fixed several real issues: epsilonBlack tracking (#132), paramsVersion race guard (#133), setParams model recreation (#134), darkFrom calculation fix, and _saving race condition fix. These are solid.

---

## BUG-001: Buffer `sample()` — Sequential, Not Random (Medium)

**File:** `server/ai/buffer.js:24-35`
**Severity:** Medium — training bias

```js
sample(n) {
  const k = Math.min(n, this.count);
  const start = this.count < this.maxSize ? 0 : this.head;
  const result = [];
  for (let i = 0; i < k; i++) {
    result.push(this.buffer[(start + i) % this.maxSize]);  // ← sequential!
  }
  // reservoir sampling only runs for i >= k (never if k >= count)
  for (let i = k; i < this.count; i++) { ... }
  return result;
}
```

**Problem:** When `k <= count`, the first loop pushes `k` consecutive items. The reservoir sampling loop (`i = k to count`) only replaces items randomly — but the initial `k` items are always the oldest entries. When `k == count` (common: `buffer.sample(2048)` with 2048 items), all items are returned in insertion order with zero randomness. This means training always sees games in chronological order, reducing sample diversity.

**Fix:** Shuffle the result array after selection, or use Fisher-Yates on the full buffer.

---

## BUG-002: REST `/api/ai/train` — No Turn Filtering (Medium)

**File:** `server/index.js:48-59`
**Severity:** Medium — trains wrong model

```js
app.post('/api/ai/train', async (req, res) => {
  const batch = req.body.batch || [];
  const lossWhite = await train(trainer.modelWhite, batch, ...);  // ← full batch
  const lossBlack = await train(trainer.modelBlack, batch, ...);  // ← same batch!
```

**Problem:** Both models are trained on the identical batch, regardless of `sample.turn`. White samples train the black model and vice versa. The self-play trainer in `_playGame` correctly filters by turn (`batchWhite`/`batchBlack`), but this REST endpoint doesn't.

**Fix:** Filter `batch` by `s.turn === 1` for modelWhite, `s.turn === -1` for modelBlack.

---

## BUG-003: Buffer `save()`/`load()` — Concurrent Save Corruption (Low)

**File:** `server/ai/buffer.js:58-65`
**Severity:** Low — unlikely but data-destroying

If `save()` is called while a previous `save()` is mid-write (tmp→rename), the second call's `rm(tmpPath)` could delete the first call's `rename` target. The auto-save interval has a `_saving` guard, but `resetModel()` calls `buffer.clear()` without checking if a save is in progress.

**Fix:** Add a `_savingBuffer` flag, or use unique tmp filenames (e.g., `.tmp.${Date.now()}`).

---

## BUG-004: `loadModel` — Silent Failure on Corrupt Model (Low)

**File:** `server/ai/model.js:280-288`
**Severity:** Low

```js
export async function loadModel(dirPath) {
  const model = await tf.loadLayersModel(`file://${dirPath}/model.json`);
  model.compile({...});
  return model;
}
```

**Problem:** If `model.json` exists but is corrupt (partial write from crash), `tf.loadLayersModel` throws. The caller in `main()` does `.catch(err => process.exit(1))` — hard crash with no recovery. No fallback to fresh model.

**Fix:** Wrap in try/catch, log warning, return `null` to let caller create fresh model.

---

## Notes (Not Bugs)

### N-001: Auto-Save Interval — Potential Double Execution

If a save cycle takes longer than `CONFIG.server.autoSaveMs` (default 30s), the next interval tick sees `_saving = true` and skips. The tick after that runs a fresh save. This is correct behavior — at most one save at a time. No action needed, but for very slow disks, consider increasing the interval.

### N-002: Policy Head = 128 Units — All Indices Valid

The model's policy head has 128 units. `computePolicyIndex()` returns 0-127 (32 dark squares × 4 directions). The old test comments reference "48-unit policy head" from a previous architecture. Current code is consistent: all legal move indices (0-127) are within the 128-unit policy vector. No mismatch.

### N-003: Recent Fixes (HEAD~3) — Verified Good

- `epsilonBlack` now tracked in setParams/resetModel/restart/loadState ✅
- `paramsVersion` race guard prevents stale training (#133) ✅
- `darkFrom` formula fix: `fromRow * 4 + Math.floor(fromCol / 2)` ✅
- `_saving = true` moved inside try block (recent fix) ✅
- `/api/ai/params` model recreation added ✅

---

## Recommendation

**BUG-001** (buffer sampling) and **BUG-002** (REST train endpoint) are the most impactful — they cause training bias and incorrect model updates respectively. Both are easy fixes.
