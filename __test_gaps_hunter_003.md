# Test Coverage Gap Analysis — Checkers_vibe

**Date:** 2026-03-23  
**Scope:** `server/`, `server/ai/`, `__tests__/`, `server/tests/`  
**Existing test files:** 50 in `__tests__/` + 4 in `server/tests/`

---

## Executive Summary

The test suite has **extensive unit-level coverage** of validation logic, input sanitization, and extracted helper functions. However, there are significant gaps in:

1. **Reward shaping functions** (trainer.js) — zero dedicated tests for the core training signal
2. **Integration/handler flows** — handleMove, aiMove, getGameState orchestration
3. **WebSocket event handler coverage** — only startGame, setParams auth, move validation partially tested
4. **Draw detection** — TODO items remain for the 40-half-move counter trigger
5. **Model training pipeline** — Bellman equation, batch splitting by turn
6. **Auto-save dirty flag** (#102) — no dedicated test for dirty/reset behavior

---

## 1. REWARD SHAPING (trainer.js) — HIGH PRIORITY

The `calculateReward()` function and its four sub-functions compute shaped intermediate rewards that directly drive training quality. **None have dedicated unit tests.**

### 1.1 `calculateReward(prevBoard, nextBoard, turn)`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Full weighted sum of sub-rewards | `calculateReward: returns weighted sum in [-1, 1]` | **HIGH** |
| Null prevBoard returns 0 | `calculateReward: null prevBoard → 0` | **HIGH** |
| Null nextBoard returns 0 | `calculateReward: null nextBoard → 0` | **HIGH** |
| Clamping to [-1, 1] | `calculateReward: extreme inputs clamped to [-1, 1]` | **HIGH** |
| Rounding to 3 decimal places | `calculateReward: result rounded to 3 decimals` | **MEDIUM** |

### 1.2 `calcMaterial(prev, next, turn)`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Capturing opponent piece → positive reward | `calcMaterial: capturing opponent pawn increases reward` | **HIGH** |
| Losing own piece → negative reward | `calcMaterial: losing own piece decreases reward` | **HIGH** |
| King captured (value 3) vs pawn (value 1) | `calcMaterial: king capture has 3x pawn value` | **HIGH** |
| No change → 0 | `calcMaterial: identical boards → 0` | **MEDIUM** |
| Black perspective (turn=-1) | `calcMaterial: black perspective flips piece ownership` | **HIGH** |

### 1.3 `calcPosition(board, turn)`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Pawn advancement increases score | `calcPosition: advanced pawns score higher` | **HIGH** |
| Center pieces score higher than edge | `calcPosition: center bonus for pawns` | **MEDIUM** |
| King center vs edge scoring | `calcPosition: king center bonus, edge penalty` | **MEDIUM** |
| Empty board → 0 | `calcPosition: empty board → 0` | **LOW** |
| All pieces on edge → negative | `calcPosition: edge penalty applied` | **MEDIUM** |

### 1.4 `calcThreat(board, turn)`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Pawn capture direction (white captures +row, black captures -row) | `calcThreat: white pawn can only capture downward` | **HIGH** |
| King can capture in all directions | `calcThreat: king captures in all 4 diagonals` | **HIGH** |
| No threats → 0 | `calcThreat: no adjacent opponents → 0` | **MEDIUM** |
| Blocked capture (landing square occupied) not counted | `calcThreat: occupied landing square prevents threat` | **MEDIUM** |

### 1.5 `calcTempo(prev, next, turn)`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Advanced pieces (rows 4-6 white, 1-3 black) | `calcTempo: white pieces in rows 4-6 count as advanced` | **MEDIUM** |
| No advanced pieces → 0 | `calcTempo: no advanced pieces → 0` | **LOW** |
| Both sides advanced → ratio | `calcTempo: ratio of advanced pieces` | **MEDIUM** |

### 1.6 `flattenBoard`, `isOwnPiece`, `isPawn`, `isKing`

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| 2D board flattening | `flattenBoard: 8x8 → flat 64` | **MEDIUM** |
| Already-flat passthrough | `flattenBoard: 64-flat passes through` | **MEDIUM** |
| Invalid input → null | `flattenBoard: non-array → null` | **LOW** |
| isOwnPiece for white/black | `isOwnPiece: correct per-turn ownership check` | **MEDIUM** |
| isPawn/isKing encoding | `isPawn/isKing: correct C++ encoding check` | **MEDIUM** |

---

## 2. HANDLE MOVE FLOW (server/index.js) — HIGH PRIORITY

The `handleMove()` async function is the core orchestrator for player moves. It handles PvAI AI response, PvP broadcast, animation delays, and game-over logic. **Zero tests.**

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| PvAI: emits player state, waits for animation, then AI moves | `handleMove: PvAI emits player state before AI move` | **HIGH** |
| PvAI: animation delay calculated from path length | `handleMove: animation delay = path.length * stepMs + delayMs` | **HIGH** |
| PvP: broadcasts to all (io.emit) | `handleMove: PvP broadcasts state to all clients` | **HIGH** |
| PvAI: emits only to requesting socket | `handleMove: PvAI emits to requesting socket only` | **HIGH** |
| Game over: emits gameOver event | `handleMove: game over emits gameOver with winner` | **HIGH** |
| aivai game over: restarts self-play after 3s | `handleMove: aivai game over restarts trainer` | **MEDIUM** |
| Non-aivai game over: does NOT restart self-play | `handleMove: pvai game over does not restart trainer` | **MEDIUM** |
| Move body includes captures when present | `handleMove: move body includes captures array` | **MEDIUM** |

---

## 3. AI MOVE FUNCTION (server/index.js) — HIGH PRIORITY

The `aiMove()` function handles AI prediction, move validation, fallback to random, and execution. **Zero tests.**

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| No legal moves → returns early | `aiMove: no legal moves → early return` | **HIGH** |
| Predict succeeds → executes predicted move | `aiMove: successful prediction executes move` | **HIGH** |
| Predict throws → falls back to random move | `aiMove: predict error → random fallback` | **HIGH** |
| Predicted move not in legalMoves → random fallback | `aiMove: invalid predicted move → random fallback` | **HIGH** |
| Random fallback after total failure | `aiMove: double fallback on total failure` | **MEDIUM** |
| Move body includes captures for multi-jump | `aiMove: capture move includes captures in body` | **MEDIUM** |
| Moves indexed with computePolicyIndex | `aiMove: moves get policyIndex assigned` | **MEDIUM** |

---

## 4. WEBSOCKET EVENT HANDLERS (server/index.js) — MEDIUM PRIORITY

Most WS handlers have **validation-only tests** (extracted logic). The full handler flow including side effects and error handling is untested.

### 4.1 `startGame` handler

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Invalid mode defaults to pvai | `startGame: invalid mode string → pvai` | **MEDIUM** |
| Engine error → emits error event | `startGame: cppFetch failure → error emit` | **MEDIUM** |
| aivai mode starts trainer | `startGame: aivai calls trainer.start()` | **MEDIUM** |

### 4.2 `getLegalMoves` handler

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Invalid from → emits error | `getLegalMoves: invalid coord → error emit` | **MEDIUM** |
| Engine failure → emits error | `getLegalMoves: engine failure → error emit` | **MEDIUM** |
| Filters moves by from coordinate | `getLegalMoves: filters by from coord` | **LOW** (covered in wsHandlerLogic) |

### 4.3 `move` handler — serialization

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Move queue prevents races (Promise chain) | `move: serialized via _moveQueue promise chain` | **HIGH** |
| Throttle: max 1 move per 50ms per socket | `move: throttle blocks rapid moves` | **MEDIUM** (covered in rateLimiterThrottle) |
| Invalid captures elements → error | `move: invalid capture coord → error emit` | **MEDIUM** |
| Handle error in queue → emits error | `move: queue error → error emit` | **MEDIUM** |

### 4.4 `setParams` handler

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Non-object input → error | `setParams: non-object → error emit` | **MEDIUM** |
| Array input → error | `setParams: array → error emit` | **MEDIUM** |
| Prototype pollution keys filtered | `setParams: __proto__, constructor filtered by whitelist` | **HIGH** |
| Speed mode change applied to CONFIG | `setParams: speedMode updates CONFIG.server.speedMode` | **MEDIUM** |
| aiMoveDelayMs clamped to [0, 10000] | `setParams: aiMoveDelayMs clamped` | **MEDIUM** |
| Was-running flag → restarts after update | `setParams: wasRunning → restarts trainer` | **MEDIUM** |
| ParamsVersion incremented | `setParams: paramsVersion++ invalidates in-flight games` | **HIGH** |
| Buffer cleared on param change | `setParams: buffer cleared` | **MEDIUM** |

### 4.5 `setSpeedMode` handler

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Non-string → error | `setSpeedMode: non-string → error emit` | **MEDIUM** |
| "fast" updates CONFIG | `setSpeedMode: "fast" → CONFIG updated` | **LOW** |
| "normal" updates CONFIG | `setSpeedMode: "normal" → CONFIG updated` | **LOW** |
| Invalid string (e.g. "turbo") → no change | `setSpeedMode: invalid string → no change` | **MEDIUM** |

### 4.6 `reset` handler

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| Engine reset failure swallowed | `reset: engine error caught, model reset still completes` | **MEDIUM** |
| Broadcasts to all clients | `reset: broadcasts selfPlayStatus + modelRestart` | **MEDIUM** |

### 4.7 `startSelfPlay` / `stopSelfPlay` handlers

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| startSelfPlay calls trainer.start() | `startSelfPlay: calls trainer.start()` | **LOW** |
| startSelfPlay engine failure → error emit | `startSelfPlay: engine failure → error emit` | **MEDIUM** |
| stopSelfPlay calls trainer.stop() | `stopSelfPlay: calls trainer.stop()` | **LOW** |

---

## 5. DRAW DETECTION — MEDIUM PRIORITY

The draw detection test file has **two TODO items** that block full coverage.

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| 40 non-capture half-moves → DRAW | `40 non-capture half-moves → DRAW` | **HIGH** (blocked: needs server.cpp fix) |
| UndoLastMove rebuilds counter | `UndoLastMove rebuilds movesWithoutCapture_` | **MEDIUM** (blocked: needs /api/game/undo endpoint) |
| Counter resets on capture | `capture resets movesWithoutCapture_` | **LOW** (partially tested) |
| Engine state/legalmoves desync → draw | `no legal moves but not gameOver → force draw` | **MEDIUM** |

**Note:** These are blocked by C++ engine server changes, not by test code.

---

## 6. MODEL TRAINING (server/ai/model.js) — MEDIUM PRIORITY

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| `train()`: Bellman equation with shaped rewards | `train: Bellman target = reward + gamma * (-nextQ) * (1-done)` | **HIGH** |
| `train()`: batch split by turn (white/black) | `train: samples split by turn for correct model` | **MEDIUM** |
| `train()`: terminal sample (done=true) → no nextQ | `train: done sample uses only reward, no gamma term` | **HIGH** |
| `train()`: value clamped to [-1, 1] | `train: Bellman value clamped to tanh range` | **MEDIUM** |
| `train()`: empty batch → {loss: 0} | `train: empty batch returns loss 0` | **LOW** (likely covered) |
| `buildInputArray()`: mirror of boardToTensor | `buildInputArray: produces same encoding as boardToTensor` | **LOW** |
| `createModel()`: custom options validation | `createModel: invalid layers clamped to 1-5` | **MEDIUM** |
| `createModel()`: leaky_relu activation | `createModel: leaky_relu uses LeakyReLU layer` | **MEDIUM** |
| `createModel()`: dropout applied when > 0 | `createModel: dropout layer added when rate > 0` | **MEDIUM** |
| `saveModel()`: atomic write (tmp + rename) | `saveModel: atomic tmp→rename prevents corruption` | **MEDIUM** |

---

## 7. SELFPLAY TRAINER STATE (server/ai/trainer.js) — MEDIUM PRIORITY

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| `_loop()`: stops after 3 consecutive errors | `_loop: stops after 3 consecutive errors` | **HIGH** |
| `_loop()`: resets error counter on success | `_loop: consecutive errors reset on success` | **MEDIUM** |
| `_playGame()`: MAX_MOVES=300 → forced draw | `_playGame: 300 moves → forced draw` | **MEDIUM** |
| `_playGame()`: paramsVersion race guard (#133) | `_playGame: paramsVersion mismatch → abort mid-game` | **HIGH** |
| `_playGame()`: epsilon decay skipped if params changed | `_playGame: epsilon decay skipped on version mismatch` | **MEDIUM** |
| `isEngineUp()`: returns true/false | `isEngineUp: ok response → true, error → false` | **LOW** |
| `waitForEngine()`: retry loop | `waitForEngine: retries up to maxAttempts` | **MEDIUM** |
| `resetModel()`: deletes model files from disk | `resetModel: rm model dir and buffer file` | **MEDIUM** |
| `restart()`: side-specific model recreation | `restart: side=white only resets white model/stats` | **MEDIUM** |
| `saveState()`: atomic write with .tmp | `saveState: atomic tmp→rename` | **LOW** |
| `loadState()`: missing file starts fresh | `loadState: ENOENT → fresh state` | **LOW** |
| `loadState()`: malformed JSON starts fresh | `loadState: SyntaxError → fresh state` | **LOW** |
| `getStatus()`: avg round time calculation | `getStatus: avgRoundTimeMs computed from last 10 rounds` | **MEDIUM** |
| `setModelParams()`: batchSize clamping | `setModelParams: batchSize clamped to [8, 256]` | **LOW** (covered in selfPlayState.test.js) |

---

## 8. AUTO-SAVE DIRTY FLAG (#102) — MEDIUM PRIORITY

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| dirty=false → skip save entirely | `autoSave: not dirty → skip all saves` | **MEDIUM** |
| dirty=true → save state, reset flag | `autoSave: dirty → save state, reset dirty` | **MEDIUM** |
| Buffer save only every 2 min | `autoSave: buffer saved every 2 min when dirty` | **LOW** (covered in autoSaveLogic) |
| Model save only every 5 min | `autoSave: model saved every 5 min when dirty` | **LOW** (covered in autoSaveLogic) |
| _saving guard prevents concurrent saves | `autoSave: _saving guard prevents re-entrant save` | **MEDIUM** |

---

## 9. CONFIG SPEED HELPERS — LOW PRIORITY

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| `moveDelayMs`: fast mode → 0 | `moveDelayMs: fast mode returns 0` | **LOW** (likely covered) |
| `moveDelayMs`: normal mode with aiMoveDelayMs > 0 | `moveDelayMs: normal uses aiMoveDelayMs when > 0` | **LOW** |
| `moveDelayMs`: normal mode fallback to normalModeDelayMs | `moveDelayMs: normal falls back to normalModeDelayMs` | **LOW** |
| `animationStepDurationMs`: floor(moveDelayMs / 2) | `animationStepDurationMs: half of moveDelayMs floored` | **LOW** |

---

## 10. PROXY (server/proxy.js) — LOW PRIORITY

Coverage is decent. Remaining gaps:

| Gap | Suggested Test | Priority |
|-----|---------------|----------|
| pathRewrite restores /api prefix | `proxy: pathRewrite ^ → /api` | **LOW** (covered in proxyPathRewrite) |
| Error handler checks res.headersSent | `proxy: error handler checks headersSent before write` | **LOW** |
| POST body re-serialized with correct Content-Length | `proxy: Content-Length set to Buffer.byteLength` | **MEDIUM** |

---

## Summary by Priority

### HIGH Priority (write these first)
1. `calculateReward` + sub-functions (calcMaterial, calcPosition, calcThreat, calcTempo) — core training signal
2. `handleMove` flow — PvAI/PvP orchestration
3. `aiMove` flow — prediction + fallback
4. `train()` Bellman equation — shaped reward + terminal handling
5. `_playGame` paramsVersion race guard (#133)
6. `_loop` 3-error-stops behavior
7. `setParams` prototype pollution whitelist
8. `move` WS handler serialization (promise queue)

### MEDIUM Priority
1. Individual reward sub-function edge cases
2. WS handler full flows (startGame, setSpeedMode, reset)
3. Auto-save dirty flag behavior
4. Model creation with custom options
5. Trainer state save/load round-trips
6. Draw detection 40-move trigger (blocked by C++ fix)

### LOW Priority
1. Config speed helpers
2. ReplayBuffer serialization details
3. buildInputArray encoding
4. Engine health check helpers
5. Proxy edge cases

---

## Test File Naming Convention (for new tests)

Recommended new test files to add:
- `__tests__/rewardShaping.test.js` — calculateReward + sub-functions
- `__tests__/handleMoveFlow.test.js` — handleMove orchestration
- `__tests__/aiMoveFlow.test.js` — aiMove prediction + fallback
- `__tests__/trainBellman.test.js` — train() with Bellman targets
- `__tests__/selfPlayLoopErrors.test.js` — _loop error recovery
- `__tests__/setParamsWhitelist.test.js` — prototype pollution protection
- `__tests__/moveSerialization.test.js` — WS move promise queue
