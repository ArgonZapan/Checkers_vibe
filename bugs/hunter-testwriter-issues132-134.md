# Test Writer Report — Issues #132, #133, #134
**Date:** 2026-03-23  
**Branch:** main  
**Commit:** `fix: add tests for issues #132, #133, #134 (hunter-sub-testwriter)`

## Summary

Added 24 new tests in `__tests__/issues132to134.test.js` (registered in `run.js`).

**Full suite: 592 tests, all passing.**

---

## Issue #134 — WS setParams layers 1-8 vs createModel 1-5 mismatch

**Root cause found:**
- `server/index.js` WS `setParams` handler validates: `layers < 1 || layers > 8` → reject
- `server/ai/model.js` `createModel` clamps: `numLayers > 5` → clamp to 5

**Tests (11):**
- WS accepts layers 6, 7, 8 ✅
- createModel clamps layers 6, 7, 8 → 5 ✅
- Boundary tests (1-5 pass both, 9 rejected by WS) ✅
- Core bug test: layers 6-8 pass WS validation but get silently clamped ✅
- Gap quantification: WS max=8, model max=5, gap=3 values ✅

**Fix needed:** Align validation ranges — either WS should reject 6-8, or createModel should support 6-8.

---

## Issue #132 — trainer.dirty not set after epsilon decay

**Root cause found:**
- `_playGame()` decays epsilon at end: `this.epsilonWhite = Math.max(minEpsilon, ...)`
- Does NOT set `this.dirty = true`
- Auto-save interval checks `if (!trainer.dirty) return` → skips persisting epsilon

**Tests (6):**
- Epsilon decays correctly ✅
- BUG: dirty=false after decay → auto-save skips ✅
- WORKAROUND: setting dirty=true fixes it ✅
- Epsilon clamps to minEpsilon ✅
- 50 games drift: epsilon=0.5 never persisted, resets to 1.0 on restart ✅

**Fix needed:** Add `this.dirty = true;` after epsilon decay in `_playGame()`.

---

## Issue #133 — Race condition in setParams

**Root cause found:**
- `_playGame()` captures `this.modelWhite`, `this.modelBlack`, `this.modelParams` at start
- `setParams()` stops trainer, swaps models, resets stats, restarts
- But `_loop()` only checks `this.running` at the top — an in-flight `_playGame()` iteration continues with old model references

**Tests (7):**
- setParams creates new model objects ✅
- setParams updates modelParams and resets stats ✅
- BUG: in-flight game captured old model references ✅
- BUG: old game uses layers=3, new game uses layers=4 ✅
- Restart/stopped behavior correct ✅
- Buffer cleared ✅

**Fix needed:** Add an abort/cancellation mechanism so `_playGame()` checks for cancellation after each await, or use a generation counter.
