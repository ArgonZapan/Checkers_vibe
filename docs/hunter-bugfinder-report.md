# Hunter Bug-Finder Report — Checkers_vibe

**Date:** 2026-03-23  
**Cycle:** Hunter Alpha  
**State:** All 1042 tests passing  
**Recent fixes:** per-piece board copy, bitboard mask, WebSocket validation, board conversion helpers, O(1) draw detection, MAX_CAPTURES constants, unused import cleanup

---

## Summary

| Severity | Count |
|----------|-------|
| Medium   | 5     |
| Low      | 5     |
| **Total** | **10** |

No critical bugs found. Codebase is in solid shape post-fixes. Issues below are edge cases and design inconsistencies.

---

## Bugs Found

### BUG-H001: Client doesn't send captures with move
- **Severity:** Medium
- **File:** `client/src/App.jsx`, line ~202 (`handleMove`)
- **Description:** `handleMove(from, to)` emits `{ from, to }` without the `captures` field. When a piece has multiple capture paths to the same destination square, the C++ engine cannot disambiguate which path the player intended. The server's move handler includes `captures` in the request body only if present in the client data. If the player selects a multi-capture target, the move may be rejected (400) or the wrong capture path executed.
- **Fix:** When clicking a valid move target, look up the matching legal move and include its `captures` array in the emit.

### BUG-H002: Rate limiter ineffective behind reverse proxy
- **Severity:** Medium
- **File:** `server/index.js`, line ~50
- **Description:** `req.ip` returns the proxy's IP when behind nginx/Caddy unless `app.set('trust proxy', 1)` is configured. All requests appear to come from the same IP, so one client hitting the limit blocks everyone, and a real attacker's distinct IPs aren't rate-limited individually.
- **Fix:** Add `app.set('trust proxy', 1)` or document that reverse proxy deployments must set this.

### BUG-H003: boardToTensor mutates its input parameter
- **Severity:** Medium
- **File:** `server/ai/model.js`, line ~113 (`boardToTensor`)
- **Description:** When `boardArray` is a flat 64-element array, the function reassigns `boardArray = wrapped` (the new 2D array). Since `boardArray` is a function parameter, this mutation is local and doesn't affect the caller. However, the `flat()` call on the original 2D input also returns a new array. The risk is minimal but the function's parameter mutation is a code smell and could confuse future maintainers.
- **Fix:** Use a separate local variable (`const board2D = ...`) instead of reassigning the parameter.

### BUG-H004: Dual cppFetch with inconsistent error handling
- **Severity:** Medium
- **File:** `server/index.js` (lines ~120-145) and `server/ai/trainer.js` (lines ~145-155)
- **Description:** Two separate `cppFetch` implementations exist. The server version logs non-OK responses and handles `ECONNREFUSED`/`ECONNRESET` specifically. The trainer version does neither — a non-OK response from the engine during self-play is silently returned without logging, making debugging harder. Both have timeout handling but error surfaces differently.
- **Fix:** Extract shared `cppFetch` utility with consistent logging and error handling.

### BUG-H005: model.js predict() inconsistent return type
- **Severity:** Medium
- **File:** `server/ai/model.js`, line ~200 (`predict`)
- **Description:** When `legalIndices.length === 0`, the function returns `{ move: 0, ... }` (number). In all other cases, it returns `{ move: selectedMoveObject, ... }` (object). Callers like `aiMove` in `server/index.js` then access `prediction.move.from` which would throw on `0.from`. The trainer's `_playGame` handles this via `_validateAndFallback`, but `aiMove` does not have equivalent protection.
- **Fix:** Return `{ move: null, ... }` for empty legal moves and have callers check for null.

### BUG-H006: React.memo captures comparison is shallow (length only)
- **Severity:** Low
- **File:** `client/src/components/Board.jsx`, line ~270 (`areEqual`)
- **Description:** The custom `areEqual` function compares `prevProps.captures?.length !== nextProps.captures?.length` but not the array contents. If captures change from `[[2,3]]` to `[[3,4]]` (same length), the Board component skips re-rendering and displays stale capture highlights.
- **Fix:** Compare captures content: `JSON.stringify(prevProps.captures) !== JSON.stringify(nextProps.captures)` or iterate elements.

### BUG-H007: boardToCpp may return short array for malformed boards
- **Severity:** Low
- **File:** `server/boardConvert.js`, line ~75 (`boardToCpp`)
- **Description:** If `board.flat()` returns fewer than 64 elements (malformed input), `boardToCpp` returns an array shorter than 64 without padding. The C++ engine expects exactly 64 elements. The guard only checks `flat.length > 64` (oversized) but not `< 64` (undersized).
- **Fix:** Add `if (flat.length < 64) flat.push(...new Array(64 - flat.length).fill(0));` or return the 64-zero fallback.

### BUG-H008: setSpeed/setSpeedMode modify global CONFIG for all clients
- **Severity:** Low
- **File:** `server/index.js`, lines ~360-385
- **Description:** Any connected client can change `CONFIG.server.speedMode` or `CONFIG.server.aiMoveDelayMs`, affecting all clients globally. In a multi-user scenario, one user changing speed affects another user's experience without notification. The speed UI in GameControls is duplicated in both the menu and in-game, meaning a menu speed selection can be overridden by an in-game speed change from another socket.
- **Fix:** Consider per-socket speed preferences or at minimum broadcast the change prominently so all clients update their UI.

### BUG-H009: Missing useEffect dependency array on ref sync
- **Severity:** Low
- **File:** `client/src/App.jsx`, line ~105
- **Description:** The `useEffect` that syncs state to refs has no dependency array, running on every render. While functionally correct (ref assignments are cheap), it's a React anti-pattern that could mask real performance issues if the component grows.
- **Fix:** Add explicit dependency array `[board, turn, selected, legalMoves, mode, gameOver]` or switch to `useRef` for all mutable values.

### BUG-H010: saveModel is not crash-safe (atomicity gap)
- **Severity:** Low
- **File:** `server/ai/model.js`, line ~280 (`saveModel`)
- **Description:** `saveModel` writes to a tmp directory, then `rm` the old directory, then `rename` tmp → target. If the process crashes between `rm` and `rename`, the model is lost entirely. The buffer's `save()` has the same pattern. While the auto-save interval uses a `_saving` flag to prevent concurrent saves, it doesn't protect against process crashes.
- **Fix:** Use `rename(tmp, target)` which atomically replaces on Linux without needing prior `rm` (only works for files, not directories). For directories, rename tmp to a backup, rename target to tmp (swap), then delete backup.

---

## No Bugs Found In

- **Move validation WebSocket handler** — comprehensive coordinate validation (0-7 range, integer check, captures array validation)
- **Rate limiter cleanup** — periodic interval correctly removes expired entries
- **Board conversion helpers** (`boardFromCpp`) — handles null, empty, wrong-length, 1D and 2D inputs with proper fallbacks
- **ReplayBuffer** — correct circular buffer implementation with atomic save/load
- **ErrorBoundary** — catches and displays React errors with refresh option
- **Security headers** — all five headers properly set
- **Prototype pollution prevention** — whitelist-based filtering in `setParams`
- **Race condition guard** — `paramsVersion` correctly invalidates in-flight games
- **Auto-save dirty flag** — prevents unnecessary writes
- **WebSocket move queue** — serializes moves per-socket to prevent races
