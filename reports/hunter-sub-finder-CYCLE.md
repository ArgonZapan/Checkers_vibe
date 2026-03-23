# Hunter Sub-Finder Report — Dynamic Bug Scan

**Project:** Checkers_vibe (`/opt/Checkers_vibe`)
**Scope:** Race conditions (WebSocket), auto-save logic, client state management, memory leaks, missing input validation
**Date:** 2026-03-23 09:46 UTC
**Previous reports avoided:** BUG-001 through BUG-006, BUG-101 through BUG-104, BUG-203, LEAK-001–015

---

## Summary

Found **6 NEW bugs**: 1 critical, 3 important, 2 minor. Focused on runtime interactions, timer logic, and state synchronization — areas not fully covered by prior static analysis passes.

---

## BUG-DYN-001: `trainer.dirty` not set after epsilon decay — epsilon values lost between trainings (CRITICAL)

**File:** `server/ai/trainer.js` — `_playGame()`, ~line 440
**Also:** `server/index.js` — auto-save interval, ~line 244

### The Bug

After each game, `_playGame()` decays epsilon:
```js
this.epsilonWhite = Math.max(CONFIG.ai.minEpsilon, this.epsilonWhite - CONFIG.ai.epsilonDecay);
this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
```

But `this.dirty` is NOT set to `true` here. The auto-save interval in `server/index.js` only saves state when `trainer.dirty` is true:

```js
setInterval(async () => {
  if (_saving) return;
  if (!trainer.dirty) return;  // ← skips save
  _saving = true;
  // ... saves state, resets trainer.dirty = false
}, CONFIG.server.autoSaveMs);
```

The `dirty` flag is only set when training actually executes (buffer >= 2048 samples). If the replay buffer has fewer than 2048 samples, training is skipped but epsilon still decays. On the next auto-save tick, `dirty` is false → entire save is skipped → epsilon decay is lost on crash.

**Scenario:** Buffer has 500 samples. 20 games complete, epsilon decays from 0.30 to 0.10. Server crashes. On restart, epsilon loads from saved state as 0.30 — the decay is undone. The model effectively "forgets" its exploration schedule.

### Severity: CRITICAL — silently corrupts training progress, hard to diagnose

### Proposed Fix

```js
// In _playGame(), after epsilon decay:
this.epsilonWhite = Math.max(CONFIG.ai.minEpsilon, this.epsilonWhite - CONFIG.ai.epsilonDecay);
this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
this.stats.epsilonWhite = this.epsilonWhite;
this.stats.epsilonBlack = this.epsilonBlack;
this.dirty = true;  // ← ADD THIS: epsilon changed, must persist
```

---

## BUG-DYN-002: Race condition in `setParams` — `_playGame` uses stale model/buffer after stop (IMPORTANT)

**File:** `server/index.js` — `setParams` handler, ~line 210
**Also:** `server/ai/trainer.js` — `_loop()` / `_playGame()`

### The Bug

The `setParams` WebSocket handler does:
1. `trainer.stop()` — sets `this.running = false`
2. Creates new models, clears buffer, resets stats
3. Optionally restarts self-play

But `trainer.stop()` only prevents the NEXT iteration of `_loop()`. If `_playGame()` is mid-execution (between move fetches or during training), it continues with old references. When `_playGame()` finishes:

```js
// At end of _playGame():
if (this.buffer.size() >= 2048) {
  const batch = this.buffer.sample(2048);    // ← buffer was cleared by setParams
  // batch is empty → training is skipped (no crash, but...
}

// Then:
this.stats.gamesPlayed++;  // ← stats were reset by setParams
await this.saveState();    // ← overwrites the clean reset state with stale data
```

The old `_playGame()` writes corrupted stats (stale `gamesPlayed`, epsilon values) over the fresh reset state.

### Severity: IMPORTANT — data corruption on rapid parameter changes during self-play

### Proposed Fix

Option A (quick): Add a generation counter. `setParams` increments it, `_playGame` checks it at the start and throws if it changed.

```js
// In SelfPlay constructor:
this._gameGeneration = 0;

// In setParams handler (server/index.js):
trainer._gameGeneration++;  // invalidate any in-flight _playGame

// In _playGame(), at the top:
const gen = this._gameGeneration;
// ... after each major step:
if (gen !== this._gameGeneration) return;  // abort stale game
```

Option B (robust): Make `_loop()` await a "drain" before allowing setParams.

---

## BUG-DYN-003: `handleToggleSelfplay` can flood server with rapid start/stop (IMPORTANT)

**File:** `client/src/App.jsx` — `handleToggleSelfplay`, ~line 200

### The Bug

```js
const handleToggleSelfplay = useCallback(() => {
  if (selfPlayActive) {
    socketRef.current?.emit('stopSelfPlay');
  } else {
    socketRef.current?.emit('startSelfPlay');
  }
}, [selfPlayActive]);
```

**Problem 1:** `selfPlayActive` is React state — it reflects the LAST received `selfPlayStatus` event, not the server's actual state. If the user clicks rapidly before the server acknowledges, multiple start/stop events fire. The server's `trainer.start()` is idempotent (checks `if (this.running) return`), and `stop()` just sets a flag, so no crash — but the emitted `selfPlayStatus` events can flicker, causing the UI button to toggle rapidly.

**Problem 2:** The `ParamsPanel` renders `onToggleSelfplay` as a direct click handler on a button with no debounce. A double-click sends both events near-simultaneously.

### Severity: IMPORTANT — UI glitch, potential server confusion with rapid state changes

### Proposed Fix

Add a pending state that disables the button until an acknowledgment is received:

```jsx
const [selfPlayPending, setSelfPlayPending] = useState(false);

const handleToggleSelfplay = useCallback(() => {
  if (selfPlayPending) return;  // ignore rapid clicks
  setSelfPlayPending(true);
  if (selfPlayActive) {
    socketRef.current?.emit('stopSelfPlay');
  } else {
    socketRef.current?.emit('startSelfPlay');
  }
}, [selfPlayActive, selfPlayPending]);

// Reset pending on server acknowledgment:
// In the selfPlayStatus handler:
s.on('selfPlayStatus', (data) => {
  setSelfPlayPending(false);
  // ... existing code
});
```

---

## BUG-DYN-004: Toast timer not properly managed — stale timeout can clear newer toast (MINOR)

**File:** `client/src/App.jsx` — server `error` handler, ~line 120; `showToast` helper, ~line 195

### The Bug

```js
// Server error handler:
s.on('error', (data) => {
  setToast(data?.message || 'Błąd serwera');
  setTimeout(() => setToast(null), 5000);  // ← unmanaged timer
});

// showToast helper:
const showToast = useCallback((msg, duration = 3000) => {
  setToast(msg);
  setTimeout(() => setToast(null), duration);  // ← unmanaged timer
}, []);
```

**Race scenario:**
1. Server error arrives → `setToast('Error A')`, timer T1 set for 5s
2. 1s later, `showToast('Success B')` is called → `setToast('Success B')`, timer T2 set for 3s
3. T2 fires at t=4s → `setToast(null)` → toast disappears (intended: Success B clears)
4. T1 fires at t=5s → `setToast(null)` → harmless (already null)

But reverse order:
1. `showToast('Success B')` → timer T2 for 3s
2. 1s later, server error → `setToast('Error A')`, timer T1 for 5s
3. T2 fires at t=3s → `setToast(null)` → **Error A toast is prematurely cleared** (should stay until t=6s)

### Severity: MINOR — visual glitch, toast disappears early

### Proposed Fix

Use a ref to track the timer ID and clear it before setting a new one:

```js
const toastTimerRef = useRef(null);

const setManagedToast = useCallback((msg, duration = 3000) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  setToast(msg);
  toastTimerRef.current = setTimeout(() => setToast(null), duration);
}, []);

// Replace raw setToast/setTimeout in error handler and showToast with setManagedToast
```

---

## BUG-DYN-005: WebSocket `setParams` validation mismatched with `createModel()` limits (MINOR)

**File:** `server/index.js` — `setParams` handler, ~line 210
**Also:** `server/ai/model.js` — `createModel()`, ~line 30

### The Bug

Server-side validation in `setParams` WebSocket handler:
```js
if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 8)) { ... }
if (newParams.neurons != null && (newParams.neurons < 32 || newParams.neurons > 1024)) { ... }
```

But `createModel()` clamps differently:
```js
if (numLayers < 1 || numLayers > 5) { ... }  // max 5, not 8
if (neurons < 32 || neurons > 512) { ... }    // max 512, not 1024
```

User sends `{ layers: 7, neurons: 800 }` via WebSocket → server accepts it → `createModel()` silently clamps to `{ layers: 5, neurons: 512 }`. UI shows "7 layers" but model has 5. Mismatch persists until next page reload or model params broadcast.

Additionally, the HTTP endpoint (`/api/ai/params`) only accepts `networkSize` string, not numeric params — so this inconsistency only affects WebSocket users, making it harder to diagnose.

### Severity: MINOR — misleading UI state, silent data loss

### Proposed Fix

Align the validation ranges:

```js
// In server/index.js setParams handler:
if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 5)) {  // match createModel
  errors.push(`layers=${newParams.layers} (zakres: 1-5)`);
}
if (newParams.neurons != null && (newParams.neurons < 32 || newParams.neurons > 512)) {  // match createModel
  errors.push(`neurons=${newParams.neurons} (zakres: 32-512)`);
}
```

---

## BUG-DYN-006: `boardFromCpp` can crash on malformed C++ board response (MINOR)

**File:** `server/boardConvert.js` — `boardFromCpp()`, ~line 14

### The Bug

```js
export function boardFromCpp(cppBoard) {
  let board2D = cppBoard;
  if (Array.isArray(cppBoard) && !Array.isArray(cppBoard[0])) {
    // flat → 2D conversion
  }
  return board2D.map(row => row.map(val => { ... }));
}
```

If the C++ engine returns an empty array `[]` or a malformed response like `[null]` or `[1, 2, 3]` (flat but with non-array first element), the function crashes:

- `[]` → `board2D.map(...)` returns `[]` — actually OK (empty board rendered)
- `[null]` → `Array.isArray(null)` = false → enters flat conversion → `null.slice(0, 8)` → **TypeError**
- `[1, 2, 3]` → `!Array.isArray(1)` = true → `1.slice(...)` → **TypeError**

This propagates through `getGameState()` → `handleMove()` → WebSocket error. If the C++ engine returns garbage during a crash, the error message isn't helpful.

### Severity: MINOR — crashes on malformed engine responses, poor error reporting

### Proposed Fix

```js
export function boardFromCpp(cppBoard) {
  if (!Array.isArray(cppBoard) || cppBoard.length === 0) {
    throw new Error('boardFromCpp: expected non-empty array');
  }
  let board2D = cppBoard;
  if (!Array.isArray(cppBoard[0])) {
    // Flat array — must be exactly 64 elements
    if (cppBoard.length !== 64) {
      throw new Error(`boardFromCpp: flat array must have 64 elements, got ${cppBoard.length}`);
    }
    board2D = [];
    for (let r = 0; r < 8; r++) {
      board2D.push(cppBoard.slice(r * 8, r * 8 + 8));
    }
  }
  if (board2D.length !== 8 || board2D.some(row => !Array.isArray(row) || row.length !== 8)) {
    throw new Error('boardFromCpp: expected 8x8 array');
  }
  return board2D.map(row => row.map(val => {
    if (val === 0) return null;
    const isWhite = val === 1 || val === 2;
    const isKing = val === 2 || val === 4;
    return { color: isWhite ? 'white' : 'black', king: isKing };
  }));
}
```

---

## Negative Findings (no bugs found in these areas)

### Race conditions in move handling
- `socket._moveQueue` serializes moves per-socket — prevents concurrent move races ✅
- Move validation (from/to coordinates 0-7) is present and correct ✅
- `isValidCoord` checks type, length, integer, and range ✅

### Auto-save timer mechanics
- `_saving` flag prevents concurrent saves ✅
- Atomic file writes (tmp → rename) prevent corruption ✅
- Buffer/model save time gates work correctly (checked every 30s, only save when enough time elapsed) ✅

### Client state management
- Ref-based sync pattern (`boardRef`, `turnRef`, etc.) avoids stale closures in callbacks ✅
- React 18 automatic batching prevents excessive re-renders from multiple setState calls ✅
- Socket disconnect cleanup handles all listeners (Socket.IO auto-removes on disconnect) ✅

### Memory leaks
- Board.jsx RAF animation is properly cancelled on unmount via cleanup return ✅
- Multi-capture timers stored in `timersRef` and cleared on effect cleanup ✅
- GameTimer clearInterval on unmount ✅
- ParamsPanel debounce timers cleared on unmount via useEffect cleanup ✅
- No setInterval leaks — auto-save interval runs for server lifetime (expected) ✅

### Input validation
- Move coordinates validated before handler execution ✅
- `setSpeed` validates type, range (0-10000), and NaN ✅
- `setSpeedMode` only accepts 'fast' or 'normal' ✅
- HTTP `/api/ai/params` validates epsilon (0-1) and networkSize (enum) ✅
- `predict` endpoint validates board + legalMoves presence ✅
- `train` endpoint validates non-empty batch ✅

---

## Prioritized Recommendations

| Bug | Severity | Fix Effort | Impact |
|-----|----------|-----------|--------|
| DYN-001: dirty flag missing after epsilon decay | CRITICAL | 1 line | Prevents data loss |
| DYN-002: setParams race with _playGame | IMPORTANT | Medium | Prevents corruption |
| DYN-003: toggleSelfplay flooding | IMPORTANT | Small | UI stability |
| DYN-004: toast timer race | MINOR | Small | UX polish |
| DYN-005: validation range mismatch | MINOR | 2 lines | Consistency |
| DYN-006: boardFromCpp crash on malformed input | MINOR | Small | Robustness |
