# Dynamic BugFinder Report — Checkers_vibe (Round 2)
**Date:** 2026-03-23 19:18 UTC
**Scope:** server/index.js, server/ai/trainer.js, server/ai/model.js, server/proxy.js, server/boardConvert.js, client/src/
**Tester:** Jarvis Horner (hunter-sub-001-bugfinder)
**Previous:** hunter-dynamic-bugfinder-report.md (round 1)

---

## Important

### BUG-D06: validateMove/isMoveLegal ignores captures — multi-capture disambiguation broken
- **File:** `server/ai/trainer.js:247-265` (validateMove), `server/ai/trainer.js:272-283` (isMoveLegal)
- **Severity:** important
- **Description:** `validateMove()` normalizes `from`/`to` and validates ranges but NEVER stores/computes `captures` in its output. `isMoveLegal()` then checks `move.captures` length vs `lm.captures` — but `move.captures` is always undefined (never set by validateMove). The captures comparison is dead code. Two moves with same from/to but different captures (e.g., single vs double jump) are treated as equivalent. In `_validateAndFallback()`, `isMoveLegal` always returns true for valid from/to regardless of capture path.
- **Impact:** AI may select wrong capture path. C++ engine rejects with 400, triggering retry with random move. Training samples record incorrect move.
- **Fix:** Include captures in validateMove output and isMoveLegal comparison.

### BUG-D07: WebSocket move handler — only validates captures[0], not all elements
- **File:** `server/index.js:320-322`
- **Severity:** important
- **Description:** The captures validation loop checks `captures[i]` but the coordinate validation `isValidCoord` is applied to `captures[i]` — actually, re-reading the code, the loop IS correct: `if (!isValidCoord(captures[i]))`. Wait — let me re-check... The code at line 320: `for (let i = 0; i < captures.length; i++) { if (!isValidCoord(captures[i])) { ... } }` — this IS validating all elements. My initial scan was wrong. **This is actually OK.**
- **Correction:** Not a bug. All captures elements are validated.

### BUG-D08: POST /api/ai/predict — legalMoves elements not validated
- **File:** `server/index.js:113-139`
- **Severity:** important
- **Description:** `board` is fully validated (type, length, element range 0-4). But `legalMoves` is only checked for existence (`if (!board || !legalMoves)`). Individual elements are passed directly to `predict()` without validation. A client can send `legalMoves: ["not_a_move", null, 42]` which passes through to the model, causing unpredictable behavior in the policy masking logic.
- **Fix:** Validate each legalMoves element has `from`/`to` with valid [row,col] coordinates.

### BUG-D09: POST /api/ai/train — batch board elements not validated
- **File:** `server/index.js:137-153`
- **Severity:** important
- **Description:** Batch samples are validated for structure (`s.board.length === 64`, `s.turn === 1 || -1`) but individual board element values are NOT checked. A sample like `{ board: Array(64).fill("NaN"), turn: 1 }` passes validation. The `buildInputArray` function in model.js checks `Array.isArray` but not element types — it uses `Math.abs(val)` on potentially string/null values, producing `NaN` tensors that corrupt model training silently.
- **Fix:** Add element validation: each `s.board[i]` must be integer 0-4.

### BUG-D10: predict() type mismatch on empty legalMoves — returns number instead of move object
- **File:** `server/ai/model.js:240` (early return)
- **Severity:** important
- **Description:** When `legalIndices.length === 0`, `predict()` returns `{ move: 0, ... }`. The `move` field is a number, not a move object. Callers (especially `_validateAndFallback`) handle this via `typeof chosenMove === 'number'` → `legalMoves[idx]`. But if `legalMoves` is ALSO empty (both paths fail), the fallback chains break. More critically, the HTTP API handler (`POST /api/ai/predict`) returns `move: 0` to the client as a number, which is a different shape than the normal move object response. Client code may crash expecting `move.from`/`move.to`.
- **Fix:** Return `move: null` instead of `move: 0` when no legal moves exist, and let callers handle null.

### BUG-D11: startGame race with self-play — C++ engine state conflict
- **File:** `server/index.js:220-234`
- **Severity:** important
- **Description:** `startGame` handler: (1) `trainer.stop()` sets `running=false` (sync), (2) `await cppFetch('/api/game/start')` yields to event loop, (3) old `_loop` iteration resumes, checks `this.running=false`, exits. BUT if a `_playGame` iteration is mid-HTTP-call when `trainer.stop()` is called, the HTTP call completes before the while-loop check. The self-play could make one more move on the C++ engine between `trainer.stop()` and `cppFetch('/api/game/start')`. The game starts but has one extra self-play move baked in.
- **Mitigation:** The `paramsVersion` guard partially handles this for param changes, but startGame doesn't increment it. Adding `trainer.paramsVersion++` in startGame (when stopping self-play) would invalidate any in-flight _playGame.

---

## Cosmetic

### BUG-D12: Duplicate `app.set('trust proxy', false)`
- **File:** `server/index.js:13, 16`
- **Severity:** cosmetic
- **Description:** `trust proxy` is set twice — once on line 13 and again on line 16. Harmless but messy.

---

## Previously Fixed (Not Redoing)
- BUG-D01: Policy index collision (already documented)
- BUG-D02: selfPlayStatus gameNumber field name (commit 98876a9)
- BUG-D03: Unused boardToTensor import (commit 98876a9)
- Rate limiting memory cap (commit 44461f3)
- trust proxy=false (commit b5d5aa9)
- CSP header (commits before)
