# Hunter Test-Writer — Test Coverage Gap Analysis
**Date:** 2026-03-23  
**Scanner:** hunter-sub-testwriter  
**Project:** /opt/Checkers_vibe

## Existing Test Coverage

### `__tests__/` (15 test files + runner)
| File | Covers |
|------|--------|
| boardConvert.test.js | boardFromCpp/boardToCpp basics, round-trips |
| boardConvertEdge.test.js | Edge values, single elements, flat arrays |
| boardConvertInvalid.test.js | Null/undefined, wrong dims, missing props |
| boardAreEqual.test.js | Board equality comparisons |
| boardSetLookup.test.js | Board set lookups |
| drawDetection.test.js | Draw counter via C++ engine (integration) |
| policyIndex.test.js | Policy index computation |
| predictMasking.test.js | Predict masking logic |
| trainImport.test.js | Training import |
| trainerLogic.test.js | validateMove, isMoveLegal, validateAndFallback |
| trainerPlayGame.test.js | Self-play game loop |
| trainerPolicyFix.test.js | Policy fixes |
| websocketHandlers.test.js | setSpeed validation, event name consistency |
| wsMoveValidation.test.js | Move coordinate validation |
| wsSetSpeed.test.js | Speed setting |

### `server/tests/` (4 test files + runner)
| File | Covers |
|------|--------|
| buffer.test.js | ReplayBuffer add/sample/save/load/clear |
| model.test.js | boardToTensor, createModel sizes, predict, train, save/load |
| trainer.test.js | SelfPlay constructor, setParams, start/stop, getStatus, restart |
| move-validation.test.js | _validateAndFallback, _randomLegalMove, isEngineUp |

## Coverage Gaps Found

### GAP-01: Config Speed Helpers — UNTESTED
**File:** `config.js`  
**Functions:** `moveDelayMs` getter, `animationStepDurationMs` getter  
**Risk:** Medium — affects animation timing across all game modes  
**Details:**
- `moveDelayMs` has branching logic: fast mode returns 0, normal mode returns aiMoveDelayMs or normalModeDelayMs
- `animationStepDurationMs` derives from moveDelayMs with floor division
- No tests exist for these computed properties

### GAP-02: Trainer Reward Calculation Helpers — UNTESTED
**File:** `server/ai/trainer.js`  
**Functions:** `flattenBoard`, `isOwnPiece`, `isPawn`, `isKing`, `calcMaterial`, `calcPosition`, `calcThreat`, `calcTempo`, `calculateReward`  
**Risk:** High — these drive the shaped reward signal for RL training  
**Details:**
- `flattenBoard` handles 2D, flat, and invalid inputs
- `calcMaterial` computes material difference normalized to [-1,1]
- `calcPosition` scores pawn advancement, center control, edge penalties, king positioning
- `calcThreat` counts adjacent opponent threats
- `calcTempo` measures advanced piece positions
- `calculateReward` combines all with weights (0.47 + 0.29 + 0.12 + 0.12)
- Zero tests for any of these

### GAP-03: Color/Turn Conversion — UNTESTED
**File:** `server/index.js`  
**Functions:** `colorToTurn`, `turnToColor`  
**Risk:** Low — simple mapping but affects all game state  
**Details:**
- `colorToTurn`: 'white'→1, else→-1
- `turnToColor`: 1→'white', -1→'black', string passthrough, 0/default→'white'
- No direct tests

### GAP-04: Model createModel Validation — PARTIALLY TESTED
**File:** `server/ai/model.js`  
**Functions:** `createModel` with invalid params  
**Risk:** Medium — custom architecture params have clamping logic  
**Details:**
- Existing tests only check valid sizes (small/medium/large)
- No tests for: layers < 1 or > 5, neurons < 32 or > 512, lr out of range, dropout > 0.5, invalid activation
- Clamping behavior unverified

### GAP-05: boardToTensor/buildInputArray Edge Cases — PARTIALLY TESTED
**File:** `server/ai/model.js`  
**Functions:** `boardToTensor`, `buildInputArray`  
**Risk:** Medium — affects all model predictions  
**Details:**
- No test for flat 64-array input (only 2D tested)
- No test for negative piece values (C++ sometimes sends -2 for black king)
- No test for `buildInputArray` at all (only boardToTensor tested)
- Turn encoding edge cases (turn=0, turn=-1)

### GAP-06: computePolicyIndex Edge Cases — PARTIALLY TESTED
**File:** `server/ai/model.js`  
**Function:** `computePolicyIndex`  
**Risk:** Low — basic cases tested in policyIndex.test.js  
**Details:**
- Invalid direction fallback (returns 0) not explicitly tested
- Array vs scalar input for fromSquare/toSquare not tested

### GAP-07: WebSocket startGame Handler Logic — UNTESTED
**File:** `server/index.js`  
**Handler:** `socket.on('startGame')`  
**Risk:** High — controls game initialization and mode switching  
**Details:**
- Mode switching logic (pvai/pvp/aivai)
- Trainer stop when starting player game
- Auto-start trainer for aivai mode
- Error emission on failure
- No tests

### GAP-08: WebSocket getLegalMoves Handler — UNTESTED
**File:** `server/index.js`  
**Handler:** `socket.on('getLegalMoves')`  
**Risk:** Medium — used for piece selection highlighting  
**Details:**
- Filtering moves by from coordinate
- Error handling
- No tests

### GAP-09: WebSocket reset Handler — UNTESTED
**File:** `server/index.js`  
**Handler:** `socket.on('reset')`  
**Risk:** High — full reset of model + game + buffer  
**Details:**
- Calls trainer.resetModel()
- Resets C++ game state
- Broadcasts to all clients
- Error handling
- No tests

### GAP-10: WebSocket setParams Auth & Validation — PARTIALLY TESTED
**File:** `server/index.js`  
**Handler:** `socket.on('setParams')`  
**Risk:** High — controls model architecture  
**Details:**
- Auth check: only allowed in aivai mode (tested indirectly, not directly)
- Parameter validation: layers 1-8, neurons 32-1024, batchSize 8-256, dropout 0-0.5
- Model recreation and buffer clearing flow
- Restart-if-was-running logic
- No direct tests for auth rejection or param validation ranges

### GAP-11: WebSocket setSpeedMode Handler — UNTESTED
**File:** `server/index.js`  
**Handler:** `socket.on('setSpeedMode')`  
**Risk:** Low — simple mode toggle  
**Details:**
- Only accepts 'fast' or 'normal'
- No test

### GAP-12: Proxy Filter Logic — UNTESTED
**File:** `server/proxy.js`  
**Function:** `setupProxy`, filter function  
**Risk:** Medium — incorrect filtering would break API routing  
**Details:**
- Filter should exclude /ai/* and /selfplay/* from proxying
- No test for filter logic

### GAP-13: Trainer isMoveLegal with Array Coordinates — PARTIALLY TESTED
**File:** `server/ai/trainer.js`  
**Function:** `isMoveLegal`  
**Risk:** Medium — trainer uses array [row,col] coords while some paths use scalars  
**Details:**
- Existing tests in trainerLogic.test.js use scalar from/to
- Real trainer code handles both array and scalar coords (via Array.isArray check)
- Array coordinate comparison path untested

### GAP-14: Trainer setModelParams Validation — UNTESTED
**File:** `server/ai/trainer.js`  
**Function:** `setModelParams`  
**Risk:** Medium — batchSize clamping  
**Details:**
- batchSize < 8 clamped to 8, > 256 clamped to 256
- No test for this clamping behavior

### GAP-15: Trainer resetModel — UNTESTED
**File:** `server/ai/trainer.js`  
**Function:** `resetModel`  
**Risk:** High — full model + buffer + stats + disk cleanup  
**Details:**
- Stops running, clears buffer, resets stats, resets epsilon
- Creates fresh models, saves state, deletes model files
- No test

## Summary
- **Total gaps:** 15
- **High risk:** 4 (reward calc, startGame, setParams auth, resetModel)
- **Medium risk:** 7 (config helpers, model validation, tensor edges, getLegalMoves, reset WS, proxy, isMoveLegal arrays)
- **Low risk:** 4 (color conversion, policyIndex, setSpeedMode, setModelParams)
