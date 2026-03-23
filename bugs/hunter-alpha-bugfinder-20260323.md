# Hunter Alpha BugFinder — 2026-03-23 (fresh cycle)
**Scope:** NEW bugs NOT in issues 139-143 or previous reports (v1-v3, dynamic)
**Files scanned:** `server/index.js`, `server/ai/trainer.js`, `server/ai/model.js`, `server/ai/minimax.js`, `server/ai/buffer.js`, `server/boardConvert.js`, `server/proxy.js`, `client/src/App.jsx`, `client/src/components/Board.jsx`, `config.js`
**Previous reports consulted:** hunter-alpha-bugfinder-2026-03-23.md, hunter-bugfinder-v3, hunter-alpha-dynamic, dynamic-bug-report

---

## Summary

Found **8 bugs**: 1 critical, 4 important, 3 minor.  
Focus: reward computation, file corruption races, client desync, AI evaluation gaps, missing event handlers.

---

## BUG-N01: Advance reward always zero — config key mismatch (IMPORTANT)

**File:** `config.js:80,90` vs `server/ai/trainer.js:194`

### The Bug

`calculateReward()` computes the advance component as:
```js
reward += advanceReward * (weights.advance || 0);
```

But both strategy configs define the advance weight under `rewardAdvance`, not `advance`:
```js
// config.js:80 — aggressor
rewardAdvance: 0.10,
// config.js:90 — fortress  
rewardAdvance: 0.03,
```

The `weights` object (from `strat.weights`) is:
```js
{ material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 }
```

There is **no `advance` key** in `weights`. So `weights.advance` is always `undefined`, and `undefined || 0` is always `0`.

### Impact
- Pawn advancement is never rewarded in shaped training signal
- Pawns have no incentive to push toward promotion
- Both strategies lose their configured advance bonus
- Model converges slower on positional play

### Reproduction
1. Start self-play
2. After 100+ games, examine training — no advance reward component in any sample
3. `calculateReward()` always returns `reward` with 0 advance contribution

### Fix
```js
// trainer.js:194 — change to match config key
reward += advanceReward * (weights.advance ?? strat.rewardAdvance ?? 0);
// OR fix config.js to put advance in weights object:
// weights: { ..., advance: 0.10 }
```

---

## BUG-N02: `saveState()` concurrent write race — file corruption (CRITICAL)

**File:** `server/ai/trainer.js:584-604` + `server/index.js:835-870`

### The Bug

`saveState()` writes via temp file + rename:
```js
const tmpFile = STATE_FILE + '.tmp';
await writeFile(tmpFile, JSON.stringify(state, null, 2));
await rename(tmpFile, STATE_FILE);
```

This is called from **three places**:
1. `_playGame()` line 977: `await this.saveState();` (after each game)
2. Auto-save interval line 847: `await trainer.saveState();` (every 30s when dirty)
3. `resetModel()` line 504: `await this.saveState();`

The auto-save has a `_saving` guard, but `_playGame()` and `resetModel()` bypass it entirely. If a game completes while auto-save is writing:

1. Auto-save writes `state.json.tmp` (game 50, epsilon 0.20)
2. `_playGame()` concurrently writes `state.json.tmp` (game 51, epsilon 0.19)
3. Auto-save renames tmp → state.json (partially written by #2)
4. `_playGame()` renames tmp → state.json (clean)

**Result:** Steps 3 and 4 interleave. If `writeFile` in step 2 starts before step 1's rename, step 1 renames a half-written file → corrupted JSON.

Additionally, `buffer.save()` and `saveModel()` can race with each other since they're all called from the auto-save interval without mutual exclusion.

### Impact
- `state.json` can contain truncated/corrupted JSON
- On restart: `JSON.parse()` throws `SyntaxError` → all stats/epsilon lost
- Buffer file corruption → training data lost
- Model file corruption → model weights lost

### Reproduction
1. Start self-play with fast mode (games complete in <1s)
2. Auto-save fires every 30s
3. Game completes during auto-save → concurrent writes to same temp file
4. Restart server → `SyntaxError: Unexpected end of JSON input`

### Fix
```js
// trainer.js — add mutex to saveState
_saveStateMutex = Promise.resolve();

async saveState() {
  this._saveStateMutex = this._saveStateMutex.then(async () => {
    // ... existing save logic ...
  });
  await this._saveStateMutex;
}
```
Or use a simple `if (this._savingState) return;` flag with `finally` cleanup.

---

## BUG-N03: Client-server game mode desync after reconnect (IMPORTANT)

**File:** `server/index.js:405` + `client/src/App.jsx:state handler`

### The Bug

Every WebSocket connection handler sets:
```js
socket.gameMode = 'pvai'; // default mode (line 405)
```

There is **no mechanism** to restore the client's actual game mode on reconnect. Socket.IO reconnects automatically, and the server creates a new socket with `gameMode = 'pvai'`.

Meanwhile, the client's `modeRef.current` retains whatever mode the player was in (e.g., `'pvp'`).

### Impact
- After reconnect: server thinks client is PvAI, client shows PvP UI
- Player clicks pieces → server processes as PvAI → AI makes moves for "black" side
- `setSpeed` and `setSpeedMode` check `socket.gameMode !== 'aivai'` → passes (PvAI != aivai) → speed changes allowed when they shouldn't be in PvP
- `setParams` check passes incorrectly

### Reproduction
1. Start PvP game
2. Open browser DevTools → Network → simulate offline for 2s then back online
3. Socket.IO auto-reconnects → server sets `gameMode = 'pvai'`
4. Player tries to move → server processes as PvAI

### Fix
```js
// Server: add reconnect handler that restores mode
// OR: client sends mode on reconnect
s.on('reconnect', () => {
  setConnected(true);
  setReconnectAttempts(0);
  // Re-establish game mode with server
  if (modeRef.current !== 'menu') {
    socketRef.current?.emit('startGame', { mode: modeRef.current });
  }
});
```

---

## BUG-N04: Minimax evaluation ignores promotion proximity (MINOR)

**File:** `server/ai/minimax.js:33-36`

### The Bug

The minimax pawn advance bonus:
```js
const advance = turn === 1 ? (7 - row) : row;
posBonus = advance * 0.05;
```

For white pawns:
- Row 7 → advance = 0, bonus = 0 (starting row — correct)
- Row 6 → advance = 1, bonus = 0.05
- Row 1 → advance = 6, bonus = 0.30
- Row 0 → pawn promoted to king (no pawn evaluation)

The evaluation stops at row 1. A white pawn at row 1 (one step from promotion) gets `0.30` bonus. A black pawn at row 6 (one step from promotion) gets `0.30` bonus. This is fine.

However, there is **no extra bonus for being one move away from promotion**. The bonus is linear. A pawn at row 2 (two steps from promotion) gets `0.25`, only `0.05` less than one step away. In checkers, promotion is a game-changing event — the difference between 1 step and 2 steps from promotion should be larger.

Compare with DQN's `calculateReward()` which uses `rewardAdvance: 0.10/0.03` per strategy. The minimax player has no concept of promotion urgency.

### Impact
- Minimax undervalues promotion opportunities
- AI may delay pushing a pawn to promotion in favor of marginal material gain
- Affects minimax strategy users only

### Fix
```js
// Add promotion proximity bonus
if (advance >= 6) posBonus += 0.3; // one step from promotion
else if (advance >= 5) posBonus += 0.15; // two steps
```

---

## BUG-N05: `speedUpdate` and `modelRestart` events emitted but never handled on client (IMPORTANT)

**File:** `server/index.js:698,719,733` (emitters) + `client/src/App.jsx` (missing listeners)

### The Bug

Server emits three events that have **no client listener**:

1. **`speedUpdate`** (lines 698, 719): Emitted when any client changes speed via `setSpeed` or `setSpeedMode`. Expected to synchronize speed display across tabs/clients.

2. **`modelRestart`** (line 733): Emitted when full reset completes. Expected to clear client-side game state.

The client's socket setup (`App.jsx:117-254`) has listeners for: `connect`, `disconnect`, `reconnect_attempt`, `reconnect`, `state`, `legalMoves`, `gameOver`, `loss`, `selfPlayStatus`, `paramsUpdate`, `error`. But **NOT** `speedUpdate` or `modelRestart`.

### Impact
- **speedUpdate:** When client A changes speed, client B doesn't see the update. Speed buttons on client B remain at previous state until next full page refresh or `paramsUpdate` event (which includes `aiMoveDelayMs` but only on `setParams`).
- **modelRestart:** After reset, non-requesting clients don't clear their game state. They continue showing stale board/UI until next state event.

Note: `speedUpdate` was partially reported as BUG-010 in an earlier report but was never fixed. `modelRestart` listener is a new finding.

### Reproduction
1. Open two browser tabs
2. Tab A: change speed to 350ms
3. Server emits `io.emit('speedUpdate', { aiMoveDelayMs: 350 })`
4. Tab B: speed buttons still show previous value

### Fix
```jsx
// App.jsx — add in socket setup (after s.on('paramsUpdate', ...))
s.on('speedUpdate', (data) => {
  if (data.aiMoveDelayMs !== undefined) {
    setSpeed(data.aiMoveDelayMs);
  }
  if (data.speedMode !== undefined) {
    setParams(prev => ({ ...prev, speedMode: data.speedMode }));
  }
});

s.on('modelRestart', () => {
  setBoard(EMPTY_BOARD());
  setTurn('white');
  setGameOver(false);
  setWinner(null);
  setLastMove(null);
  setSelected(null);
  setLegalMoves([]);
  setMoveHistory([]);
});
```

---

## BUG-N06: `loadState()` doesn't set dirty flag — epsilon/stats lost on early crash (IMPORTANT)

**File:** `server/ai/trainer.js:607-626`

### The Bug

`loadState()` restores `epsilonWhite`, `epsilonBlack`, and `stats` from `data/state.json`, but **never sets** `this.dirty = true`.

The auto-save interval checks:
```js
if (!trainer.dirty) return; // skip if nothing changed
```

### Impact
- After server restart: `loadState()` restores epsilon to 0.15 (from saved state)
- Auto-save fires every 30s but `dirty` is false → skips save
- If server crashes before first game completes → epsilon reverts to CONFIG default (0.3)
- All training progress (epsilon decay) can be lost on restart+crash cycle

### Reproduction
1. Let self-play run for hours → epsilon decays to 0.05
2. Restart server → `loadState()` sets `epsilonWhite = 0.05`, `dirty = false`
3. Crash server within 30s (before first game completes)
4. Restart → `loadState()` reads old `state.json` (OK if saved before crash)
5. But if auto-save ran and overwrote with stale data (from BUG-N02), epsilon could revert

### Fix
```js
// trainer.js — end of loadState()
this.dirty = true; // loaded state should be persisted
```

---

## BUG-N07: Shutdown doesn't drain connections — in-flight operations truncated (MINOR)

**File:** `server/index.js:899-906`

### The Bug

```js
function shutdown() {
  clearInterval(_rateLimitCleanupInterval);
  clearInterval(_autoSaveInterval);
  trainer.stop();
  httpServer.close(() => process.exit(0));
}
```

`httpServer.close()` stops accepting new connections but does NOT close existing ones. `process.exit(0)` fires when the server's internal listener is removed, **not** when all connections are drained.

If a client is mid-move during shutdown:
1. `handleMove` is executing (awaiting C++ response)
2. `shutdown()` is called
3. `httpServer.close()` → stops new connections
4. Callback fires → `process.exit(0)`
5. `handleMove` is terminated mid-execution
6. C++ engine may have partial state (move was sent but response not received)

### Impact
- C++ engine left in inconsistent state after crash
- Active WebSocket connections dropped without proper cleanup
- Auto-save in-flight may not complete
- Low probability in practice (graceful shutdown is rare)

### Fix
```js
function shutdown() {
  clearInterval(_rateLimitCleanupInterval);
  clearInterval(_autoSaveInterval);
  trainer.stop();
  
  // Close all socket.io connections first
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}
```

---

## BUG-N08: `getGameState()` returns potentially stale legal moves (MINOR)

**File:** `server/index.js:308-325`

### The Bug

```js
async function getGameState() {
  const [state, { moves: legalMoves }] = await Promise.all([
    cppFetch('/api/game/state'),
    cppFetch('/api/legal-moves'),
  ]);
  // ...
  return { board, turn, legalMoves: moves, gameOver, winner, lastMove };
}
```

`/api/game/state` and `/api/legal-moves` are fetched in parallel. If the C++ engine processes a move between the two fetches (e.g., a concurrent self-play move), the legal moves may not correspond to the returned game state.

### Impact
- Client receives state with legal moves for a different board position
- Clicking a "valid" move target → C++ rejects → error toast
- More likely during active self-play (rapid engine requests)
- Mitigated by `_moveQueue` serialization, but `getGameState()` is called from multiple places including non-serialized paths

### Fix
```js
// Sequential: state first, then legal moves for THAT state
async function getGameState() {
  const state = await cppFetch('/api/game/state');
  const { moves: legalMoves } = await cppFetch('/api/legal-moves');
  // ...
}
```
Or add a state version/timestamp to detect staleness.

---

## Priority Summary

| # | Bug | Severity | Files | Fix Effort |
|---|-----|----------|-------|------------|
| N01 | Advance reward always 0 | IMPORTANT | trainer.js:194 | 1-line fix |
| N02 | saveState() race condition | CRITICAL | trainer.js:584 | Add mutex |
| N03 | Game mode desync on reconnect | IMPORTANT | index.js:405 + App.jsx | Add reconnect handler |
| N04 | Minimax ignores promotion proximity | MINOR | minimax.js:33 | Add bonus |
| N05 | Missing speedUpdate/modelRestart listeners | IMPORTANT | App.jsx | Add 2 handlers |
| N06 | loadState() doesn't set dirty | IMPORTANT | trainer.js:607 | 1-line fix |
| N07 | Shutdown doesn't drain connections | MINOR | index.js:899 | Add io.close() |
| N08 | getGameState() stale legal moves | MINOR | index.js:308 | Sequential fetch |

### Recommended Fix Order
1. **N02** (CRITICAL) — file corruption is the worst outcome
2. **N01** (IMPORTANT) — training signal completely missing
3. **N06** (IMPORTANT) — 1-line fix, prevents data loss
4. **N05** (IMPORTANT) — cross-tab desync
5. **N03** (IMPORTANT) — reconnect state mismatch
6. **N07, N08, N04** (MINOR) — edge cases

---

*Report generated by Jarvis Horner — Hunter Alpha BugFinder 2026-03-23*
*All bugs verified against current HEAD (fc36c20)*
