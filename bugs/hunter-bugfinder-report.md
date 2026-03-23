# Bug Finder Report — Checkers_vibe
**Date:** 2026-03-23  
**Branch:** main (HEAD: 2f98b7c)  
**Tester:** Jarvis Horner (hunter-sub-bugfinder)

---

### BUG-001: Policy index collision — multi-capture moves unreachable via predict()
- **Severity:** critical
- **File:** server/ai/model.js:205 (`computePolicyIndex`), server/ai/model.js:251 (`predict`)
- **What:** `computePolicyIndex(from, to)` only considers the direction (NE/NW/SE/SW) from the starting square, not the destination or capture count. Multiple different moves from the same square in the same direction all map to the same policy index. In `predict()`, `legalMoves.find()` returns only the first match, making subsequent moves unreachable.

  Example: from square [2,3], these moves all map to the same policy index (38):
  - `[2,3]→[3,4]` (single step SE)
  - `[2,3]→[4,5]` (single capture SE)
  - `[2,3]→[6,7]` (double capture SE)

  The model can never select the double capture if a single capture exists as an alternative, because `find()` always returns the first match.

- **Fix suggestion:** Change `computePolicyIndex` to incorporate destination square or capture count into the index, or use a matching approach in `predict()` that handles multiple moves sharing a policy index (e.g., random selection among all matches).

---

### BUG-002: Unused variable `result` in `_playGame()` terminal-handling blocks
- **Severity:** cosmetic
- **File:** server/ai/trainer.js:626, server/ai/trainer.js:700
- **What:** `let result = 0` is declared and assigned (based on `winner`) but never read. The actual result propagation happens via `s.result = ...` on the sample objects. The variable is dead code left from a refactor.
- **Fix suggestion:** Remove `let result = 0` and its assignment branches; the `winner` string is used directly for `s.result` assignment.

---

### BUG-003: Unused import `boardToTensor` in trainer.js
- **Severity:** cosmetic
- **File:** server/ai/trainer.js:1
- **What:** `boardToTensor` is imported from `./model.js` but never referenced anywhere in the file. The trainer uses `flattenBoard()` and `boardFromCpp()` instead. Leftover from commit 2f98b7c which cleaned up `loadModel` but missed this one.
- **Fix suggestion:** Remove `boardToTensor` from the import statement.

---

### BUG-004: Duplicate model creation in `/api/ai/params` endpoint
- **Severity:** cosmetic
- **File:** server/index.js:144-149
- **What:** `trainer.setParams(epsilon, networkSize, side)` already recreates models when `networkSize` changes (via `trainer._replaceModel`). Then lines 144-149 recreate them again with `createModel()`. The second creation overwrites the first — no functional bug, but wasteful and confusing.
- **Fix suggestion:** Remove the explicit `createModel()` calls on lines 144-149, since `trainer.setParams` already handles model recreation. Or remove model recreation from `trainer.setParams` and keep it only in index.js (pick one source of truth).

---

### Verifications (no bugs found)

**boardFromCpp 2D array validation (commit 40ad141):** Verified no regressions. The validation correctly handles:
- null/undefined input → returns 8×8 null grid
- flat array with wrong length (!= 64) → returns empty board
- 2D array with wrong row count (!= 8) → returns empty board
- 2D array with ragged rows (col count != 8) → returns empty board
- valid flat 64 and valid 2D 8×8 → correct conversion
- non-number values in array → safely treated as null

**WebSocket move validation:** Coordinates are properly validated for range 0-7 on both axes, captures array elements are validated, and malformed input returns clear error messages.

**Rate limiting:** Map has periodic cleanup (every 60s), preventing unbounded memory growth.

**Proxy middleware:** `_proxyReq.end()` is correctly present (fixed in commit 01248b1).

**Unused imports (loadModel):** Confirmed cleaned up in commit 2f98b7c for index.js and trainer.js. `loadModel` is only defined+exported in model.js (not imported elsewhere) — correctly kept for external use.

**All 1042 tests pass** — no test regressions detected.
