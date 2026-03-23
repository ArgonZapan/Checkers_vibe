# Dynamic BugFinder Report — Checkers_vibe (Round 3)
**Date:** 2026-03-23 19:42 UTC
**Scope:** server/index.js, server/ai/trainer.js, server/ai/model.js, server/proxy.js, client/src/
**Tester:** Jarvis Horner (hunter-sub-dynbug)
**Previous Reports:** hunter-dynamic-bugfinder-report.md (round 1), hunter-dynamic-bugfinder-report-v2.md (round 2)
**Tests:** 1810 passed, 0 failed ✅

---

## Fixed in this session

### FIX-DYN-001: Tensor leak in predict() if model.predictOnBatch() throws
- **File:** `server/ai/model.js:224-230` (predict function)
- **Severity:** important
- **Description:** `boardToTensor()` created `tensor` BEFORE the `try` block. If `model.predictOnBatch(tensor)` threw (model disposed, OOM, shape mismatch), the tensor was leaked — `finally` never ran because `try` was never entered. Over repeated failures, leaked tensors accumulate in TF.js backend memory.
- **Fix:** Moved tensor creation inside the `try` block so `finally` always disposes it.
- **Status:** ✅ FIXED (commit 1589c96)

### FIX-DYN-002: NaN/invalid turn silently corrupts boardToTensor and buildInputArray
- **File:** `server/ai/model.js` (boardToTensor, buildInputArray, predict)
- **Severity:** important
- **Description:** The `input[256] = turn` line stored whatever value was passed — including `NaN`, `undefined`, `0`, `2`, or strings. A `NaN` turn value in the input tensor would propagate through the neural network, producing garbage predictions and corrupting training gradients. No validation existed anywhere in the chain: `predict()` defaulted `turn = 1` but accepted any value; `boardToTensor()` and `buildInputArray()` stored it blindly.
- **Fix:** Added turn validation in `predict()` (warn + default to 1) and clamped in `boardToTensor()`/`buildInputArray()` to `(turn === 1 || turn === -1) ? turn : 1`.
- **Status:** ✅ FIXED (commit 1589c96)

### FIX-DYN-003: Shutdown handler doesn't stop self-play loop
- **File:** `server/index.js` (shutdown function)
- **Severity:** important
- **Description:** SIGTERM/SIGINT handler cleared intervals and closed HTTP server, but never called `trainer.stop()`. The self-play `_loop()` continued making HTTP requests to the C++ engine during shutdown. If `httpServer.close()` callback fired before in-flight requests completed, those requests would fail with connection errors. In graceful shutdown scenarios (Docker, systemd), this caused noisy error logs and potentially incomplete state saves.
- **Fix:** Added `trainer.stop()` call before `httpServer.close()` in the shutdown function.
- **Status:** ✅ FIXED (commit 1589c96)

---

## Unfixed bugs (found but not in scope to fix)

### BUG-DYN-004: Multi-capture animation incorrectly detects captured pieces for king slides
- **File:** `client/src/components/Board.jsx:55-75` (multi-capture useEffect)
- **Severity:** important
- **Description:** The animation determines captured positions by iterating cells between consecutive path steps along the diagonal. For pawns this is correct (always jump exactly 2 squares). But for king multi-captures, the king can slide multiple squares between captures. The loop checks EVERY intermediate cell and flags opponent pieces as "captured." If a king slides from (0,0) to (4,4) capturing at (3,3), cells (1,1) and (2,2) are also checked — if opponent pieces sit there (not actually captured), they'd be incorrectly removed from the animation board.
- **Impact:** Visual corruption during king multi-capture sequences — pieces disappear that shouldn't.
- **Fix suggestion:** Use `lastMove.captures` array (server-provided) for capture positions instead of inferring from path geometry.

### BUG-DYN-005: predict() fallback `move: null` not handled by all callers
- **File:** `server/ai/model.js:243` (early return when legalMoves empty)
- **Severity:** important
- **Description:** When `legalMoves` is empty, `predict()` returns `{ move: null, probabilities: {}, value: 0 }`. The `_validateAndFallback()` in trainer.js handles this via the `chosenMove` being null → `selectedMove` is undefined → `validateMove(null)` returns invalid → falls back to random move. But `_randomLegalMove(legalMoves)` also returns null if legalMoves is empty. The caller then throws "No valid move available." The HTTP API handler (`POST /api/ai/predict`) returns `move: null` which clients expecting `move.from`/`move.to` may not handle.
- **Fix suggestion:** HTTP API should return `{ error: 'No legal moves' }` with 400 status when legalMoves is empty, instead of calling predict().

### BUG-DYN-006: Socket.IO CORS origin doesn't match CSP connect-src
- **File:** `server/index.js:18` vs `server/index.js:27`
- **Severity:** important (production deployment)
- **Description:** Socket.IO CORS is set to `CONFIG.server.corsOrigin` (default `http://localhost:3000`). But CSP `connect-src` allows `'self' wss:` — no explicit HTTP origin. In production, if `CORS_ORIGIN` env var is not set, CORS blocks cross-origin WebSocket connections while CSP allows them. Misconfiguration risk.
- **Fix suggestion:** Derive Socket.IO CORS from the same CSP configuration, or document that CORS_ORIGIN env var is required for production.

### BUG-DYN-007: _lastModelSave/_lastBufferSave not reset after trainer.resetModel()
- **File:** `server/index.js` (auto-save interval) vs `server/ai/trainer.js` (resetModel)
- **Severity:** cosmetic (minor data loss window)
- **Description:** `trainer.resetModel()` deletes model files and buffer from disk and creates fresh models. But `_lastModelSave` and `_lastBufferSave` timestamps in server/index.js are not reset. After reset, auto-save skips model/buffer save until the time threshold passes (2min/5min). If the server crashes during that window, the fresh models are lost and the next restart loads... nothing (files were deleted by reset).
- **Fix suggestion:** Have resetModel() emit an event or return a flag that server/index.js checks to reset its timestamps. Or export the timestamps so resetModel can clear them.

### BUG-DYN-008: Board.jsx shallow areEqual doesn't compare captures array contents
- **File:** `client/src/components/Board.jsx:243-258` (areEqual function)
- **Severity:** cosmetic (unnecessary re-renders)
- **Description:** `areEqual` compares `prevProps.captures?.length !== nextProps.captures?.length` but not the contents. If captures array is recreated with same elements (different reference, same data), the component re-renders unnecessarily. Conversely, if the length stays the same but elements change (edge case), the component wouldn't re-render.
- **Fix suggestion:** Use deep comparison for captures array, or memoize captures in parent.

### BUG-DYN-009: GameTimer resets on `running` change but doesn't pause
- **File:** `client/src/components/GameTimer.jsx:8-10`
- **Severity:** cosmetic
- **Description:** When `running` toggles from true→false→true, the timer resets to 0. This means switching game modes or briefly pausing loses the elapsed time. The timer should pause/resume, not reset.
- **Fix suggestion:** Only reset on `gameOver` change, not `running` change. When `running` is false, just stop the interval without resetting.

---

## Verified safe (no bugs found)

- **server/proxy.js:** Body replay logic is correct — checks `hasBody && req.body` before serializing. No header injection (only sets Content-Type and Content-Length from controlled values). No SSRF (target is hardcoded from CONFIG).
- **server/ai/buffer.js:** Circular buffer implementation is correct. Handles edge cases (full buffer, empty buffer, JSON parse errors).
- **client/src/components/ErrorBoundary.jsx:** Properly catches errors, provides reload button. No issues.
- **server/index.js rate limiting:** Cleanup interval + hard cap (10,000 entries) prevents unbounded growth. Fixed in earlier commits.
- **server/index.js input validation:** All WebSocket handlers validate input types and ranges. Fixed in earlier commits.
- **Tensor lifecycle in train():** All tensors (xTensor, yPolicyTensor, yValueTensor, nextTensor, nextValues) are disposed in finally blocks. No leaks.
- **CSP headers:** Comprehensive policy with no unsafe-inline/eval. wss: only in production (ws: requires CSP_ALLOW_WS=true).

---

## Summary

| Category | Count |
|----------|-------|
| Fixed this session | 3 |
| Unfixed (important) | 3 |
| Unfixed (cosmetic) | 3 |
| Verified safe | 8 |
| Total tests passing | 1810 ✅ |
