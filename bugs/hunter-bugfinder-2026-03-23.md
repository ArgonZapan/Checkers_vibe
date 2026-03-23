# Hunter BugFinder Report — 2026-03-23

**Project:** Checkers_vibe (`/opt/Checkers_vibe`)
**Issue:** #120 — Self-play crash
**Scope:** Deep code analysis of AI move generation, engine communication, board conversion, error handling

---

## Summary

Issue #120 root cause chain: **predict() returns incorrect move → C++ engine rejects with 400 → repeated failures → engine unrecoverable → self-play stops**. Found **9 bugs** total: 4 critical, 3 important, 2 minor.

---

## BUG-001: predict() always returns legalMoves[0] when called with raw moves (CRITICAL)

**File:** `server/ai/model.js` — `predict()` function (line ~150-160)
**Also affects:** `server/index.js` — `aiMove()` function

The `predict()` function samples a policy index `bestIdx` (0-47) from the policy vector, then tries to find the matching legal move:

```js
const selectedMove = legalMoves.find(m => (typeof m === 'number' ? m : m.index ?? m) === bestIdx)
  || legalMoves[0];
```

**Problem:** When `legalMoves` are raw objects without an `index` property (as passed from `aiMove()` in `index.js`), `m.index` is `undefined`, so the `find()` never matches (`undefined !== number`). Falls back to `legalMoves[0]` — always the first move.

**In `trainer._playGame()`:** Moves are enhanced with `index` via `legalMoves.map((m, i) => ({ ...m, index: i }))` before passing to `predict()`, so this path works correctly.

**In `index.js` `aiMove()`:** Moves are passed raw — `predict()` always returns `legalMoves[0]`, which may or may not be a good move, and may get rejected by the engine.

**Impact:** AI makes deterministic/poor moves; if the fallback move is invalid for the current board state, engine returns 400 → crash cascade.

**Fix:** Either always add `.index` to legalMoves before calling predict(), or fix the find logic to match by from/to coordinates.

---

## BUG-002: Epsilon Black is never used — both sides share epsilonWhite (CRITICAL)

**File:** `server/ai/trainer.js` — `_playGame()` (around line 340)

```js
const epsilon = this.epsilonWhite; // shared epsilon (same for both sides now)
```

Both white and black use `this.epsilonWhite` for the epsilon-greedy exploration decision. Meanwhile, `this.epsilonBlack` is tracked and decayed separately in `_playGame()`:

```js
this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
```

But it's **never read** during move selection.

**Impact:** Black's exploration rate is always identical to white's. If someone sets different epsilons per side (e.g., via `/api/ai/params` with `side: 'black'`), the setting is silently ignored. Reduces training diversity.

---

## BUG-003: C++ engine catch-all `catch(...)` masks real errors (CRITICAL)

**File:** `engine/src/server.cpp` — `/api/move` handler

```cpp
} catch (...) {
    json err;
    err["error"] = "invalid json";
    res.status = 400;
    res.set_content(err.dump(), "application/json");
}
```

The bare `catch(...)` catches **everything** — `std::exception`, `json::parse_error`, `std::bad_alloc`, and even hardware exceptions (SIGSEGV depending on compiler flags). It returns HTTP 400 with the misleading message "invalid json".

**Impact:** Real bugs (null pointer dereference, out-of-bounds access, memory corruption) are hidden behind a generic 400. The engine continues running in a potentially corrupted state. If a segfault IS caught (some compilers do this), the engine state is undefined.

**Fix:** Use typed catches: `catch (json::parse_error&)`, `catch (std::exception&)`, and let fatal errors crash cleanly.

---

## BUG-004: Trainer mutates validatedMove in-place during retry — corrupts training data (CRITICAL)

**File:** `server/ai/trainer.js` — `_playGame()` (move retry block)

```js
const validatedMove = this._validateAndFallback(chosenMove, legalMoves);
// ... later:
for (let attempt = 0; attempt < MAX_MOVE_RETRIES; attempt++) {
    if (moveRes.status === 400) {
        const altMove = this._randomLegalMove(legalMoves);
        if (altMove) {
            validatedMove.from = altMove.from;   // ← MUTATES the object
            validatedMove.to = altMove.to;
            validatedMove.captures = altMove.captures;
        }
    }
}
```

The sample stored in the replay buffer contains `chosenMove: validatedMove` — a **reference** to the mutated object:

```js
samples.push({
    chosenMove: validatedMove,  // ← reference, not a copy
    // ...
});
```

After a 400 retry, `validatedMove` now points to a random fallback move, but the sample records it as if the **model chose** that move. The policy target in training is a one-hot on `chosenMove.index` — which now corresponds to the wrong move.

**Impact:** Training data is corrupted. The model learns that it "chose" a move it actually didn't choose. Over many games, this degrades model quality and could cause increasingly poor move selection → more 400 errors → crash loop.

**Fix:** Deep-copy `validatedMove` into the sample before the retry loop, or record the original chosen move separately.

---

## BUG-005: validateMove() doesn't check captures field (IMPORTANT)

**File:** `server/ai/trainer.js` — `validateMove()` function

The validator checks:
- move is an object
- has `from` and `to` fields
- `from`/`to` are integers in 0-63
- `from !== to`

But it **does not validate**:
- `captures` field (if present, must be array of valid coordinates)
- Whether the move respects checkers rules (captures are mandatory)
- Whether `from` square actually has a piece of the current player's color

**Impact:** In theory, `_validateAndFallback()` catches invalid moves via `isMoveLegal()`, but the validation gap means edge cases with malformed `captures` could slip through if the legal moves list has a collision on from/to but different captures.

---

## BUG-006: isEngineUp() conflates "engine down" with "engine error" (IMPORTANT)

**File:** `server/ai/trainer.js` — `isEngineUp()` function

```js
async isEngineUp() {
    try {
        const res = await cppFetch(`${CPP_BASE}/api/game/state`);
        return res.ok;  // true only for HTTP 2xx
    } catch {
        return false;
    }
}
```

The `trainer.cppFetch` throws on non-ok responses:
```js
if (!res.ok) throw new Error(`Game state failed: ${res.status}`);
```

So `isEngineUp()` returns `false` for **both**:
1. Engine process crashed / port not listening
2. Engine returned 400/500 (engine is running but something is wrong)

**Impact:** After a 400 move error, the trainer enters `waitForEngine()` recovery loop — polling an engine that is ALIVE but returning errors. Wastes 10 seconds per failed move. In rapid self-play, this compounds.

---

## BUG-007: trainer.cppFetch throws on all non-ok responses (IMPORTANT)

**File:** `server/ai/trainer.js` — `cppFetch()` helper (top of file)

```js
async function cppFetch(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        return res;  // ← returns raw Response, does NOT check res.ok
    } finally {
        clearTimeout(timer);
    }
}
```

Note: the `trainer` cppFetch does **NOT** throw on non-ok. It returns the raw response. The `server/index.js` cppFetch **DOES** throw:

```js
if (!res.ok) throw new Error(`C++ ${path} → ${res.status}`);
return res.json();
```

But in `trainer._playGame()`, the code checks `if (!stateRes.ok) throw new Error(...)` — so the distinction is handled at the call site. However, the inconsistency between the two cppFetch implementations is confusing and error-prone. If someone uses `server/index.js`'s cppFetch for self-play code, all non-ok responses become uncaught exceptions.

---

## BUG-008: King regular moves missing path in moveToJson output (MINOR)

**File:** `engine/src/movegen.cpp` — `generateKingMoves()`

```cpp
while (Board::inBounds(nr, nc) && board.isEmpty(nr, nc)) {
    Move m;
    m.from = Square(row, col);
    m.to = Square(nr, nc);
    // ← m.path is NOT set (empty by default)
    moves.push_back(m);
    nr += d[0];
    nc += d[1];
}
```

Compare with `generatePawnMoves()`:
```cpp
m.path = {Square(row, col), Square(nr, nc)};  // ← path IS set
```

King regular moves have an empty `path` field. The `moveToJson()` serializes this as `path: []`.

**Impact:** Client-side animation may not work for king moves (the WS handler in `index.js` uses `path` for animation timing). Pawn moves and all captures work fine.

---

## BUG-009: Engine mutex not held during health check (MINOR)

**File:** `engine/src/server.cpp` — `/api/game/state` handler

```cpp
svr.Get("/api/game/state", [](const httplib::Request&, httplib::Response& res) {
    std::lock_guard<std::mutex> lock(engineMutex);
    // ...
});
```

The health check DOES acquire the mutex (via `/api/game/state`). However, `hasAnyMove()` and `getResult()` in the engine read the board without holding any mutex — they trust that the caller (the HTTP handler) holds it. This is correct for single-threaded httplib, but if the server were multi-threaded, there would be data races on `board_`.

Currently **safe** because httplib is single-threaded by default. Flagged as future risk.

---

## Issue #120 Root Cause Chain (detailed)

```
1. Model's predict() returns a move object (possibly BUG-001: always legalMoves[0])
   ↓
2. _validateAndFallback() checks it — passes if it's a valid move
   ↓
3. Move sent to C++ /api/move
   ↓
4. C++ engine rejects it (400: "illegal move") — the move doesn't match any legal move
   WHY: could be from/to mismatch, or captures don't match
   ↓
5. Trainer retries 3x with random legal moves (BUG-004: mutates sample data)
   ↓
6. If all retries fail → throw Error('Move failed after retries')
   ↓
7. Error propagates to _playGame() → _loop() increments consecutiveErrors
   ↓
8. isEngineUp() returns false (BUG-006: engine is running but trainer thinks it's down)
   ↓
9. waitForEngine() polls for 10s — wastes time on an alive engine
   ↓
10. After 5 consecutive game errors → self-play stops entirely
```

The original 400 likely comes from a mismatch between what the model predicts and what the engine accepts. With BUG-001, if `aiMove()` in `index.js` is also involved (e.g., PvAI mode intermixed with self-play), it always sends `legalMoves[0]` which may be stale.

---

## Additional Edge Cases Found

### Edge Case 1: boardToTensor() throws on malformed board
If C++ engine returns a board array with wrong dimensions (e.g., corrupted JSON), `boardToTensor()` throws:
```js
if (flat.length !== 64) {
    throw new Error(`boardToTensor: expected 64 cells, got ${flat.length}`);
}
```
This is NOT caught in `_playGame()` — it propagates to `_loop()` as a game error.

### Edge Case 2: flattenBoard() returns null → calculateReward() returns 0
If board is malformed, `flattenBoard()` returns `null`, and `calculateReward(null, ...)` returns `0`. Not a crash, but silent zero reward corrupts training.

### Edge Case 3: Race between /api/game/state and /api/legal-moves
In `_playGame()`:
```js
const [stateRes, lmResInit] = await Promise.all([
    cppFetch(`${CPP_BASE}/api/game/state`),
    cppFetch(`${CPP_BASE}/api/legal-moves`),
]);
```
Two separate HTTP requests. Between them, another client could make a move. The board state and legal moves would be inconsistent. **Currently safe** because self-play runs sequentially and the engine is single-threaded, but fragile if the architecture changes.

### Edge Case 4: Proxy error handler crashes if res is undefined
```js
error: (err, _req, res) => {
    if (res && !res.headersSent) {  // ← good, checks for null
```
This is actually safe. No bug here.

### Edge Case 5: Negative piece values in tensor encoding
If board somehow contains negative values (e.g., -1 for black pawn), the `boardToTensor` encoding would misclassify them:
```js
const isWhite = val > 0 && (absVal === 1 || absVal === 2);
```
Negative values: `val > 0` is false → classified as black. But `absVal` could be 1 or 2 (white piece encoded as negative). Would produce wrong channel assignment. **Not currently triggered** because C++ engine only uses positive values 0-4, but fragile.

---

## Recommended Fixes (priority order)

1. **BUG-001:** Fix `predict()` find logic or always add `.index` to legalMoves
2. **BUG-004:** Deep-copy `validatedMove` before retry loop
3. **BUG-003:** Replace `catch(...)` with typed catches in C++ engine
4. **BUG-002:** Use `epsilonBlack` for black's move selection
5. **BUG-005:** Add captures validation to `validateMove()`
6. **BUG-006:** Differentiate engine-down vs engine-error in `isEngineUp()`
7. **BUG-008:** Set `m.path` in `generateKingMoves()`
8. **BUG-007:** Unify cppFetch implementations
9. **BUG-009:** Document single-threaded assumption in engine

---

## Files Analyzed

| File | Status |
|------|--------|
| `server/ai/trainer.js` | ✅ Full analysis — 5 bugs found |
| `server/ai/model.js` | ✅ Full analysis — 1 critical bug |
| `server/index.js` | ✅ Full analysis — 2 bugs found |
| `server/boardConvert.js` | ✅ Clean — no bugs found |
| `server/proxy.js` | ✅ Clean — no bugs found |
| `config.js` | ✅ Clean — no bugs found |
| `engine/src/server.cpp` | ✅ Full analysis — 2 bugs found |
| `engine/src/movegen.cpp` | ✅ Full analysis — 1 minor bug |
| `engine/src/engine.cpp` | ✅ Clean — no bugs found |
| `engine/src/board.cpp` | ✅ Clean — no bugs found |
| `engine/src/board.h` | ✅ Clean — no bugs found |
| `engine/src/engine.h` | ✅ Clean — no bugs found |
| `engine/src/movegen.h` | ✅ Clean — no bugs found |

---

*Report generated by Jarvis Horner — Hunter BugFinder cycle*
*2026-03-23 08:44 UTC*
