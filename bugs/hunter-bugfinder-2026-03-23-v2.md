# Hunter BugFinder Report v2 — 2026-03-23

**Project:** Checkers_vibe (`/opt/Checkers_vibe`)
**Scope:** Deep code audit — NEW bugs NOT in issues #120, #123, #124, #125, #126 or previous hunter-bugfinder report

---

## Summary

Found **4 NEW bugs**: 2 critical, 1 important, 1 minor. The previous report covered epsilonBlack (#126), catch(...) (#125), validatedMove mutation (#124), isEngineUp confusion, etc. This report focuses on different code paths and interactions.

---

## BUG-101: predict() policy indices don't match legalMoves array indices — model training is broken (CRITICAL)

**File:** `server/ai/model.js` — `predict()` function, ~line 160
**Also affects:** `server/ai/trainer.js` — `_playGame()` training target assignment

### The Bug

The neural network policy head outputs 48 logits representing a **fixed canonical move encoding** (e.g., index 0 = "pawn at (0,1) moves to (1,0)"). But the code treats these 48 values as indices into the `legalMoves` array:

```js
// predict() — legalIndices comes from m.index = position in legalMoves array
const legalIndices = legalMoves.map(m => m.index ?? m);
// bestIdx is sampled from legalIndices (e.g., 0-14 for a game with 15 moves)
let bestIdx = legalIndices[0];
// ...
const selectedMove = legalMoves.find(m => (m.index ?? m) === bestIdx)
```

The masking step normalizes over `legalIndices` — these are **array positions** (0, 1, 2, ..., 14). But the 48 network outputs represent **canonical move encodings** (0-47). Index 3 in the array might correspond to canonical encoding 27. The masking reads `policy[3]` (canonical encoding 3's logit) when it should read `policy[27]`.

### Training is also broken

The training target sets one-hot at array position:
```js
const moveIdx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index ?? chosenMove;
policyTarget[moveIdx] = 1;  // e.g., position 7 in array → policyTarget[7] = 1
```

The network learns "canonical move 7 is good" but canonical move 7 might be "pawn at (3,4) moves to (4,3)" — a completely different move than what was actually chosen. Each game has different legal moves, so the learned mapping is meaningless.

### Impact
- Policy head provides no useful signal — model never improves
- Value head might still learn from shaped rewards (board state → value)
- AI behavior degrades over time as corrupted policy gradients interfere with value learning
- Self-play runs forever without meaningful improvement

### Reproduction
1. Start self-play in AI vs AI mode
2. Let it run for 100+ games
3. Observe: loss doesn't converge, win rates stay ~50/50, model doesn't learn tactics

### Fix
Map legal moves to their canonical policy indices before masking:
```js
// In predict():
const legalPolicyIndices = legalMoves.map(m => m.policyIndex); // canonical encoding
// Use legalPolicyIndices for masking, not array positions
```
Or restructure the network to output per-legal-move scores instead of fixed 48-policy encoding.

---

## BUG-102: `train` not imported in server/index.js — `/api/ai/train` endpoint throws ReferenceError (CRITICAL)

**File:** `server/index.js` — imports section (~line 5) + `/api/ai/train` handler (~line 72)

### The Bug

```js
import { predict, createModel } from './ai/model.js';
import { saveModel, loadModel } from './ai/model.js';
// ← train is NOT imported anywhere
```

But the endpoint uses it:

```js
app.post('/api/ai/train', async (req, res) => {
  try {
    const batch = req.body.batch || [];
    if (batch.length === 0) return res.status(400).json({ error: 'Empty batch' });
    const lossWhite = await train(trainer.modelWhite, batch, CONFIG.ai.trainEpochs);
    // ReferenceError: train is not defined
  } catch (err) {
    console.error('[AI] Train error:', err);  // logs ReferenceError as "Train error"
    res.status(500).json({ error: err.message });
  }
});
```

`train` is exported from `server/ai/model.js` but never imported in `server/index.js`. The `ReferenceError` is caught by the try/catch and returned as a generic 500 error with message "train is not defined".

### Impact
- HTTP POST `/api/ai/train` always returns 500
- The catch block misleadingly logs "[AI] Train error" when it's actually a missing import
- Any external integration or test hitting this endpoint fails
- The error message leaks implementation detail ("train is not defined")

### Reproduction
```bash
curl -X POST http://localhost:3000/api/ai/train \
  -H 'Content-Type: application/json' \
  -d '{"batch":[{"board":[0,1,0,...],"legalMoves":[{"from":[2,1],"to":[3,0],"index":0}],"chosenMove":{"from":[2,1],"to":[3,0],"index":0},"turn":1,"result":1}]}'
```
Expected: trained model, returns loss
Actual: 500 Internal Server Error

### Fix
```js
import { predict, createModel, train } from './ai/model.js';
```

---

## BUG-103: Client emits `'params'` but server listens for `'setParams'` — epsilon/network sliders do nothing (IMPORTANT)

**File:** `client/src/App.jsx` — `handleParamsChange` callback
**File:** `server/index.js` — WebSocket event handlers

### The Bug

Client sends param changes from sliders via `'params'` event:
```js
// App.jsx
const handleParamsChange = useCallback((newParams) => {
    setParams((prev) => ({ ...prev, ...newParams }));
    socketRef.current?.emit('params', newParams);  // ← emits 'params'
}, []);
```

Server only has a handler for `'setParams'`:
```js
// server/index.js — in io.on('connection', ...)
socket.on('setParams', async (newParams) => {  // ← listens for 'setParams'
    // ...
});
// No handler for 'params' exists anywhere
```

The only working path is the "Zastosuj zmiany" button which emits `'setParams'`:
```js
const handleApplyModelParams = useCallback(() => {
    socketRef.current?.emit('setParams', { ...modelParams });
}, [modelParams, showToast]);
```

### What's broken
- Epsilon sliders (white/black): change visual display only, never reach server
- Network size dropdowns: change visual display only, never reach server
- After page refresh, client shows stale values (server is source of truth)

### Impact
- Users think they're adjusting parameters but nothing actually changes
- Confusing UX — sliders move, values update, but AI behavior doesn't change
- Only the "Zastosuj zmiany" button works (which also resets the model)

### Reproduction
1. Open app, go to AI vs AI mode
2. Drag the epsilon slider from 0.30 to 0.80
3. Observe: client shows 0.80, but server still uses 0.30
4. Start self-play — exploration rate is still 0.30

### Fix
Either:
1. Change client to emit `'setParams'` instead of `'params'`, OR
2. Add a server handler for `'params'` that updates epsilon/network without resetting the model

---

## BUG-104: `setSpeed` handler clamps to 10000 but validation allows 60000 — misleading max value (MINOR)

**File:** `server/index.js` — `'setSpeed'` WebSocket handler

### The Bug

```js
socket.on('setSpeed', (ms) => {
    // Validate: must be a number 0-60000, not NaN
    if (typeof ms !== 'number' || ms < 0 || ms > 60000 || Number.isNaN(ms)) {
      socket.emit('error', { message: 'Invalid speed value' });
      return;
    }
    const clamped = Math.max(0, Math.min(ms, 10000));  // ← clamps to 10000!
    CONFIG.server.aiMoveDelayMs = clamped;
    // ...
});
```

Validation accepts 0-60000, but then clamps to 0-10000. A user sending `ms=30000` passes validation silently and gets clamped to 10000 with no feedback. The max valid value (60000) is 6x the actual effective max (10000).

### Impact
- Silent data loss for values > 10000
- Inconsistent API — validation says "up to 60000" but effective max is 10000
- No warning or error when clamping occurs

### Reproduction
```js
socket.emit('setSpeed', 30000);  // passes validation, silently clamped to 10000
```

### Fix
Align validation range with clamping range:
```js
if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
```
Or emit a warning when clamping occurs.

---

## Files Analyzed (v2)

| File | Bugs Found |
|------|-----------|
| `server/ai/model.js` — predict() | BUG-101 (CRITICAL) |
| `server/index.js` — imports + endpoints | BUG-102 (CRITICAL) |
| `server/index.js` — WebSocket handlers | BUG-103 (IMPORTANT), BUG-104 (MINOR) |
| `client/src/App.jsx` — event handling | BUG-103 (IMPORTANT) |
| `server/ai/trainer.js` | Covered by previous report |
| `server/ai/buffer.js` | Reviewed — no new bugs found |
| `engine/src/server.cpp` | Reviewed — no new bugs beyond #125 |
| `engine/src/engine.cpp` | Clean |
| `client/src/components/Board.jsx` | Clean |
| `client/src/components/Dashboard.jsx` | Clean |
| `client/src/components/ParamsPanel.jsx` | BUG-103 (receiver side) |
| `client/src/components/GameControls.jsx` | Clean |
| `client/src/components/ErrorBoundary.jsx` | Unused but clean |
| `client/src/components/MoveHistory.jsx` | Unused component (dead code) |
| `client/src/components/GameTimer.jsx` | Unused component (dead code) |
| `config.js` | Clean |
| `server/proxy.js` | Clean |
| `server/boardConvert.js` | Clean |

---

## Recommended Priority Fixes

1. **BUG-101** (CRITICAL): Fix policy index mapping in predict() and training — this is the root cause of model never improving
2. **BUG-102** (CRITICAL): Add missing `train` import — trivial one-line fix
3. **BUG-103** (IMPORTANT): Fix event name mismatch `'params'` vs `'setParams'` — one-line fix on client
4. **BUG-104** (MINOR): Align setSpeed validation with clamping range

---

*Report generated by Jarvis Horner — Hunter BugFinder cycle v2*
*2026-03-23 08:50 UTC*
