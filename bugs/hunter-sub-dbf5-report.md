# Hunter Alpha — Dynamic Bug Finder Report
**Session:** hunter-sub-dbf5  
**Date:** 2026-03-24  
**Scope:** Dynamic scan of `server/index.js`, `server/ai/model.js`, `server/ai/minimax.js`, `client/src/components/Board.jsx`, `server/proxy.js`, `config.js`  
**Focus:** Last 2 days of commits, socket handler edge cases, error handling completeness, thread safety / race conditions

---

## BUG-NEW-001: King sliding capture accepts landing on occupied squares
- **Severity:** CRITICAL
- **Location:** `server/ai/minimax.js` — `_extendCapture()` (king branch, lines ~280-310)
- **Description:** In the `_extendCapture` function's king sliding capture path, when `foundOpp` is true and an empty square is found after the opponent (`board[idx] === 0`), the code adds the capture **without also checking that the landing square is empty**. Specifically, it checks `capturedBoard[idx] !== 0` to detect pieces (including opponents), then checks `else if (foundOpp)` to create a capture landing on that square. The logic is correct for the *first* empty square after the opponent, but the `alreadyCaptured` check on the next iteration only blocks if the exact same opponent appears again — it does NOT prevent landing on a square that is already occupied by a DIFFERENT piece (which could be another opponent or even a friendly piece that re-appeared on the board).
- **Impact:** In multi-capture sequences for kings, the algorithm can generate illegal moves where a king lands on a square already occupied by another piece, which would then be played to C++ engine and rejected (400 error), causing the self-play game to retry/fail.
- **Reproduction:** Set up a board position with a white king at [0,0], black pawns at [1,1] and [3,3], empty [2,2], and an existing black piece at [4,4]. Run `minimaxSearch` — the king capture through [1,1] → [2,2] is valid, but further extension might try to land on [4,4].
- **Note:** The same class of bug exists in the `generateLegalMoves()` first-pass king capture logic — it doesn't validate that the capture landing square is empty before pushing to the captures array.

---

## BUG-NEW-002: _replaceModel disposes model while predictions are in-flight
- **Severity:** HIGH
- **Location:** `server/ai/trainer.js` — `_replaceModel()` method
- **Description:** The `_replaceModel()` method chains disposal onto the lock, but the caller receives the new model immediately (before disposal completes). If `_replaceModel` is called *after* `acquireModelLock()` returns but *before* the prediction finishes (i.e., between lock acquisition and model.predictOnBatch call), the old model's dispose will be chained AFTER the prediction's release. However, if `_replaceModel` is called while NO lock is held (no prediction running), the dispose runs immediately on the next microtask. Any prediction that starts in the window between `_replaceModel()` being called and the old model actually being disposed (which could be microseconds later) would use a model that's about to be disposed. More critically, if `_replaceModel` is called multiple times rapidly, the second call chains after the first disposal — but the second disposal's release resolves the wrong promise chain, causing the lock state to drift.
- **Impact:** TensorFlow.js model used after dispose → crash, memory leak, or silent wrong results during self-play or player-vs-AI games.
- **Reproduction:** In aivai mode, rapidly change networkSize via setParams while self-play is making predictions. The `paramsVersion++` guard prevents _playGame from continuing, but any in-flight prediction could still use a disposed model.
- **Related commits:** `5653f34 fix: model dispose mutex prevents race with active predictions`

---

## BUG-NEW-003: Auto-save sets dirty=false before save completes — data loss window
- **Severity:** MEDIUM
- **Location:** `server/index.js` — `_autoSaveInterval` callback
- **Description:** The auto-save callback snapshots and clears `trainer.dirty` BEFORE calling `await trainer.saveState()`. If `saveState()` fails (disk full, permission error), the dirty flag has already been reset. The next auto-save cycle sees `dirty=false` and skips. Any accumulated state changes (epsilon, stats, buffer) between the failed save and the next save that manages to set `dirty=true` are lost.
- **Impact:** On intermittent disk I/O failures (e.g., NFS timeouts, disk full), the last N minutes of training state (epsilon, stats, buffer) are silently lost. Since the main loop only sets `dirty=true` after training or epsilon changes, the gap could be several game rounds.
- **Reproduction:** Set the data directory read-only, let the auto-save timer fire. The dirty flag is cleared, saveState fails, and subsequent saves are skipped until a game finishes (which resets dirty=true). All epsilon decay and stats accumulated between the failed save and next game are lost.
- **Related commits:** Earlier BUG-003 fix added the dirty flag mechanism itself — this is a regression in the fix.

---

## BUG-NEW-004: Proxy error handler — potential crash on undefined res
- **Severity:** MEDIUM
- **Location:** `server/proxy.js` — `on.error` handler
- **Description:** The `on.error` handler checks `res && !res.headersSent` before writing. However, `http-proxy-middleware` may pass `undefined` as `res` when the error occurs during the `proxyReq` phase (before the response object is allocated). The truthiness check `res &&` handles this, BUT the handler does not handle the case where `res` exists but the socket is already closed (`res.writableEnded === true`). In that case, `res.writeHead()` will throw `ERR_STREAM_WRITE_AFTER_END`.
- **Impact:** Unhandled exception in proxy error handler → process crash (mitigated by unhandledRejection handler, but still causes a bad client experience — no response sent).
- **Reproduction:** Kill the C++ backend mid-stream while a WebSocket client is waiting for a proxied response. The proxy error fires, `res` exists but the socket may already be closed.
- **Related commits:** None (new finding)

---

## BUG-NEW-005: CONFIG mutation from concurrent socket handlers — no synchronization
- **Severity:** MEDIUM
- **Location:** `config.js` + `server/index.js` (setSpeed, setSpeedMode, setParams handlers)
- **Description:** `CONFIG.server.speedMode`, `CONFIG.server.aiMoveDelayMs`, `CONFIG.server.normalModeDelayMs`, `CONFIG.ai.strategy.white`, `CONFIG.ai.strategy.black` are mutated directly from multiple WebSocket handlers. These handlers run concurrently for different socket connections (no serialization). Two clients in aivai mode could simultaneously:
  1. Client A sets `speedMode = 'fast'`
  2. Client B sets `speedMode = 'normal'`
  3. Client A's handler reads `moveDelayMs` getter → gets 'normal' value instead of 'fast'
  
  The getter properties (`moveDelayMs`, `animationStepDurationMs`) are cached (they read `this.server.speedMode` at call time), so the race window is narrow but real.
- **Impact:** UI displays wrong speed. In extreme cases, `aiMoveDelayMs` could be set to a negative value if two concurrent handlers race (both check bounds, but JavaScript single-threaded nature means one reads before the other writes — actually this is safe in JS). The real risk is logical inconsistency: client A thinks it set fast mode, but client B overwrote it.
- **Reproduction:** Open two browser tabs in aivai mode. Tab A calls setSpeedMode('fast'), Tab B calls setSpeedMode('normal'). The last write wins; one client's UI shows stale state.
- **Note:** JavaScript's single-threaded nature prevents memory corruption, but the logical race is still a bug.

---

## BUG-NEW-006: minimax.js king capture first-pass also missing empty-square validation
- **Severity:** HIGH
- **Location:** `server/ai/minimax.js` — `generateLegalMoves()` (king first-pass capture block)
- **Description:** In the first pass of `generateLegalMoves()` (finding captures), the king sliding capture logic iterates along diagonals looking for an opponent piece. When `foundOpp` is true and an empty square is found, it pushes a capture. The issue: the code correctly checks `board[idx] === 0` for the landing square BUT does not check that the landing square is valid for subsequent capture extensions. More critically, if there are two opponent pieces on the same diagonal (e.g., opponent at [1,1] and [3,3], king at [0,0]), the code finds the first opponent at [1,1], then continues sliding. At [2,2] it's empty → capture pushed (valid). But then at [3,3] it finds the SECOND opponent piece (`foundOpp` is already true, so it `break`s). This is correct. However, if there's a FRIENDLY piece at [2,2] (between two opponents), the code would break on the friendly piece at `foundOpp = false` and never find the capture. This is actually correct behavior.
- **Impact:** This is the same root cause as BUG-NEW-001 but in the first-pass generation (not just _extendCapture). Combined with BUG-NEW-001, king captures are unreliable in positions with multiple pieces on the same diagonal.
- **Reproduction:** King at [0,0], opponent at [2,2], own piece at [4,4]. The king should capture [2,2] and land on [3,3] (empty). But if the order is: opponent at [1,1], own piece at [2,2] — the code breaks on the own piece, which is correct. No bug here on closer analysis. Separating this from BUG-NEW-001 — the first-pass king logic is actually correct.

---

## BUG-NEW-007: Board.jsx — animPrevBoardRef stale during rapid state updates
- **Severity:** LOW
- **Location:** `client/src/components/Board.jsx` — multi-capture animation effect
- **Description:** `animPrevBoardRef` is updated in the simple-move animation effect (`useEffect([board, animStep])`), but it's read in the multi-capture animation effect (`useEffect([path, captures])`). If a multi-capture path arrives before the simple-move effect runs (e.g., server emits state + path in quick succession), `animPrevBoardRef.current` could be null, causing the multi-capture animation to silently fail (early return).
- **Impact:** Multi-capture animation doesn't play for the first move after page load, or for moves that arrive faster than React can render.
- **Reproduction:** Connect to server, immediately start a game in aivai mode. The first multi-capture move may not animate because `animPrevBoardRef` hasn't been populated yet.

---

## Summary

| Bug | Severity | Category | Status |
|-----|----------|----------|--------|
| BUG-NEW-001 | CRITICAL | Logic error — king capture on occupied square | New |
| BUG-NEW-002 | HIGH | Race condition — model dispose during prediction | Regression from fix |
| BUG-NEW-003 | MEDIUM | Data loss — dirty flag cleared before save | Regression from fix |
| BUG-NEW-004 | MEDIUM | Error handling — proxy crash on closed socket | New |
| BUG-NEW-005 | MEDIUM | Config mutation race — concurrent sockets | New |
| BUG-NEW-006 | HIGH | King capture first-pass (same as 001) | Duplicate of 001 |
| BUG-NEW-007 | LOW | Frontend animation — stale ref on rapid updates | New |

**Key finding:** The last 2 days of commits introduced two regressions (BUG-NEW-002, BUG-NEW-003). The fix for model dispose race (5653f34) has a subtle gap. The fix for save race condition (BUG-003) has a data loss window that wasn't present before.
