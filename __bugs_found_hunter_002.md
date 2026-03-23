# Bug Report — Checkers_vibe (Hunter 002)

**Date:** 2026-03-23
**Scope:** Full codebase — C++ engine, Node.js server, React client, AI trainer

---

## Critical

### 1. No WebSocket authentication — any client can control game/model
- **File:** `server/index.js` (all socket handlers)
- **Description:** The WebSocket server has no authentication. Any connected client can: start/stop self-play, reset models, change hyperparameters, control game speed, and reset the entire system. The `setParams` handler checks `socket.gameMode !== 'aivai'` but a malicious client can first call `startGame({ mode: 'aivai' })` to set its mode, then freely call `setParams`.
- **Severity:** Critical — security
- **Fix:** Add WebSocket authentication (token-based or session-based). Restrict destructive operations (`setParams`, `reset`, `restart`, `startSelfPlay/stopSelfPlay`) to authenticated admin clients.

### 2. `getLegalMoves` event handler is not serialized — race with `move` handler
- **File:** `server/index.js` (socket.on('getLegalMoves'))
- **Description:** The `move` handler serializes via `socket._moveQueue`, but `getLegalMoves` does not. If a `getLegalMoves` call races with a `move` call (both read/write C++ engine state), the returned legal moves may be stale (from before the move was applied). The client then highlights invalid move targets.
- **Severity:** Critical — logic error
- **Fix:** Serialize `getLegalMoves` through the same promise queue as `move`, or use a global mutex for all C++ engine state calls.

### 3. Multi-capture animation only checks adjacent cells between path steps — misses king slides
- **File:** `client/src/components/Board.jsx:55-75`
- **Description:** The animation determines captured positions by iterating cells between consecutive path steps using `dr = Math.sign(r2 - r1)`, checking one cell at a time. For pawn captures this is correct (always jump 2 squares). But for king multi-captures, the king can slide multiple squares between captures. The animation loop only checks intermediate cells along the diagonal, but if the king slides more than 2 squares (e.g., from (0,0) capturing at (3,3) landing at (4,4)), the code checks cells (1,1), (2,3), (3,3) — but the actual captured piece is at (3,3), and the cells (1,1) and (2,2) would also be checked. If there are own pieces on those squares, they'd be incorrectly flagged as captured.
- **Severity:** Critical — visual corruption during king multi-captures
- **Fix:** Match captured positions against `prevBoard` opponent pieces at known capture coordinates (from `lastMove.captures`), rather than inferring captures from path geometry.

---

## Important

### 4. Missing `Content-Security-Policy` header — XSS protection incomplete
- **File:** `server/index.js:30-36` (security headers middleware)
- **Description:** Security headers include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`, but no `Content-Security-Policy`. Combined with `X-XSS-Protection: 0` (disabling the legacy XSS auditor), the app has no script injection mitigation.
- **Severity:** Important — security
- **Fix:** Add `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:`.

### 5. Rate limit map grows unbounded — memory leak under sustained diverse-IP load
- **File:** `server/index.js:42-52`
- **Description:** The cleanup interval only removes entries for IPs silent for >60s. An IP with continuous traffic keeps resetting its `windowStart` and is never evicted. Under a DDoS with many unique IPs, the map grows without bound.
- **Severity:** Important — memory leak (DoS vector)
- **Fix:** Add a hard cap on map size (e.g., 10,000 entries). When exceeded, evict oldest by `windowStart`. Or use `lru-cache` with TTL.

### 6. `capturedKingsBB` can exceed 16-bit `capturedKingsMask` if captures > 16 during recursion
- **File:** `engine/src/movegen.cpp` (multiCapture function), `engine/src/board.h:25` (Move.capturedKingsMask is uint16_t)
- **Description:** `capturedKingsBB` uses `1ULL << (captures.size() - 1)` to track king status. During recursion, `captures` can grow beyond `MAX_CAPTURES (12)`. At Move creation, the mask is truncated: `static_cast<uint16_t>(capturedKingsBB & ((1ULL << Move::MAX_CAPTURES) - 1))`. While MAX_CAPTURES=12 fits in uint16_t, the `1ULL << (captures.size() - 1)` during recursion with captures.size() > 63 would be undefined behavior (shift by >= 64 on uint64_t).
- **Severity:** Important — undefined behavior risk
- **Fix:** Clamp `captures.size()` check before shifting: `if (captures.size() < 64)` before `1ULL << (captures.size() - 1)`.

### 7. Proxy `proxyReq` handler doesn't guard against missing `req.body`
- **File:** `server/proxy.js:35-45`
- **Description:** The handler re-serializes `req.body` for POST/PUT/PATCH. If `express.json()` hasn't parsed the body (non-JSON content type), `req.body` is `undefined`. The code checks `if (hasBody && req.body)` which handles this, BUT if a POST request has a non-JSON body (e.g., form-encoded), it's silently dropped — the proxy sends an empty body to C++.
- **Severity:** Important — proxy reliability
- **Fix:** Forward raw body when `req.body` is undefined but content-type indicates a body exists. Or log a warning.

### 8. Player can click pieces during AI's turn in PvAI mode — confusing UX
- **File:** `client/src/App.jsx:229-235`
- **Description:** In PvAI mode, `isHumanPiece` is `true` for ANY white piece regardless of `turnRef.current`. During the AI's turn (black), the player can select white pieces and fire `getLegalMoves` requests. These return moves for the wrong turn, displayed as valid targets. Clicking a target sends a move that's rejected by the server with an error toast.
- **Severity:** Important — UX bug
- **Fix:** In PvAI, only allow selecting white pieces when `turnRef.current === 'white'`.

### 9. Duplicate game-over handling code in trainer.js `_playGame`
- **File:** `server/ai/trainer.js:~410-445` and `~460-490`
- **Description:** The "no legal moves" safety block duplicates ~30 lines of game-over handling logic (stats update, buffer emission, round timing). Copy-paste divergence risk: a fix applied to one block may be missed in the other.
- **Severity:** Important — maintainability, potential for stat corruption
- **Fix:** Extract game-over handling into a shared function, call from both code paths.

### 10. `setSpeed` and `setSpeedMode` handlers lack game mode checks — any client can change global speed
- **File:** `server/index.js` (socket.on('setSpeed'), socket.on('setSpeedMode'))
- **Description:** While `setParams` checks `socket.gameMode !== 'aivai'` before applying changes, the `setSpeed` and `setSpeedMode` handlers have no such check. Any connected client (including PvAI players or spectators) can change the global game speed by emitting these events. The speed change is broadcast to ALL clients via `io.emit('speedUpdate', ...)`, affecting every connected player's experience.
- **Severity:** Important — any client can change game speed for all users
- **Fix:** Add game mode or admin role check to `setSpeed` and `setSpeedMode` handlers.

### 11. C++ httplib has no request body size limit — potential memory exhaustion
- **File:** `engine/src/main.cpp` (httplib::Server setup)
- **Description:** The C++ server uses httplib without calling `set_payload_max_length()`. While the Node.js proxy has a 1MB limit (`express.json({ limit: '1mb' })`), direct requests to port 8080 bypass this. A malicious client could send a multi-GB JSON body to `/api/board/set` or `/api/move`, causing `json::parse(req.body)` to consume all available memory before validation catches it.
- **Severity:** Important — DoS vector
- **Fix:** Call `svr.set_payload_max_length(1024 * 1024)` (1MB) on the httplib server in `main.cpp`.

---

## Cosmetic / Low

### 12. `unused variable` in trainer.js `_playGame`
- **File:** `server/ai/trainer.js:~380` and `~464`
- **Description:** `const result = 0;` is declared but never read in both the game-over block and the no-moves safety block.
- **Severity:** Cosmetic
- **Fix:** Remove `const result = 0;` lines.

### 13. Inconsistent timeout variable naming across files
- **File:** `server/index.js:107` (`CPP_FETCH_TIMEOUT_MS`), `server/ai/trainer.js:33` (`FETCH_TIMEOUT_MS`)
- **Description:** Both reference `CONFIG.server.fetchTimeoutMs` but use different variable names.
- **Severity:** Cosmetic
- **Fix:** Use consistent naming.

### 13. `boardRef.current` shallow copy shares cell object references
- **File:** `client/src/App.jsx:120`
- **Description:** `prevBoardRef.current = board.map((row) => [...row])` shallow-copies rows but cell objects `{color, king}` are shared references. If animation code mutates a cell in place, both references are affected. The `animPrevBoardRef` correctly deep-copies (`cell ? { ...cell } : null`), but `prevBoardRef` does not.
- **Severity:** Cosmetic — defensive coding
- **Fix:** Use deep clone: `board.map(row => row.map(cell => cell ? {...cell} : null))`.

### 14. `ErrorBoundary` hides error details in all environments
- **File:** `client/src/components/ErrorBoundary.jsx`
- **Description:** The error boundary shows a generic "Wystąpił nieoczekiwany błąd" message. The `error` state is stored but never displayed. In development, `error.message` should be visible for debugging.
- **Severity:** Cosmetic
- **Fix:** Show `error.message` conditionally: `{process.env.NODE_ENV === 'development' && error?.message}`.

### 15. King `hasAnyMove` doesn't distinguish king vs pawn for piece at same position
- **File:** `engine/src/movegen.cpp:hasAnyMove()`
- **Description:** The function uses `if (pawns & mask)` to decide pawn vs king path. If a bitboard invariant were violated (piece in both pawns and kings), the pawn path is taken, limiting movement. Current code maintains the invariant correctly, but defensive coding would be safer.
- **Severity:** Cosmetic — robustness
- **Fix:** Add assertion: `assert(!(pawns & kings))` at function entry (debug builds only).

### 16. Missing `package.json` dependency visibility for client
- **File:** Root `package.json` vs `client/` directory
- **Description:** The root `package.json` doesn't list React, socket.io-client, or vite. These must be in a `client/package.json`. If that file is missing or incomplete, the build fails silently.
- **Severity:** Cosmetic — build concern
- **Fix:** Ensure `client/package.json` exists with correct dependencies; document the build setup.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3     |
| Important | 7    |
| Cosmetic | 6     |
| **Total** | **16** |

### Highest-impact issues:
1. **No WebSocket auth (#1)** — anyone on the network can destroy trained models or hijack gameplay
2. **getLegalMoves race (#2)** — stale legal moves displayed to player, causing rejected moves
3. **King multi-capture animation (#3)** — visual corruption during complex king captures

### Previously reported but retracted (false positives):
- ~~Missing `/api/board/set` endpoint~~ — endpoint exists at `engine/src/server.cpp:252`
- ~~Policy index only uses 38% of vector~~ — `darkFrom` correctly ranges 0-31, policyIndex 0-127, matching the 128-dim policy head
- ~~EMPTY_BOARD inverted colors~~ — display convention only, overwritten by server state
- ~~Bitboard invariant violation~~ — `makeMove` correctly ensures exclusive ownership
