# Dynamic Bug Finder Report

**Date:** 2026-03-23  
**Scope:** /opt/Checkers_vibe (source, excluding node_modules)  
**Files analyzed:** server/index.js, server/ai/trainer.js, server/ai/model.js, server/proxy.js, server/boardConvert.js, engine/src/server.cpp, config.js, server/ai/buffer.js

---

## BUG-001: Duplicate `app.set('trust proxy', false)`
- **Location:** server/index.js:18, 22
- **Severity:** info
- **Description:** `trust proxy` is set to `false` twice. Harmless but redundant — line 22 overrides line 18 with the same value. The SEC-001/SEC-002 comments suggest someone added it twice without noticing.
- **Fix:** Remove one of the two lines. Keep line 18, delete line 22 (and the SEC-002 comment).

---

## BUG-002: trainer.js cppFetch — no AbortError/ECONNREFUSED handling
- **Location:** server/ai/trainer.js:122-128
- **Severity:** warn
- **Description:** The `cppFetch()` in trainer.js only does `fetch()` + `AbortController` timeout with no catch for `AbortError` or `ECONNREFUSED`/`ECONNRESET`. Compare with `server/index.js:cppFetch` (lines 107-126) which properly catches these and throws descriptive errors. If the C++ engine crashes during self-play, `trainer.cppFetch` will throw raw `AbortError` with no useful message, and the `_playGame` error handler won't distinguish engine-down from other errors.
- **Fix:** Add the same error handling as `server/index.js:cppFetch`:
  ```js
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`C++ engine timeout (${FETCH_TIMEOUT_MS}ms)`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      throw new Error(`C++ engine unreachable — ${err.code}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  ```

---

## BUG-003: `/api/ai/predict` — no validation of legalMoves array elements
- **Location:** server/index.js:52-53
- **Severity:** warn
- **Description:** The predict endpoint checks `if (!board || !legalMoves)` but does not validate:
  1. That `legalMoves` is actually an array (a truthy non-array like `"string"` passes the check)
  2. That `legalMoves` is non-empty (empty array `[]` is truthy, passes check)
  3. That each element has valid `from`/`to` structure

  An empty `legalMoves: []` would cause `predict()` to return `{ move: 0, probabilities: {}, value: 0 }` — meaningless. A non-array `legalMoves` would crash inside `predict()` with an unclear error.
- **Fix:** Add validation after the existing check:
  ```js
  if (!Array.isArray(legalMoves) || legalMoves.length === 0) {
    return res.status(400).json({ error: 'legalMoves must be a non-empty array' });
  }
  ```

---

## BUG-004: trainer.js cppFetch — response `.ok` not checked
- **Location:** server/ai/trainer.js:125
- **Severity:** warn
- **Description:** `trainer.cppFetch` returns the raw `fetch()` response without checking `res.ok`. All callers then use the response (`.json()`, `.status`, etc.) assuming success. In contrast, `server/index.js:cppFetch` checks `!res.ok` and throws. A 500 response from C++ will be parsed as JSON and could contain `{"error":"..."}` instead of the expected data, causing downstream crashes with confusing error messages.
- **Fix:** Add `res.ok` check:
  ```js
  const res = await fetch(url, { ...opts, signal: controller.signal });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`C++ ${url} → ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  return res;
  ```

---

## BUG-005: `_validateAndFallback` — scalar index treated as array index
- **Location:** server/ai/trainer.js:212-215
- **Severity:** critical
- **Description:** `_validateAndFallback` handles `chosenMove` when it's a number:
  ```js
  if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
    const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
    selectedMove = legalMoves[idx] || null;
  }
  ```
  If `chosenMove` is a **number**, it's used as a direct array index into `legalMoves`. But numbers in this context could be policy indices (0-127) while `legalMoves` length is typically much smaller (10-30 moves). E.g., `chosenMove = 64` with 12 legal moves → `legalMoves[64]` = `undefined` → falls through to `validateMove(null)` → returns random move. This means model predictions that return numeric policy indices are silently degraded to random moves.
- **Fix:** When `chosenMove` is a plain number, interpret it as a policy index and look up the matching move:
  ```js
  if (typeof chosenMove === 'number') {
    selectedMove = legalMoves.find(m => (m.policyIndex ?? m.index) === chosenMove) || null;
  } else if (chosenMove && typeof chosenMove.index === 'number') {
    selectedMove = legalMoves[chosenMove.index] || null;
  }
  ```

---

## BUG-006: `predict()` — policy index collision → wrong move selected
- **Location:** server/ai/model.js:188-195
- **Severity:** warn
- **Description:** After sampling from the policy distribution, `predict()` finds the selected move by matching `bestIdx` against `legalMoves` using `m.policyIndex ?? m.index ?? m`. If two legal moves share the same `policyIndex` (e.g., a simple move and a capture from the same square in the same direction — possible with multi-jump), only the first match is returned. The actual capture sequence is lost.
- **Fix:** When multiple moves share the same policy index, prefer the one with captures (or use the `index` field which is unique per move in `_playGame`'s mapping). Also, if `computePolicyIndex` collisions are possible, the index should incorporate capture path info.

---

## BUG-007: Training samples may lose policy target when fallback move lacks `policyIndex`
- **Location:** server/ai/trainer.js:474-478
- **Severity:** warn
- **Description:** In `train()`, the policy target is built using `chosenMove.policyIndex ?? chosenMove.index ?? chosenMove`. In `_playGame`, if `_validateAndFallback` returns a raw C++ engine move (fallback path), that move only has `from`/`to`/`captures` — no `policyIndex` or `index`. Then `moveIdx = chosenMove` (an object), `policyTarget[object]` = 0 (JS coerces to string key, numeric index gets 0). The policy target becomes all-zeros — the model learns nothing from that sample's policy head.
- **Fix:** In `_validateAndFallback`, when falling back to a random move, compute and attach `policyIndex`:
  ```js
  const fallback = this._randomLegalMove(legalMoves);
  if (fallback) fallback.policyIndex = computePolicyIndex(fallback.from, fallback.to);
  return fallback;
  ```

---

## BUG-008: `boardToTensor` — negative piece values mishandled
- **Location:** server/ai/model.js:50-58
- **Severity:** warn
- **Description:** The encoding logic:
  ```js
  const isWhite = val > 0 && (absVal === 1 || absVal === 2);
  ```
  If the C++ engine ever sends negative values (e.g., `-1` for black pawn instead of `3`), `isWhite` would be false (good), but `absVal` would be 1 which matches white pawn encoding. The `isKing` check `absVal === 2 || absVal === 4` also wouldn't distinguish — `-3` (black pawn) would have `absVal=3`, not matching any king check, which is correct. However, the code silently accepts negative values without warning. If a corrupt board has `-1` pieces, they'd be treated as "black pawn" (channel index 2) instead of being caught as invalid. Not currently triggered (C++ always sends 0-4), but fragile.
- **Fix:** Add validation: reject or warn on values outside 0-4. Or explicitly handle negative encoding:
  ```js
  if (val < 0 || val > 4) {
    console.warn(`[boardToTensor] Unexpected piece value: ${val} at index ${i}`);
  }
  ```

---

## BUG-009: `calcThreat` — confusing variable naming masks actual logic
- **Location:** server/ai/trainer.js:71-100
- **Severity:** info
- **Description:** The `calcThreat` function iterates over all board pieces. The variable `isMy` is set for each piece individually, but then the `if (isMy) myThreats++` check is redundant — it's always checking the current piece. The logic actually counts: "for each piece, if an opponent piece adjacent to it could jump over it into an empty square, increment the threatened piece's side counter." This is correct but the variable naming (`isMy` for the current piece, then `myThreats`/`oppThreats`) is misleading — it sounds like it's counting threats FROM the current side, when it's counting threats TO the current side.
- **Fix:** Rename variables for clarity (no functional change):
  ```js
  const pieceIsMine = isOwnPiece(board[i], turn);
  // ... 
  if (pieceIsMine) myThreats++; else oppThreats++;
  ```

---

## BUG-010: Self-play `_playGame` — duplicated game-over handling (DRY violation)
- **Location:** server/ai/trainer.js:302-348, 357-386
- **Severity:** info
- **Description:** The game-over logic is implemented twice: once for the normal `gameOver` flag (line 302), and again for the no-legal-moves fallback (line 357). The code is nearly identical (~30 lines each). This is error-prone — a fix applied to one path might miss the other.
- **Fix:** Extract the game-over handling into a method `_handleGameOver(samples, winner, roundStart)` and call from both paths.

---

## BUG-011: Auto-save race between `trainer.dirty` and save completion
- **Location:** server/index.js:342-371
- **Severity:** info
- **Description:** The auto-save interval sets `trainer.dirty = false` BEFORE the async save completes. If a training step sets `dirty = true` during the save, the next cycle catches it (good). But if the save itself fails (e.g., disk full), `dirty` is already `false` and the failed save's data is lost. The comment at line 350 acknowledges this design.
- **Fix:** Move `trainer.dirty = false` into the `try` block AFTER all saves succeed, or restore it in the `catch`:
  ```js
  catch (err) {
    trainer.dirty = true; // restore so next cycle retries
    console.error('[AutoSave] Save error:', err.message);
  }
  ```

---

## BUG-012: Rate limit map — unbounded growth between cleanup intervals
- **Location:** server/index.js:37-56
- **Severity:** info
- **Description:** The cleanup runs every `RATE_LIMIT_WINDOW_MS` (60s). In the worst case, a burst of 10K unique IPs in one window fills the map to `RATE_LIMIT_MAX_ENTRIES`, and the hard-cap eviction only runs at the next cleanup tick. The map can hold 10K entries × ~100 bytes ≈ 1MB, which is fine for a game server. Low risk but worth noting.
- **Fix:** Current behavior is acceptable for the use case. Optionally add a secondary cleanup on every 100th request.

---

## BUG-013: No auto-recovery when C++ engine is down on server start
- **Location:** server/index.js:381-398
- **Severity:** warn
- **Description:** The `main()` function calls `trainer.init()`, loads buffer/state, then starts the HTTP server and auto-starts self-play. If the C++ engine (port 8080) isn't running yet, `getGameState()` in the WebSocket connection handler fails silently, and `trainer.start()` → `_playGame` → `isEngineUp()` will fail. The `_loop` error handler has recovery logic (3 retries → stop), but there's no retry for the initial connection attempt.
- **Fix:** Add a startup health check with retry before starting self-play:
  ```js
  if (!await trainer.isEngineUp()) {
    console.warn('[Server] C++ engine not ready, waiting...');
    await trainer.waitForEngine(30, 2000);
  }
  ```

---

## BUG-014: WebSocket — stale client state in PvP race condition
- **Location:** server/index.js:232-261
- **Severity:** warn
- **Description:** In PvP mode, Player A sends a move. The server processes it, gets new state with new legal moves, and broadcasts to all clients. Player B might have already sent a move based on the OLD state (before receiving the broadcast). The move queue serializes per-socket, so the server processes B's move with the new state, but the `from`/`to` coordinates are based on B's stale view. The C++ engine will reject the move (400), and B gets an error. This is not a security issue but a UX issue — B sees their valid move rejected.
- **Fix:** Include a state version/hash in move requests. Server can reject moves based on stale state versions with a clear "state changed" error, prompting the client to refresh.

---

## BUG-015: `/api/board/set` — no auth, no 1D board support
- **Location:** engine/src/server.cpp:155-204
- **Severity:** warn
- **Description:** The C++ `/api/board/set` endpoint has no authentication. Any client can set arbitrary board positions, which could be used to cheat in PvAI mode or corrupt training data. Additionally, it only accepts 2D arrays (`board[row][col]`) while the JavaScript code sometimes works with flat 64-element arrays — a client sending a flat array gets a confusing error.
- **Fix:** Add auth token check (shared secret header) or restrict to admin-only via WebSocket. Accept both 1D and 2D board formats for consistency with the JS API.

---

## BUG-016: `train()` — Bellman target uses wrong model for opponent Q-values
- **Location:** server/ai/model.js:243-260
- **Severity:** critical
- **Description:** When computing Bellman targets, the code predicts `Q(nextState)` using the **same model** as the current player:
  ```js
  [, nextValues] = model.predictOnBatch(nextTensor);
  ```
  But `nextState` is from the **opponent's** perspective (turn is negated: `-s.turn`). In a two-player zero-sum game, you should evaluate the next state from the opponent's perspective using the **opponent's model**, not the current player's model. Using the same model for both sides means the Bellman update is computing `r + γ * (-Q_own(nextState))` instead of the correct `r + γ * (-Q_opponent(nextState))`. This biases training — especially when white and black models have diverged.
- **Fix:** In `train()`, determine which model to use for next-state Q-values based on `-s.turn`:
  ```js
  // Pass both models to train(), or accept a modelMap parameter
  const nextModel = (-s.turn === 1) ? whiteModel : blackModel;
  [, nextValues] = nextModel.predictOnBatch(nextTensor);
  ```
  This requires `train()` to accept a reference to the opponent model (or both models).

---

## BUG-017: `predict()` — softmax on masked policy may not find match
- **Location:** server/ai/model.js:175-195
- **Severity:** warn
- **Description:** After sampling `bestIdx` from the softmax distribution over `legalIndices`, the code searches `legalMoves` for a move whose `policyIndex` (or `index`) equals `bestIdx`. But `legalIndices` is built from `legalMoves.map(m => m.policyIndex ?? m.index ?? m)`, so `bestIdx` comes from this list. If two moves map to the same policy index, the `.find()` returns the first one. If a move doesn't have `policyIndex` or `index` (e.g., a raw object), `legalIndices` contains the object itself, and the comparison `idx === bestIdx` won't match after softmax sampling returns a number.
- **Fix:** Build a mapping from `bestIdx` back to the original move by index in the `legalMoves` array, not by property matching:
  ```js
  const idxToMove = legalMoves.map((m, i) => ({ idx: legalIndices[i], move: m }));
  const match = idxToMove.find(e => e.idx === bestIdx);
  const finalMove = match ? match.move : legalMoves[0];
  ```

---

## BUG-018: `saveModel` — non-atomic swap (rm then rename)
- **Location:** server/ai/model.js:284-291
- **Severity:** warn
- **Description:** `saveModel` does: save to tmp dir → rm target dir → rename tmp to target. Between `rm` and `rename`, the model directory doesn't exist. If a `loadModel` call or a server restart happens in that window, it fails. The window is tiny (sub-millisecond on local FS) but non-zero.
- **Fix:** Use a two-phase rename: rename target to `.old`, rename tmp to target, rm `.old`. Or on Linux, use `renameat2()` with `RENAME_EXCHANGE` flag for true atomic swap.

---

## Summary

| # | Severity | File | Description |
|---|----------|------|-------------|
| 001 | info | server/index.js:18,22 | Duplicate trust proxy setting |
| 002 | warn | trainer.js:122 | Missing AbortError/ECONNREFUSED handling |
| 003 | warn | server/index.js:52 | No legalMoves array validation |
| 004 | warn | trainer.js:125 | cppFetch doesn't check res.ok |
| 005 | **critical** | trainer.js:212 | Scalar index treated as array index → silent random fallback |
| 006 | warn | model.js:188 | Policy index collision loses capture info |
| 007 | warn | trainer.js:474 | Fallback moves lose policy target in training |
| 008 | warn | model.js:50 | Negative piece values silently accepted |
| 009 | info | trainer.js:71 | Confusing variable naming in calcThreat |
| 010 | info | trainer.js:302 | Duplicated game-over handling |
| 011 | info | server/index.js:350 | Auto-save dirty flag reset before save completes |
| 012 | info | server/index.js:37 | Rate limit map growth between cleanups |
| 013 | warn | server/index.js:381 | No startup retry if C++ engine is down |
| 014 | warn | server/index.js:232 | PvP stale-state race condition |
| 015 | warn | server.cpp:155 | /api/board/set has no auth |
| 016 | **critical** | model.js:243 | Bellman uses wrong model for opponent Q-values |
| 017 | warn | model.js:175 | Softmax sample may not match legalMoves |
| 018 | warn | model.js:284 | Non-atomic model save swap |

**Total: 18 issues (2 critical, 9 warn, 7 info)**
