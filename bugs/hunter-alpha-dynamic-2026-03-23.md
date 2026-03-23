# Dynamic Bug Report — Checkers_vibe (Hunter Alpha)
**Date:** 2026-03-23
**Scope:** Last 5 commits + full codebase scan
**Commits analyzed:** b197b72, 2cd1559, 93ff25d, d56c4f9, 5e3c7f0

---

## Known Bug Status (from `__bugs_found_hunter_002.md`)

| # | Bug | Severity | Status |
|---|-----|----------|--------|
| 1 | No WebSocket auth | Critical | ❌ **NOT FIXED** — no auth added |
| 2 | getLegalMoves race with move | Critical | ❌ **NOT FIXED** — not serialized through `_moveQueue` |
| 3 | King multi-capture animation | Critical | ✅ **NOT A BUG** — current code correctly walks path steps, only flags opponent pieces |
| 4 | Missing CSP header | Important | ✅ **FIXED** — `Content-Security-Policy` added at line 32 of `server/index.js` |
| 5 | Rate limit memory leak | Important | ❌ **NOT FIXED** — cleanup only evicts IPs silent >60s |
| 6 | capturedKingsBB UB | Important | ⚠️ **PRESENT but low-risk** — `1ULL << (captures.size()-1)` at `size()=64` is UB, but practical max is 12 captures |
| 7 | Proxy body handling | Important | ✅ **NOT A BUG** — code correctly drops non-JSON body with `if (hasBody && req.body)` guard |
| 8 | Player can click during AI turn | Important | ❌ **NOT FIXED** — `isHumanPiece` allows selecting white regardless of turn |
| 9 | Duplicate game-over in trainer | Important | ⚠️ **STILL PRESENT** — ~30 lines duplicated between gameOver block and no-moves safety block |
| 10 | setSpeed/setSpeedMode auth | Important | ✅ **FIXED** — both handlers now check `socket.gameMode !== 'aivai'` |
| 11 | httplib body size | Important | ✅ **FIXED** — `svr.set_payload_max_length(1024 * 1024)` in `main.cpp:12` |
| 12-16 | Cosmetic bugs | Cosmetic | Various — `const result = 0` no longer present in trainer.js |

### Summary of known bugs:
- **Fixed since report:** 3 (#4 CSP, #10 setSpeed auth, #11 httplib body size)
- **Confirmed NOT a bug:** 2 (#3 animation, #7 proxy body)
- **Still present:** 6 (#1, #2, #5, #6, #8, #9)
- **Cosmetic:** partially resolved (#12 removed)

---

## Recent Commits Analysis (last 5)

| Commit | Description | Impact |
|--------|-------------|--------|
| b197b72 | Remove duplicate tests | ⚠️ Test coverage regression (see DYN-003) |
| 2cd1559 | CSS `.piece { transition: none }` | ✅ Fixes CSS/JS animation conflict |
| 93ff25d | Revert animation offset direction | ✅ Correct revert — offset was right |
| d56c4f9 | Change animation offset direction | ❌ Introduced bug, later reverted |
| 5e3c7f0 | Re-register test suites | ✅ Restores autoSaveTiming & boardConvertEdge tests |

**Net change:** Animation CSS fix (positive), test coverage slight regression (negative), 2 comments added to Board.jsx.

---

## NEW Bugs Found

### DYN-001: `getLegalMoves` not serialized — stale moves during concurrent `move`
- **File:** `server/index.js:420-438`
- **Severity:** Critical
- **Kroki:**
  1. Client A calls `getLegalMoves({ from: [5, 0] })` — starts async `getGameState()`
  2. Client A immediately calls `move({ from: [5, 0], to: [4, 1] })` — queued via `_moveQueue`
  3. `getLegalMoves` reads C++ engine state BEFORE `move` executes (no serialization)
  4. `getLegalMoves` returns stale legal moves from pre-move state
  5. Client displays invalid move targets
- **Oczekiwane:** `getLegalMoves` should be serialized through `_moveQueue` or use a shared mutex for all C++ state reads
- **Rzeczywiste:** `getLegalMoves` calls `getGameState()` directly, bypassing the serialization queue used by `move`
- **Status:** Same as original BUG #2 — **NOT FIXED**

### DYN-002: PvAI player can select pieces and fire requests during AI's turn
- **File:** `client/src/App.jsx:323-327`
- **Severity:** Important (UX)
- **Kroki:**
  1. Start PvAI game — human plays white
  2. Make a move — AI (black) starts thinking
  3. During AI's turn, click any white piece
  4. `getLegalMoves` request fires to server
  5. Server returns legal moves for BLACK's turn (filtered by white piece position → empty result or wrong moves)
  6. Click a target square → move rejected → error toast
- **Oczekiwane:** White pieces should not be selectable during AI's turn (`turn !== 'white'`)
- **Rzeczywiste:** `isHumanPiece = piece && piece.color === 'white'` — no turn check
- **Status:** Same as original BUG #8 — **NOT FIXED**

### DYN-003: Test coverage regression — removed tests without replacement
- **File:** `__tests__/trainerArrayMoves.test.js`, `__tests__/wsHandlerLogic.test.js`
- **Severity:** Important (maintainability)
- **Kroki:**
  1. Commit b197b72 removes 3 `isMoveLegal` edge-case tests (null move, empty legalMoves, null legalMoves)
  2. Same commit removes 7 `validateSpeedMode` tests from wsHandlerLogic
  3. `isMoveLegal` is still called in `_validateAndFallback` (trainer.js:~290)
  4. Edge cases (null move, empty/null legalMoves) no longer tested
- **Oczekiwane:** Edge-case tests should be preserved or moved to shared test file
- **Rzeczywiste:** Tests deleted — gaps in coverage for `isMoveLegal(null, ...)`, `isMoveLegal(move, [])`, `isMoveLegal(move, null)`
- **Note:** `validateSpeedMode` tests were arguably redundant (inline validation in WS handler), but `isMoveLegal` edge cases are important for safety

### DYN-004: Rate limit map still unbounded under sustained diverse-IP load
- **File:** `server/index.js:42-52`
- **Severity:** Important (memory/DoS)
- **Kroki:**
  1. Attacker sends requests from 100,000 unique IPs (via proxy pool)
  2. Each IP gets a Map entry with `{ windowStart, count }`
  3. Cleanup interval only removes IPs silent >60s
  4. IPs with continuous traffic reset `windowStart` → never evicted
  5. Map grows to 100,000+ entries → memory exhaustion
- **Oczekiwane:** Hard cap on map size (e.g., 10,000), evict oldest by `windowStart` when exceeded
- **Rzeczywiste:** No cap — cleanup is time-based only
- **Status:** Same as original BUG #5 — **NOT FIXED**

### DYN-005: `prevBoardRef.current` shallow copy — cell objects shared with animation refs
- **File:** `client/src/components/Board.jsx:95` and `client/src/App.jsx:96`
- **Severity:** Cosmetic (defensive coding)
- **Kroki:**
  1. Board changes → `prevBoardRef.current = board.map((row) => [...row])` (shallow copy)
  2. Cell objects `{color, king}` are shared references between `prevBoardRef` and actual board state
  3. `animPrevBoardRef.current` correctly deep-copies (`cell ? { ...cell } : null`)
  4. If any code mutates a cell object in place, both refs are affected
- **Oczekiwane:** Deep clone: `board.map(row => row.map(cell => cell ? {...cell} : null))`
- **Rzeczywiste:** Shallow copy — cell object references shared
- **Status:** Same as original cosmetic BUG #13 — **NOT FIXED**

---

## Verified Non-Bugs (retracted from __bugs_found_hunter_002.md)

### BUG #3: King multi-capture animation — NOT A BUG
- **Current code** (Board.jsx:68-85) correctly walks cells between consecutive path steps
- For king captures: path contains landing positions, the diagonal between them passes through the captured piece
- Code filters `prevBoard[r][c].color !== movingPiece.color` — only opponent pieces flagged as captured
- Own pieces along the diagonal are never incorrectly flagged
- **Verdict:** Original analysis was wrong; animation logic is sound

### BUG #7: Proxy body handling — NOT A BUG
- `if (hasBody && req.body)` correctly guards against undefined body
- Non-JSON POST bodies being dropped is expected behavior (app only sends JSON)
- **Verdict:** Working as designed

---

## Summary

| Severity | Count | Details |
|----------|-------|---------|
| Critical | 2 | DYN-001 (getLegalMoves race), WebSocket auth (#1 from original) |
| Important | 4 | DYN-002 (PvAI UX), DYN-003 (test regression), DYN-004 (rate limit leak), #9 (trainer duplication) |
| Cosmetic | 1 | DYN-005 (shallow copy) |
| Fixed | 3 | #4 CSP, #10 setSpeed auth, #11 httplib body |
| Not bugs | 2 | #3 animation, #7 proxy |

### Highest-impact unfixed issues:
1. **WebSocket auth (#1)** — any connected client can reset models, stop self-play, control game speed
2. **getLegalMoves race (DYN-001)** — stale legal moves displayed, causing rejected moves
3. **PvAI turn UX (DYN-002)** — confusing during AI's turn, error toasts on every click

### Commits in last 5 did NOT fix any of the critical/important bugs.
Recent work focused on animation CSS conflict resolution and test file housekeeping.
