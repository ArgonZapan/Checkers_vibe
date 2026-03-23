# Dynamic BugFinder Report — Checkers_vibe
**Date:** 2026-03-23 18:30 UTC
**Scope:** server/index.js, server/ai/, server/boardConvert.js, server/proxy.js, client/src/
**Tester:** Jarvis Horner (hunter-sub-bugfinder)

---

## Critical

### BUG-D01: Policy index collision — multi-capture moves unreachable via predict()
- **File:** `server/ai/model.js:205` (`computePolicyIndex`), `server/ai/model.js:251` (`predict`)
- **Severity:** critical
- **Description:** `computePolicyIndex(from, to)` computes the index using only the direction (NE/NW/SE/SW) from the starting dark square. Multiple moves from the same square in the same direction (e.g., single capture vs. double capture) map to the **same policy index**. In `predict()`, `legalMoves.find(m => m.policyIndex === bestIdx)` returns only the first match. The model can never select a multi-capture move if a simpler move from the same square exists.
  - Example: from `[2,3]` going SE: `[2,3]→[3,4]`, `[2,3]→[4,5]`, `[2,3]→[6,7]` all map to index 38.
- **Suggested fix:** Either incorporate destination/capture-count into `computePolicyIndex`, or in `predict()` collect all legal moves sharing the same policy index and randomly select among them.
- **Status:** Already documented as BUG-001 in `hunter-bugfinder-report.md`.

---

## Major

### BUG-D02: `selfPlayStatus` field name mismatch — client gameNumber stuck at 0 on connect
- **File:** `server/index.js:374`, client `App.jsx:189`
- **Severity:** major
- **Description:** The WebSocket connection handler emits `selfPlayStatus` with `currentGame`, but the client reads `data.gameNumber`. Result: when connecting during active self-play, the Dashboard shows "gra #0" until the next `_loop()` iteration sends a corrected event.
  ```js
  // server (line 374 — BEFORE fix):
  socket.emit('selfPlayStatus', { active: trainer.running, currentGame: trainer.stats.gamesPlayed, stats: trainer.stats });
  // client (line 189):
  if (data.gameNumber !== undefined) setGameNumber(data.gameNumber);
  ```
- **Suggested fix:** Change `currentGame` → `gameNumber` in the connection handler. ✅ **Fixed in commit 98876a9.**

---

## Minor

### BUG-D03: Unused import `boardToTensor` in trainer.js
- **File:** `server/ai/trainer.js:1`
- **Severity:** minor
- **Description:** `boardToTensor` is imported but never used in trainer.js. The trainer uses `buildInputArray()` and `boardFromCpp()` instead. Dead import wastes memory (the function creates TF.js tensors unnecessarily).
- **Suggested fix:** Remove from import. ✅ **Fixed in commit 98876a9.**

### BUG-D04: Dead component `GameTimer.jsx`
- **File:** `client/src/components/GameTimer.jsx`
- **Severity:** minor
- **Description:** `GameTimer` component is defined but never imported or rendered anywhere in the app. Dead code increases bundle size.
- **Suggested fix:** Either integrate into the game UI or delete the file.

### BUG-D05: Board.jsx imports `config.js` via relative path crossing into server territory
- **File:** `client/src/components/Board.jsx:2`
- **Severity:** minor
- **Description:** `import { CONFIG } from '../../../config.js'` works with Vite but means the client bundle depends on a file that uses `process.env.CORS_ORIGIN` (a Node.js global). Vite replaces it at build time, but this is fragile — any new `process.env` usage in config.js will break the client build silently.
- **Suggested fix:** Extract client-relevant config (board colors, cell size, animation) into a separate `clientConfig.js` or use Vite's `import.meta.env`.

---

## Verified (no bugs found)

**Memory leaks:** The `setInterval` for rate-limit cleanup in `server/index.js` runs indefinitely but cleans up expired entries. `_rateLimitMap` is capped at 10,000 entries. `lossHistory` in client is capped at 1000. `moveHistory` capped at 40. `roundTimes` capped at 10. No unbounded growth detected.

**Race conditions:** The `_moveQueue` Promise chain per-socket correctly serializes moves. `paramsVersion` guard (#133) prevents stale game results after model reset. `_saving` flag prevents concurrent auto-save. `trainer.stop()` is synchronous, preventing races with `start()`.

**WebSocket input validation:** Move coordinates are validated for range 0-7, type, and array length. Captures are validated element-by-element. `setParams` uses a whitelist to prevent prototype pollution. `setSpeed` and `setSpeedMode` are throttled and mode-gated.

**Edge cases:** `boardFromCpp` validates flat array length, 2D array shape, and ragged rows. `boardToCpp` pads/truncates to 64 elements. `predict()` falls back to legalMoves[0] if policy index is not found. `validateMove()` in trainer.js handles scalar and [row,col] formats.

**Tensor disposal:** All tensors in `predict()`, `train()`, and `boardToTensor()` are properly disposed in `finally` blocks.

**Proxy middleware:** `_proxyReq.end()` correctly present after `write()`. Error handler checks `!res.headersSent`.

**CSP headers:** Comprehensive CSP, X-Frame-Options, X-Content-Type-Options all set in middleware.

---

## Summary

| # | Severity | Description | Fixed |
|---|----------|-------------|-------|
| D01 | critical | Policy index collision — multi-capture unreachable | ❌ (pre-existing) |
| D02 | major | selfPlayStatus field name mismatch (currentGame vs gameNumber) | ✅ 98876a9 |
| D03 | minor | Unused import boardToTensor in trainer.js | ✅ 98876a9 |
| D04 | minor | Dead component GameTimer.jsx | ❌ |
| D05 | minor | Board.jsx crosses server/client boundary via config import | ❌ |

**Total: 5 issues (1 critical, 1 major, 3 minor). 2 fixed, 3 documented.**

The codebase is well-hardened against the bugs it was designed to prevent (race conditions, invalid input, tensor leaks). The critical policy index issue from BUG-001 remains the most impactful unfixed defect — it directly limits the AI's tactical capability in multi-capture sequences.
