# Hunter Bug Report — Checkers_vibe

**Date:** 2026-03-23
**Scope:** C++ engine, Node.js server, client/frontend, test files
**Focus:** Logic bugs, edge cases, state management

---

## BUG-001: King moves always go to nearest square (policy index collision)

- **Location:** `server/ai/model.js:predict()` (lines ~200-230) and `computePolicyIndex()` (lines ~130)
- **Description:** The policy vector has 128 slots (32 dark squares × 4 directions). Multiple king moves in the same direction from the same square map to the **same** policy index. When predict() samples a direction, `legalMoves.find()` returns the first match — always the nearest square. The model cannot learn "move 3 squares vs 1 square" because they share a single policy slot. This severely limits king mobility and strategic play.
- **Severity:** **Critical** — king pieces are fundamentally limited in where they can move
- **Example:** King at (2,1) can move SE to (3,2), (4,3), (5,4), (6,5), (7,6). All have policyIndex=34. Model outputs one probability for "move SE". `find()` always returns (3,2).
- **Suggested fix:** Expand the policy vector to encode distance, or use array-index-based policy (not canonical direction-based). Alternatively, when multiple moves share a policy index, sample proportionally among them rather than always returning the first.

---

## BUG-002: EMPTY_BOARD() has reversed colors vs C++ engine

- **Location:** `client/src/App.jsx:11-22` (EMPTY_BOARD function)
- **Description:** `EMPTY_BOARD()` places `{color:'black'}` at rows 0-2 (top) and `{color:'white'}` at rows 5-7 (bottom). But the C++ engine's `Board::reset()` places whitePieces at rows 0-2 and blackPieces at rows 5-7. When the server sends the initial state, white pieces appear at the top of the screen (row 0) and black at the bottom. In PvAI mode, the human controls white — playing from the top, which is counterintuitive (standard checkers has the human at the bottom).
- **Severity:** **Important** — confusing board orientation, non-standard UX
- **Suggested fix:** Either swap colors in EMPTY_BOARD() to match C++ engine, or flip the rendering order in Board.jsx so row 7 is at the top. Alternatively, add board flipping so the human player always sees their pieces at the bottom.

---

## BUG-003: Server /api/move fails for multi-capture when client omits captures

- **Location:** `engine/src/server.cpp` (POST /api/move handler, around line 100)
- **Description:** When the client sends `{from, to}` without `captures` for a multi-capture move, the server's move matching iterates legal moves and picks the first one with matching from/to. The `capturesEqual` check is skipped when `body` doesn't contain captures. If C++ generates two legal moves with the same from/to but different capture sequences (possible in complex multi-capture positions), the server picks arbitrarily. Additionally, if the client sends `captures: []` (empty array), the code checks `body.contains("captures")` which is true, then compares `numCaptures != caps.size()` (e.g., 2 != 0) and skips the match — move is rejected as illegal even though it's valid.
- **Severity:** **Important** — multi-capture moves may be rejected or wrong capture sequence executed
- **Suggested fix:** When captures are omitted or empty in the request, match on from/to only (any capture sequence). Or always require the full capture list from the client.

---

## BUG-004: Speed buttons visible on menu screen (not AIvAI-only)

- **Location:** `client/src/App.jsx:215-219` (menu render section)
- **Description:** The speed buttons (⚡ Błyskawica, 🏃 Szybko, 🐢 Wolno) are rendered on the main menu screen alongside mode selection buttons. They emit `setSpeed` to the server regardless of game mode. Speed changes only affect AI-vs-AI move delays, so in PvP mode these buttons do nothing useful. The fix mentioned "Speed buttons only in AIvAI mode" was applied to `GameControls.jsx` but the menu buttons were missed.
- **Severity:** **Cosmetic** — misleading UI, buttons appear to do something in all modes
- **Suggested fix:** Remove speed buttons from the menu screen, or show them only after selecting AIvAI mode.

---

## BUG-005: PvP race condition — both players can submit moves simultaneously

- **Location:** `server/index.js` (WebSocket `move` handler, around line 240)
- **Description:** In PvP mode, both clients can emit `move` events before the server processes either one. The server calls `getGameState()` in `handleMove()` to get legal moves for validation, but two concurrent `handleMove` calls will both see the same game state and both validate their moves as legal. The first move executes successfully; the second fails because the board has changed, and the player sees a "Move failed" error for a perfectly valid move.
- **Severity:** **Important** — frustrating UX in PvP, valid moves get rejected
- **Suggested fix:** Queue all moves per-game (not per-socket) so only one move is processed at a time across all clients. Or add optimistic locking — reject the second move if the board state changed between validation and execution.

---

## BUG-006: drawDetection.test.js documents broken /api/board/set endpoint

- **Location:** `__tests__/drawDetection.test.js` (TODO comments at end of file) and `engine/src/server.cpp` (POST /api/board/set handler)
- **Description:** The test documents that `/api/board/set` does NOT call `engine.reset()` before setting the board. Looking at the actual server.cpp code, it DOES call `engine.reset()` (line: `engine.reset(); Board b = arrayToBoard(boardArr, turn); engine.getBoard() = b;`). The test's TODO comment is stale/incorrect. However, the test still can't reliably test 40-move draw via HTTP because the board set + play approach depends on the engine not finding captures that would reset the counter.
- **Severity:** **Cosmetic** (stale test comment) — but the test gap (no HTTP-level draw detection test) remains real
- **Suggested fix:** Remove the stale TODO comment. Add an HTTP-based test that uses kings-only positions to verify the 40-move draw.

---

## BUG-007: predictMasking.test.js uses wrong policy vector size and index field

- **Location:** `__tests__/predictMasking.test.js` (entire file)
- **Description:** The test uses a 48-element policy vector (`Float32Array(48)`) but the actual model outputs 128 elements (32 dark squares × 4 directions). The test's `predict()` helper uses `m.index` for lookup, but the actual server predict uses `m.policyIndex ?? m.index ?? m`. This means the test doesn't catch bugs related to the 128-element policy vector or the policyIndex field.
- **Severity:** **Important** — test gives false confidence, doesn't test actual code path
- **Suggested fix:** Update the test to use 128-element policy vectors and `m.policyIndex` for lookups. Or better, test the actual predict function from model.js.

---

## BUG-008: Server auto-save race — concurrent saves can corrupt state

- **Location:** `server/index.js` (auto-save setInterval, around line 370)
- **Description:** The auto-save timer checks `if (_saving) return;` to prevent concurrent saves. However, if a save operation takes longer than `CONFIG.server.autoSaveMs` (default 30s), the next interval tick is skipped. This is fine. But there's no protection against `trainer.resetModel()` (which also calls `saveState()`) racing with the auto-save timer. If a user triggers reset while auto-save is in progress, both could write to the state file simultaneously. The atomic write pattern (temp + rename) mitigates file corruption, but the `_saving` flag is only checked in the interval, not in resetModel().
- **Severity:** **Important** — potential state corruption on concurrent reset + auto-save
- **Suggested fix:** Have `resetModel()` also check/set the `_saving` flag, or use a proper mutex/promise-based lock for all save operations.

---

## BUG-009: C++ engine undoLastMove() rebuild is O(n) per undo

- **Location:** `engine/src/engine.cpp` (undoLastMove, lines ~90-98)
- **Description:** After undoing a move, `undoLastMove()` rebuilds `movesWithoutCapture_` by iterating backwards through the entire history. For a game with 200 moves, this is O(200) per undo. If undo is called repeatedly (e.g., implementing a "take back" feature), the cumulative cost is O(n²). Not a bug per se, but an unnecessary performance issue.
- **Severity:** **Cosmetic** — performance issue, not a correctness bug
- **Suggested fix:** Store `movesWithoutCapture_` before each move in the history, then restore it directly on undo instead of rebuilding.

---

## BUG-010: Server getGameState() has no error recovery

- **Location:** `server/index.js` (getGameState function, around line 130)
- **Description:** `getGameState()` calls `cppFetch('/api/game/state')` and `cppFetch('/api/legal-moves')` with `Promise.all`. If the C++ engine crashes or is unreachable, both calls throw, and the error propagates to every caller. The WebSocket `connection` handler catches this with a try/catch, but other callers (like `handleMove`) let the error propagate up to the per-socket promise chain where it shows a generic "Move failed" error.
- **Severity:** **Important** — engine crash causes opaque error messages for all clients
- **Suggested fix:** Add a health check before getGameState calls, or return a meaningful error state (e.g., `{error: "engine_down"}`) instead of throwing.

---

## BUG-011: Client EMPTY_BOARD() creates board with wrong piece placement for starting position

- **Location:** `client/src/App.jsx:11-22`
- **Description:** The EMPTY_BOARD function places black pieces on dark squares in rows 0-2 and white pieces on dark squares in rows 5-7. The dark square check `if ((r + c) % 2 === 1)` is correct for finding playable squares. However, the C++ engine defines rows 0-2 as the starting position for the FIRST player (white/currentTurn). The client's EMPTY_BOARD has black at rows 0-2. This means if the client ever uses EMPTY_BOARD as the actual starting position (without server override), the colors are wrong. In practice, the server sends the correct initial state, but the discrepancy is a latent bug.
- **Severity:** **Cosmetic** — latent, not triggered in normal flow
- **Suggested fix:** Align EMPTY_BOARD with C++ engine: white at rows 0-2, black at rows 5-7.

---

## BUG-012: boardFromCpp returns empty board for `[[]]` (single empty row)

- **Location:** `server/boardConvert.js:boardFromCpp()` (line ~20)
- **Description:** If the C++ engine sends a board array with a single empty row like `[[]]`, the function passes the `board2D.length !== 8` check (1 !== 8 → returns empty board, OK). But if it receives `Array(8).fill([])` (8 empty rows), it passes the length check but fails when accessing `board2D[r][c]` because each row is empty. The `[].length !== 8` check catches this. However, for a board like `[[0], [0], [0], [0], [0], [0], [0], [0]]` (8 rows, 1 column each), it passes the row count check but `board2D[r].length !== 8` catches it. The function is robust but the edge case of exactly 8 rows with varying lengths (e.g., some 7, some 8) is not caught — only per-row validation saves it.
- **Severity:** **Cosmetic** — defensive code works, but the validation could be tighter
- **Suggested fix:** Already handled by per-row validation. No change needed.

---

## BUG-013: Trainer _playGame duplicates gameOver logic (code smell → maintenance risk)

- **Location:** `server/ai/trainer.js:_playGame()` (two blocks handling gameOver, around lines 280 and 340)
- **Description:** The function has two separate blocks that handle game-over: one for the normal `stateData.gameOver` check, and a second "safety net" block when `legalMoves.length === 0`. Both blocks do the same thing (assign results, add to buffer, emit events). If one block is updated (e.g., new reward logic), the other might be missed, leading to inconsistent behavior. This is a maintainability bug.
- **Severity:** **Cosmetic** — no current behavioral difference, but high maintenance risk
- **Suggested fix:** Extract game-over handling into a shared function called from both places.

---

## Summary

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| BUG-001 | **Critical** | AI/Model | King moves always go to nearest square (policy collision) |
| BUG-002 | **Important** | Client | Board orientation reversed vs C++ engine |
| BUG-003 | **Important** | Server/C++ | Multi-capture move matching fails without captures |
| BUG-004 | **Cosmetic** | Client | Speed buttons on menu screen |
| BUG-005 | **Important** | Server | PvP simultaneous move race condition |
| BUG-006 | **Cosmetic** | Tests | Stale TODO comment in drawDetection test |
| BUG-007 | **Important** | Tests | predictMasking test uses wrong policy size |
| BUG-008 | **Important** | Server | Auto-save vs resetModel race condition |
| BUG-009 | **Cosmetic** | C++ | O(n) undo rebuild |
| BUG-010 | **Important** | Server | No error recovery in getGameState |
| BUG-011 | **Cosmetic** | Client | EMPTY_BOARD colors don't match C++ |
| BUG-012 | **Cosmetic** | Server | boardFromCpp edge case (already mitigated) |
| BUG-013 | **Cosmetic** | Server | Duplicated gameOver logic in trainer |

**Total: 1 critical, 6 important, 6 cosmetic**
