# Hunter Alpha BugFinder — 2026-03-23 (fresh cycle)
**Scope:** `server/index.js`, `server/ai/trainer.js`, `server/ai/model.js`, `server/ai/minimax.js`, `server/ai/buffer.js`, `server/boardConvert.js`, `server/proxy.js`, `client/src/App.jsx`, `client/src/components/Board.jsx`, `config.js`
**Previous reports consulted:** hunter-alpha-bugfinder-20260323.md (8 bugs N01-N08), hunter-dynamic-bugfinder-report-v2.md (D06-D12), __bugs_found_hunter_002.md
**Tester:** Jarvis Horner (hunter-sub-bugfinder)

---

## Summary

Thorough re-scan of all source files. Previous cycle (N01-N08) found 8 bugs — 3 fixed in ec47600 (N01, N05, N06), 1 fixed in c9b0494 (N04). Remaining 4 unfixed: N02 (CRITICAL), N07, N08, N04(partial). This cycle fixed 2 of those.

**Fixed this cycle:** N02 (saveState race), N07 (shutdown drain)
**Remaining unfixed:** N04 (minimax promotion proximity — minor design choice), N08 (parallel fetch — safe in single-threaded context)

---

## FIXED

### BUG-01: `saveState()` concurrent write race — file corruption (CRITICAL, was N02)

**File:** `server/ai/trainer.js:585-605`
**Status:** FIXED

**The Bug:** `saveState()` is called from three places: `_playGame()` (after each game), auto-save interval (every 30s), and `resetModel()`. The auto-save has a `_saving` guard, but the other two bypass it. If `_playGame()` writes state.json.tmp while auto-save is renaming the same tmp file → corrupted JSON.

**Fix Applied:** Added a promise-based mutex (`_saveStateLock`) to serialize all concurrent `saveState()` calls. The lock chains promises so each caller waits for the previous save to complete before starting.

```javascript
// Before: no synchronization
async saveState() { /* writes tmp + rename */ }

// After: promise mutex
async saveState() {
  const prev = this._saveStateLock || Promise.resolve();
  let unlock;
  this._saveStateLock = new Promise(r => { unlock = r; });
  await prev;
  try { /* writes tmp + rename */ }
  finally { unlock(); }
}
```

---

### BUG-02: Shutdown doesn't drain WebSocket connections (was N07)

**File:** `server/index.js:899-906`
**Status:** FIXED

**The Bug:** `shutdown()` calls `httpServer.close()` then `process.exit(0)` in the callback. But `httpServer.close()` only stops accepting new connections — existing WebSocket connections are dropped without cleanup. In-flight `handleMove` operations are truncated, potentially leaving C++ engine in inconsistent state.

**Fix Applied:** Added `io.close()` before `httpServer.close()` to properly close WebSocket connections. Added 5s force-exit timeout to prevent hanging if connections don't drain cleanly.

```javascript
// Before
function shutdown() {
  clearInterval(_rateLimitCleanupInterval);
  clearInterval(_autoSaveInterval);
  trainer.stop();
  httpServer.close(() => process.exit(0));
}

// After
function shutdown() {
  clearInterval(_rateLimitCleanupInterval);
  clearInterval(_autoSaveInterval);
  trainer.stop();
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000);
}
```

---

## Previously Fixed (verified in current code)

| Bug | Description | Fixed in |
|-----|-------------|----------|
| N01 | Advance reward always 0 — config key mismatch | ec47600 |
| N05 | Missing speedUpdate/modelRestart client listeners | ec47600 |
| N06 | loadState() doesn't set dirty flag | ec47600 |
| N04 | Minimax evaluate ignores pawn advance bonus | c9b0494 |
| D06 | validateMove/isMoveLegal ignores captures | Current code |
| D08 | /api/ai/predict legalMoves not validated | Current code |
| D09 | /api/ai/train board elements not validated | Current code |
| D10 | predict() returns number on empty legalMoves | Current code |
| D11 | startGame race with self-play | Current code (paramsVersion++) |

---

## Remaining (minor / acceptable)

### N04-remnant: Minimax evaluation — linear advance bonus

**File:** `server/ai/minimax.js:33-36`
**Severity:** minor (design choice)

The minimax pawn advance bonus is linear (`advance * 0.05`). No extra urgency for pawns one step from promotion. The DQN strategies handle this via `rewardAdvance` config. For minimax, this is acceptable — the depth-limited search naturally discovers promotion opportunities through lookahead.

### N08: `getGameState()` parallel fetches

**File:** `server/index.js:308-325`
**Severity:** minor (safe in context)

`/api/game/state` and `/api/legal-moves` fetched in parallel via `Promise.all`. In a single-threaded Node.js + single-threaded C++ engine, the engine can't change state between the two fetches within one `getGameState()` call. The parallel approach saves ~1 request latency. Not fixing.

---

## New Observations (not bugs, but worth noting)

### OBS-01: `boardToTensor` doesn't handle negative piece encoding

**File:** `server/ai/model.js:69-85`

If the C++ engine ever sends black pieces as negative values (-1, -2 instead of 3, 4), `boardToTensor` would misclassify them as white (because `val > 0` check fails, but `absVal` matches). Currently not triggered — C++ uses positive encoding (0-4). Could become a bug if encoding changes.

### OBS-02: Loss chart redraws on every training step

**File:** `client/src/components/Dashboard.jsx:86-88`

`drawLossChart()` is called in a `useEffect` that depends on `lossHistory`. During active self-play, this triggers a canvas redraw on every training event. With 1000-point history, `Math.max(...data)` and `Math.min(...data)` iterate the full array each time. Minor performance concern at high training frequency.

### OBS-03: "Custom" network size option is cosmetic

**File:** `client/src/components/ParamsPanel.jsx`

The network size dropdown includes "custom" as an option, but it has no server-side effect — `networkSize` is stored but model architecture is controlled by `modelParams` (layers, neurons). The "custom" option just lets the user change sliders while showing a label.

---

## Code Quality Assessment

Overall the codebase is well-fortified after multiple Hunter cycles:
- Input validation on all WebSocket handlers and API endpoints ✅
- Tensor disposal in all TensorFlow.js paths ✅
- Rate limiting with memory cap and cleanup ✅
- Security headers (CSP, X-Frame-Options, etc.) ✅
- Atomic file writes (tmp + rename) for state/buffer/model ✅
- Race condition guards (paramsVersion, _saving, _moveQueue) ✅
- Error recovery (engine health checks, retry logic) ✅

The remaining items are minor design choices rather than exploitable bugs.

---

*Report generated by Jarvis Horner — Hunter Alpha BugFinder 2026-03-23*
*Based on HEAD b4fe51b + fixes applied in this cycle*
