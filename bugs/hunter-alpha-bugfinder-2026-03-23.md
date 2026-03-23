# Hunter Alpha — BugFinder Report
**Date:** 2026-03-23  
**Scope:** Runtime bugs, edge cases, logical errors  
**Files scanned:** `server/index.js`, `client/src/**`, `server/ai/**`, `server/proxy.js`, `config.js`, `engine/src/**`

---

## Summary

Found **12 bugs**: 1 critical, 4 important, 7 minor.  
Focus: WebSocket race conditions, missing event handlers, validation gaps, memory/state leaks, edge cases.

---

## Critical

### BUG-001: Player can submit move during AI response animation — stale board state
**File:** `server/index.js` — `handleMove()`, `socket.on('move')`  
**Severity:** CRITICAL  
**Kroki:**  
1. Start PvAI game, player makes a move  
2. Server emits player's intermediate state, waits `animDelay` ms for animation  
3. During the delay, client receives state → shows board → player clicks piece → submits new `move` event  
4. `_moveQueue` serializes: second `handleMove` runs AFTER first completes (AI move done)  
5. BUT: the client selected a piece based on the intermediate board (before AI moved). After AI moves, that piece may be captured or the turn may still be white (valid move)  
6. If the piece was captured by AI → C++ returns 400 "illegal move" → user sees error  
**Oczekiwane:** Client should block input during the full player→AI animation cycle  
**Rzeczywiste:** Client allows clicks immediately after receiving state, before AI response completes. Move gets rejected with confusing error.  
**Fix:** Add a `animating` flag on the client that blocks `handleCellClick` until the full round completes.

---

## Important

### BUG-010: `speedUpdate` event emitted by server but never listened to on client
**File:** `server/index.js` (emitter), `client/src/App.jsx` (missing listener)  
**Severity:** IMPORTANT  
**Kroki:**  
1. Open two browser tabs connected to same server  
2. Tab A clicks "🐢 Wolno" (speed=350)  
3. Server mutates CONFIG + broadcasts `io.emit('speedUpdate', { aiMoveDelayMs: 350 })`  
**Oczekiwane:** Both tabs show speed=350  
**Rzeczywiste:** Tab A shows 350ms (local setState). Tab B never receives update — no `s.on('speedUpdate')` handler exists in App.jsx. Tab B's speed buttons remain at previous state.  
**Fix:** Add `s.on('speedUpdate', (data) => { setSpeed(data.aiMoveDelayMs); })` to socket setup.

### BUG-011: `/api/ai/train` doesn't validate `batch` is an array
**File:** `server/index.js` — `app.post('/api/ai/train', ...)`  
**Severity:** IMPORTANT  
**Kroki:**  
1. `curl -X POST /api/ai/train -H 'Content-Type: application/json' -d '{"batch":"invalid"}'`  
2. `req.body.batch || []` → `"invalid"` (truthy string)  
3. `batch.filter(s => s.turn === 1)` → **TypeError: batch.filter is not a function**  
**Oczekiwane:** 400 error: `"batch must be an array"`  
**Rzeczywiste:** 500 error: `"Training failed"` (caught by outer try/catch). Misleading error message, not a crash.  
**Fix:** Add `if (!Array.isArray(batch)) return res.status(400).json({ error: 'batch must be an array' })`.

### BUG-012: Auto-save `dirty` flag not set after `loadState` — epsilon lost on early crash
**File:** `server/ai/trainer.js` — `loadState()`  
**Severity:** IMPORTANT  
**Kroki:**  
1. Server starts, `loadState()` restores `epsilonWhite = 0.15` from `data/state.json`  
2. Before any game completes (dirty never set to true)  
3. Auto-save timer fires: `if (!trainer.dirty) return;` → skips save  
4. Server crashes or restarts  
5. `data/state.json` still has old value — BUT if any game completed, dirty was set and state was saved  
6. Edge case: if loadState loads epsilon, server starts self-play, first game takes 5+ minutes, auto-save fires (30s interval), dirty is false (no game completed yet) → nothing saved → server restarts → epsilon reverts to 0.3  
**Oczekiwane:** Loaded state should trigger `this.dirty = true`  
**Rzeczywiste:** `dirty` stays `false` after load. State not persisted until first game completes.  
**Fix:** Add `this.dirty = true;` at end of `loadState()`.

### BUG-013: `setSpeed` and `setSpeedMode` mutate CONFIG globally — last-write-wins race
**File:** `server/index.js` — `socket.on('setSpeed')`, `socket.on('setSpeedMode')`  
**Severity:** IMPORTANT  
**Kroki:**  
1. Client A emits `setSpeed(500)`  
2. Client B emits `setSpeed(0)` (simultaneously)  
3. `CONFIG.server.aiMoveDelayMs = 0` (B's value wins)  
4. Both clients get `speedUpdate { aiMoveDelayMs: 0 }`  
**Oczekiwane:** Either debounce or use per-session config  
**Rzeczywiste:** Last write wins. In a multi-client scenario, speed changes jump unpredictably.  
**Impact:** Low in practice (rare for 2+ clients to fight over speed), but architecturally fragile.

---

## Minor

### BUG-201: `predict()` falls back to `legalMoves[0]` when no policyIndex on moves
**File:** `server/ai/model.js` — `predict()`, line ~158  
**Severity:** MINOR  
**Kroki:**  
1. Call `predict(model, board, legalMoves, turn)` where `legalMoves` have no `policyIndex` or `index` fields  
2. `legalIndices` = `[undefined, ...]`  
3. After softmax sampling, `bestIdx` = a number 0-127  
4. `legalMoves.find(m => (m.policyIndex ?? m.index ?? m) === bestIdx)` — all comparisons fail (object ≠ number)  
5. Falls back to `legalMoves[0]` — arbitrary first move  
**Oczekiwane:** Return AI's preferred move  
**Rzeczywiste:** Returns `legalMoves[0]` regardless of model output  
**Note:** Only affects HTTP `/api/ai/predict` endpoint. WebSocket paths always set `policyIndex`. Low impact.

### BUG-202: Multi-capture animation matches pieces by color/type only
**File:** `client/src/components/Board.jsx` — animation `useEffect`  
**Severity:** MINOR  
**Kroki:**  
1. Multi-capture sequence involves one white pawn moving, one black pawn captured  
2. Board diff detection: empties = positions where pieces left; newPieces = positions where pieces arrived  
3. Matching: `if (e.color === np.color && e.king === np.king)` → first match wins  
4. If two white pawns of the same type exist (one moved normally, one was the multi-capture piece), wrong pawn could animate  
**Oczekiwane:** Match by exact source→destination, not just piece type  
**Rzeczywiste:** Visual glitch — wrong piece slides to new position  
**Note:** Unlikely in practice (multi-capture usually involves one active piece).

### BUG-203: Socket disconnect doesn't cancel pending move queue
**File:** `server/index.js` — `socket.on('disconnect')`  
**Severity:** MINOR  
**Kroki:**  
1. Player submits move (queued via `_moveQueue`)  
2. Player disconnects before Promise resolves  
3. `handleMove` executes, modifies C++ engine state  
4. Tries `socket.emit('state', ...)` → Socket.IO silently drops (disconnected)  
5. C++ board state changed, but no client saw the update  
**Oczekiwane:** Cancel pending operations on disconnect  
**Rzeczywiste:** Orphaned state change. Next connecting client sees unexpected board state.  
**Fix:** Store AbortController or flag per socket; check in handleMove before executing.

### BUG-204: `turnToColor(0)` returns 'white' instead of 'draw'
**File:** `server/index.js` — `turnToColor()` helper  
**Severity:** MINOR  
**Kroki:**  
1. C++ engine returns `turn: 0` (e.g., after draw)  
2. `turnToColor(0)` → falls to default `return 'white'`  
**Oczekiwane:** Return `'draw'` or null  
**Rzeczywiste:** Returns `'white'` → client shows "White's turn" after game ended in draw  
**Note:** Normally `gameOver` flag catches this, but UI could flash wrong turn briefly.

### BUG-205: `boardToCpp` silently drops pieces with invalid color
**File:** `server/boardConvert.js` — `boardToCpp()`  
**Severity:** MINOR  
**Kroki:**  
1. Board has piece `{ color: 'red', king: false }` (corrupted state)  
2. `p.color === 'white'` → false, `p.color === 'black'` → false  
3. Returns 0 → piece silently disappears from C++ engine's perspective  
**Oczekiwane:** Log warning or validate input  
**Rzeczywiste:** Silent data corruption. Piece vanishes, game state desyncs.

### BUG-206: `computePolicyIndex` returns 0 for invalid (same-square) move
**File:** `server/ai/model.js` — `computePolicyIndex()`  
**Severity:** MINOR  
**Kroki:**  
1. `computePolicyIndex([3,3], [3,3])` → `dr=0, dc=0`  
2. `dirKey = "0,0"` not in `DIRECTION_MAP`  
3. `dirIdx = undefined` → returns `0`  
**Oczekiwane:** Return -1 or throw  
**Rzeczywiste:** Returns 0 (valid policy slot for "NE from square 0"). If an invalid move somehow reaches this, it maps to a real policy index → incorrect training signal.

### BUG-207: `flattenBoard` doesn't validate cell values are 0-4
**File:** `server/ai/trainer.js` — `flattenBoard()` / `calculateReward()`  
**Severity:** MINOR  
**Kroki:**  
1. C++ returns board with unexpected value (e.g., `null`, `5`, `string`)  
2. `isOwnPiece(null, turn)` → `null === 1 || null === 2` → false  
3. Treats null as opponent piece → incorrect reward calculation  
**Oczekiwane:** Validate all cells are integers 0-4  
**Rzeczywiste:** Silent incorrect reward → model trains on wrong signal

---

## C++ Engine Notes

The C++ engine (`engine/src/`) is generally solid. No critical bugs found. Minor observations:
- `makeMoveUnchecked` is used in `server.cpp` after manual validation — correct pattern
- Multi-capture recursion with rollback is well-implemented (bitboard-based state save/restore)
- Draw detection (`movesWithoutCapture_ >= 40`) correctly counts half-moves
- The engine's `Color` enum (WHITE=0, BLACK=1) vs Node.js convention (1/-1) is handled correctly via `colorStr()` and `turnToColor()`

---

## Previous Reports Cross-Reference

| Bug | Source | Status |
|-----|--------|--------|
| BUG-201 (terminal reward string vs int) | hunter-bugfinder-v3 | ✅ Fixed — code uses `winner === 'white'` |
| Issue #129 (params race) | hunter-testwriter | ✅ Fixed — `paramsVersion` guard |
| Issue #130 (epsilon decay) | hunter-testwriter | ✅ Fixed — version check before decay |
| Issue #131 (buffer overwrite) | hunter-testwriter | ✅ Fixed — atomic write with rename |
| Issues #132-134 (dirty flag, save) | hunter-testwriter | ✅ Fixed — `dirty` flag + atomic saves |

**All previously reported bugs appear to be fixed. This report contains only NEW findings.**
