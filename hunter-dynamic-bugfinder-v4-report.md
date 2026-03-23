# 🔍 Hunter Dynamic Bugfinder v4 Report

**Sub-agent:** dynamic-bug-finder  
**Date:** 2026-03-23 22:30 UTC  
**Project:** Checkers_vibe  
**Tests:** 2633/2633 passed ✅

---

## Bug #1: `isEngineUp()` throws uncaught exception on non-200 engine response
- **Severity:** 🟠 Wysoki (High)
- **Lokalizacja:** `server/ai/trainer.js` — `isEngineUp()` method
- **Opis:** `isEngineUp()` calls `cppFetch()` which explicitly throws `Error` on any non-ok HTTP response (see cppFetch's `if (!res.ok)` check). When the C++ engine is partially up (accepts connections but returns 500/400), the throw bypasses the catch block and crashes the recovery loop. This breaks engine health checks in `_loop()` and `_playGame()`, potentially killing self-play permanently after a transient engine error.
- **Sugerowana naprawa:** Use raw `fetch()` instead of `cppFetch()` in `isEngineUp()` so non-ok responses return `false` instead of throwing.
- **Status:** ✅ FIXED — replaced `cppFetch` with raw `fetch()` + timeout + proper try/catch

## Bug #2: Minimax strategy missing king sliding captures AND moves
- **Severity:** 🔴 Krytyczny (Critical)
- **Lokalizacja:** `server/ai/minimax.js` — `generateLegalMoves()` and `_extendCapture()`
- **Opis:** The minimax move generator treated kings identically to pawns for both captures and regular moves:
  1. **Captures:** Kings could only capture by jumping 2 squares (like pawns). Kings should be able to slide over any distance along a diagonal, landing on the first empty square after an opponent piece.
  2. **Moves:** Kings could only move 1 square. Kings should slide any distance along empty diagonals.
  This made the minimax strategy fundamentally broken — it would miss valid captures (violating mandatory capture rules), miss the majority of king moves, and play much weaker than intended.
- **Sugerowana naprawa:** Add separate king capture/move logic: for captures, scan along diagonal until opponent found, then continue to first empty square. For moves, generate all empty squares along each diagonal.
- **Status:** ✅ FIXED — added king sliding logic to both captures, multi-captures (_extendCapture), and regular moves

## Bug #3: `setSpeed` handler doesn't reset `normalModeDelayMs` to 0 when speed is 0
- **Severity:** 🟡 Średni (Medium)
- **Lokalizacja:** `server/index.js` — `socket.on('setSpeed', ...)` handler
- **Opis:** When speed is set to 0 (lightning mode), the handler sets `aiMoveDelayMs = 0` but only updates `normalModeDelayMs` when `clamped > 0`. This means `normalModeDelayMs` stays at its last non-zero value permanently. The `CONFIG.moveDelayMs` getter returns `normalModeDelayMs` when `aiMoveDelayMs === 0`, so switching back to "normal" speed mode after lightning mode would use a stale delay value instead of the expected default.
- **Sugerowana naprawa:** Always update `normalModeDelayMs` — set to 0 when speed is 0, not just when > 0.
- **Status:** ✅ FIXED — added `CONFIG.server.normalModeDelayMs = 0` else branch

## Bug #4: Network size dropdown shows wrong architecture labels
- **Severity:** 🟡 Średni (Medium)
- **Lokalizacja:** `client/src/components/ParamsPanel.jsx` — `<select>` options
- **Opis:** The UI dropdown shows "Mała (64-64)", "Średnia (128-128)", "Duża (256-256)" but the actual `NETWORK_CONFIGS` in `model.js` are:
  - small: `[128, 64]`
  - medium: `[256, 128, 64]`
  - large: `[512, 256, 128, 64]`
  Users are misled about the actual network architecture they're selecting.
- **Sugerowana naprawa:** Update labels to match actual configs.
- **Status:** ✅ FIXED — labels now show correct architecture sizes

## Bug #5: Game round timing data not persisted to state.json
- **Severity:** 🟢 Niski (Low)
- **Lokalizacja:** `server/ai/trainer.js` — `saveState()` and `loadState()`
- **Opis:** `saveState()` serializes `stats`, `epsilonWhite/Black`, and `running`, but omits `roundTimes[]` and `totalTimeMs`. After server restart, `avgTime`, `lastRoundTime`, and `totalTimeMs` in the dashboard show 0 until new games complete. This is a data loss issue for the timing statistics.
- **Sugerowana naprawa:** Add `roundTimes` and `totalTimeMs` to the state.json serialization in saveState/loadState.
- **Status:** ⚠️ NOT FIXED (cosmetic, low priority)

## Bug #6: C++ `hasAnyMove()` doesn't handle king sliding properly
- **Severity:** 🟢 Niski (Low)
- **Lokalizacja:** `engine/src/movegen.cpp` — `hasAnyMove()` function
- **Opis:** The fast-path `hasAnyMove()` checks king moves by sliding along a diagonal until hitting a non-empty square and immediately returning `true`. However, it doesn't distinguish between own pieces and opponent pieces — if a king can slide through empty squares but hits its own piece, it correctly breaks. But the early return on the first empty square means it correctly identifies at least one move exists. Actually, reviewing more carefully: the `while` loop only continues through empty squares and breaks on any non-empty (own or opponent). This is correct for detecting "has any move." However, it does NOT check king captures, only regular moves. The full capture check happens via `generateCaptures()` called earlier in `hasAnyMove()`. So this is actually fine.
- **Sugerowana naprawa:** N/A — implementation is correct after all.
- **Status:** N/A (false alarm on re-review)

## Bug #7: `require('util').isNullOrUndefined` polyfill in model.js uses CJS require
- **Severity:** 🟢 Niski (Low)
- **Lokalizacja:** `server/ai/model.js` — lines 1-4
- **Opis:** The file uses `createRequire(import.meta.url)` to polyfill `util.isNullOrUndefined` removed in Node.js 24+. However, this polyfill is never actually used in the file — `isNullOrUndefined` is not called anywhere in model.js. It's dead code that adds unnecessary import overhead and a dependency on `createRequire`.
- **Sugerowana naprawa:** Remove the unused polyfill.
- **Status:** ⚠️ NOT FIXED (cleanup, low risk)

---

## Podsumowanie

| Kategoria | Ilość |
|-----------|-------|
| 🔴 Krytyczne | 1 |
| 🟠 Wysokie | 1 |
| 🟡 Średnie | 2 |
| 🟢 Niskie | 2 (1 false alarm) |
| **Łącznie** | **6** (5 realnych) |

### Fixed: 4 bugs
### Not fixed (low priority): 2 bugs

## Commity

```
d09e0a6 fix: isEngineUp crash on non-200, minimax king sliding, speed CONFIG mutation, network size labels (hunter-sub-dynamic-v4)
```

### Co zostało naprawione:
1. **isEngineUp() crash** — zamiana cppFetch na raw fetch
2. **Minimax king moves** — dodano sliding captures i sliding moves dla królów
3. **Speed CONFIG mutation** — normalModeDelayMs resetuje się do 0 gdy speed=0
4. **Network size labels** — poprawiono etykiety dropdown na zgodne z modelem
