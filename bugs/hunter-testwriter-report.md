# Test Coverage Analysis — Checkers_vibe

**Date:** 2026-03-23  
**Analyst:** Hunter (testwriter subagent)  
**Project:** /opt/Checkers_vibe  

---

## Summary

- **48 test files** total (44 in `__tests__/`, 3 in `server/tests/`, 1 in `engine/tests/`)
- **~11,900 lines** of JS test code in `__tests__/`
- **C++ engine tests:** 1 file, ~480 lines, covers captures/promotion/draw/king moves
- **Test runner:** custom (no Jest/Vitest framework — all `export async function run*Tests()` with manual `assert`)
- **Key finding:** Tests overwhelmingly cover *extracted/validation logic* (mirrors of server code) rather than *integrated behavior*. Many test files duplicate the same server logic in slightly different ways.

---

## Coverage Assessment by Area

### 1. boardFromCpp / boardToCpp Helpers
**Status: WELL COVERED** ✅  
**Test files:** `boardConvert.test.js`, `boardConvertAdditional.test.js`, `boardConvertEdge.test.js`, `boardConvertInvalid.test.js`, `boardSetLookup.test.js`, `hunter-coverageGaps.test.js`  
**6 test files, ~50+ individual tests**

Covers: piece mapping (0-4), flat vs 2D input, empty board, round-trip, invalid values (5, -1, NaN), sparse arrays, case-sensitive color, extra properties, prototype pollution safety, wrong dimensions, random boards, starting position exact values.

**Gap:** None significant. This is the best-tested area.

---

### 2. O(1) Draw Detection (movesWithoutCapture counter)
**Status: PARTIALLY COVERED** ⚠️  
**Test file:** `drawDetection.test.js`  
**C++ engine:** `engine.cpp::getResult()` — `movesWithoutCapture_ >= 40 → DRAW`

**What IS tested:**
- Fresh game is not in draw state
- Non-capture moves don't immediately trigger draw
- Counter increments with non-capture moves
- Capture resets the counter
- Fewer than 40 non-capture moves → NOT DRAW

**Critical GAPS:**

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G1 | **40 half-moves threshold not testable via HTTP** — `/api/board/set` doesn't call `engine.reset()`, so `movesWithoutCapture_` carries over from previous games. Cannot reliably test the DRAW trigger. | **HIGH** | Fix `server.cpp` board/set handler to call `engine.reset()` first, then write test with kings-only position (no captures possible, play 40 non-capture moves) |
| G2 | **UndoLastMove counter rebuild not exposed** — `Engine::undoLastMove()` rebuilds `movesWithoutCapture_` from history, but no `/api/game/undo` HTTP endpoint exists. | **MEDIUM** | Add undo endpoint to `server.cpp`, test that counter correctly rebuilds after undo |
| G3 | **Counter behavior at exactly 40 vs 41** — no boundary test for the exact threshold (does 40 trigger or is it >40?) | **MEDIUM** | Test: set up position with counter=39, play one non-capture → DRAW |
| G4 | **Counter reset during multi-capture chain** — a multi-capture move should reset counter to 0 even though it's one move | **LOW** | Test: play a multi-capture, verify counter=0 |

---

### 3. WebSocket Handlers
**Status: MODERATELY COVERED** ⚠️  
**Test files:** `websocketHandlers.test.js`, `wsHandlerLogic.test.js`, `wsConnectionLifecycle.test.js`, `wsMoveValidation.test.js`, `wsSetSpeed.test.js`, `setSpeedModeValidation.test.js`, `resetHandlerLogic.test.js`, `rateLimiterThrottle.test.js`

**What IS tested:**
- `setSpeed` validation (NaN, negative, >10000, clamping)
- `setSpeedMode` validation (fast/normal, case sensitivity)
- `setParams` auth (only aivai mode), validation (layers/neurons/batchSize/dropout ranges)
- `move` coordinate validation (from/to, captures array)
- `getLegalMoves` coordinate filtering
- Connection lifecycle (state/selfPlayStatus/loss emissions)
- Move queue serialization (sequential processing)
- Rate limiting algorithm, wsThrottle
- Reset handler emissions
- Event name consistency

**Critical GAPS:**

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G5 | **setParams ALLOWED_PARAMS whitelist** — server has a `Set` of allowed keys (`layers`, `neurons`, `activation`, `lr`, `batchSize`, `dropout`, etc.) that filters prototype pollution. The WS handler logic test validates ranges but NOT the whitelist filtering. | **HIGH** | Test: send `{ layers: 3, __proto__: { isAdmin: true }, constructor: { evil: true } }` → verify only `layers` passes through |
| G6 | **setParams speed settings** — `speedMode` and `aiMoveDelayMs` are handled inside setParams but no test covers this code path | **MEDIUM** | Test: setParams with `{ speedMode: 'fast', aiMoveDelayMs: 100 }` → verify CONFIG updated |
| G7 | **setParams model recreation flow** — the 8-step process (stop → version++ → setModelParams → create models → clear buffer → reset stats → broadcast → restart) is untested as an integrated flow | **MEDIUM** | Test: mock the steps, verify sequence and that `wasRunning` triggers restart |
| G8 | **handleMove PvAI delay/animation** — the animation delay calculation `(playerPath.length * animStepMs + moveDelayMs)` before AI move is untested | **HIGH** | Test: mock timing, verify delay is computed correctly from path length |
| G9 | **aiMove double fallback** — if predict fails AND random move fails, the inner catch gives up silently. No test covers this catastrophic path. | **MEDIUM** | Test: mock cppFetch to throw on both predict and random fallback → verify graceful failure |
| G10 | **Auto-save 3-tier scheduling** — state every 30s, buffer every 2min, model every 5min. The timing math is tested but the actual `_lastBufferSave`/`_lastModelSave` interaction with `_saving` guard isn't integration-tested. | **LOW** | Already partially covered by `autoSaveLogic.test.js` and `autoSaveTiming.test.js` |

---

### 4. React.memo + Debounce (ParamsPanel)
**Status: NOT COVERED** ❌  
**Source file:** `client/src/components/ParamsPanel.jsx`

**Zero test coverage for:**
- `useDebouncedCallback` hook (delays fn by ms, resets on each call)
- `lrToSlider` / `sliderToLr` log-scale conversion
- `SideTab` component rendering
- `Slider` component rendering
- Tab switching (Białe/Czarne/Ogólne)
- Epsilon local state + debounced emit
- Network size selector
- Apply/Reset buttons
- `React.memo` wrapping (ParamsPanel is NOT wrapped in memo — only Board is)

**Related:** `Board.jsx` ARE covered by `boardAreEqual.test.js` (the `areEqual` comparator).

**Critical GAPS:**

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G11 | **useDebouncedCallback** — no unit test. A race condition or timer leak could cause epsilon changes to queue incorrectly. | **HIGH** | Test: call debounced fn 5x rapidly, verify only last call fires after ms delay; verify cleanup on unmount |
| G12 | **lrToSlider / sliderToLr** — log-scale conversion. Edge case: what happens if lr=0 or lr=0.0001 (boundary)? | **MEDIUM** | Test: boundary values (0.0001→0, 0.1→100), round-trip accuracy, negative lr |
| G13 | **ParamsPanel rendering** — no snapshot or structural test at all | **MEDIUM** | Verify: 3 tabs render, correct controls per tab, accessibility attributes (role=tab, aria-selected) |
| G14 | **Keyboard navigation in tabs** — `onKeyDown` handler for ArrowLeft/ArrowRight not tested | **LOW** | Test: simulate keydown events, verify tab focus changes |

---

### 5. Game Logic (C++ Engine)
**Status: WELL COVERED** ✅  
**Test file:** `engine/tests/test_moves.cpp` (~480 lines, 24 test functions)

Covers: initial position moves, simple moves, pawn capture (forward + backward), capture mandatory, multi-capture, king moves (all directions + distance), promotion, blocked positions, game over detection, draw vs win, corner pieces, capture chains (3+), king capture distance, king blocked by own, forced captures, promotion during capture, draw detection simulation, empty board, undoLastMove, full game sequence (20 moves), no-stall positions.

**GAPS:**

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G15 | **King multi-capture with direction changes** — engine test has king capture distance but no test for king changing direction mid-multi-capture (e.g., capture diagonally NW, then NE) | **MEDIUM** | Test: king at (3,3), enemies at (5,5) and (3,5), verify king can capture both in one move |
| G16 | **King promotion during multi-capture** — a pawn that becomes king mid-chain should continue with king movement rules | **LOW** | The C++ code handles this (`becameKing` flag in `multiCapture`), but no explicit test |
| G17 | **isLegal() method** — exists in engine.h but no dedicated test (only used indirectly via makeMove) | **LOW** | Test: verify isLegal returns true/false for known positions |
| G18 | **makeMoveUnchecked** — no test (used internally, but exposed in header) | **LOW** | Test: verify it doesn't validate and still modifies board |

---

### 6. AI / Trainer Logic
**Status: MODERATELY COVERED** ⚠️  
**Test files:** `trainerLogic.test.js`, `trainerPlayGame.test.js`, `trainerArrayMoves.test.js`, `trainerPolicyFix.test.js`, `trainerRewardHelpers.test.js`, `aiFallbackLogic.test.js`, `aiMovePrediction.test.js`, `predictMasking.test.js`, `policyIndex.test.js`, `issue129.test.js`, `issue130.test.js`, `server/tests/trainer.test.js`

**GAPS:**

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G19 | **trainer._playGame with paramsVersion check** — issue #133 fix ensures in-flight games are invalidated when params change. No explicit test for the version comparison. | **MEDIUM** | Test: start game, change paramsVersion mid-game, verify old game doesn't apply results |
| G20 | **epsilon decay** — epsilon should decay each game toward minEpsilon. No test verifies the decay formula. | **MEDIUM** | Test: simulate 10 games, verify epsilon decreases correctly |
| G21 | **buffer circular overwrite** — tested in `buffer.test.js` but the interaction with trainer.saveState/loadState isn't tested | **LOW** | Integration test needed |
| G22 | **model save/load round-trip** — `saveModel`/`loadModel` with TF.js. No integration test (requires TF.js). | **LOW** | Hard to test without TF.js dependency |

---

### 7. Client Components (React)
**Status: POORLY COVERED** ❌

| Component | Test Coverage | Notes |
|-----------|--------------|-------|
| `Board.jsx` | `boardAreEqual.test.js` ✅ (areEqual only) | No rendering test, no animation logic test |
| `Dashboard.jsx` | NONE ❌ | Canvas chart, stats display, game history |
| `GameControls.jsx` | NONE ❌ | Button callbacks, turn indicator, status text |
| `GameTimer.jsx` | NONE ❌ | (not even referenced in App.jsx?) |
| `MoveHistory.jsx` | NONE ❌ | Move list rendering |
| `ParamsPanel.jsx` | NONE ❌ | Debounce, tabs, sliders, apply/reset |
| `ErrorBoundary.jsx` | NONE ❌ | Error catching, fallback UI |
| `App.jsx` | NONE ❌ | Socket lifecycle, state management, cell click logic |

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G23 | **Board animation logic** — the multi-capture step animation (`animStep`, `animBoard`, `timersRef`) is complex and untested. Piece-matching logic for single-move animation is untested. | **HIGH** | Test: board diff detection, animOffsets calculation, multi-capture step sequencing |
| G24 | **Board memoization** — `useMemo` for cells+pieces with 8 dependency vars. No test verifies memo invalidation works correctly. | **MEDIUM** | Test: change only `selected`, verify cells recompute but pieces don't (or vice versa) |
| G25 | **Dashboard canvas chart** — draws loss history, handles <2 data points, responsive resize. No test. | **LOW** | Canvas testing requires jsdom or similar |
| G26 | **App.jsx cell click logic** — complex state machine (selected piece, legal moves, human piece check, PvAI vs PvP). No test. | **HIGH** | Test: extract handleCellClick logic, test piece selection, move execution, mode-dependent behavior |
| G27 | **App.jsx socket event handlers** — state, legalMoves, gameOver, loss, selfPlayStatus, paramsUpdate, error events. Each has complex state updates. No test. | **HIGH** | Test: mock socket, emit events, verify state updates correctly |

---

### 8. Server Infrastructure
**Status: MODERATELY COVERED** ⚠️

| # | Gap | Priority | Suggested Test |
|---|-----|----------|----------------|
| G28 | **Security headers middleware** — tested by `securityHeaders.test.js` ✅ | — | — |
| G29 | **Rate limit cleanup interval** — the `setInterval` that deletes expired entries is not tested (memory leak risk) | **MEDIUM** | Test: add entries, advance time, verify cleanup removes them |
| G30 | **Proxy error handling** — proxy.test.js covers filter but not error propagation from C++ engine | **LOW** | Already partially covered by `proxyLogic.test.js` |
| G31 | **Express JSON body limit** — `express.json({ limit: '1mb' })` — no test for oversized payloads | **LOW** | Integration test needed |

---

## Priority Summary

### HIGH Priority (should fix/test now)
| # | Area | Issue |
|---|------|-------|
| G5 | WS setParams | ALLOWED_PARAMS whitelist not tested (security) |
| G8 | WS handleMove | PvAI animation delay calculation untested |
| G9 | AI move | Double fallback (predict fail + random fail) untested |
| G11 | ParamsPanel | `useDebouncedCallback` hook — no unit test |
| G23 | Board | Animation logic (multi-capture steps) untested |
| G26 | App.jsx | Cell click state machine untested |
| G27 | App.jsx | Socket event handlers untested |

### MEDIUM Priority (next sprint)
| # | Area | Issue |
|---|------|-------|
| G1 | Draw detection | 40-half-move threshold not testable via HTTP (needs server.cpp fix) |
| G2 | Draw detection | UndoLastMove counter rebuild not exposed |
| G3 | Draw detection | Exact boundary (40 vs 41) not tested |
| G6 | WS setParams | Speed settings path untested |
| G7 | WS setParams | 8-step model recreation flow untested |
| G12 | ParamsPanel | Log-scale LR conversion edge cases |
| G13 | ParamsPanel | Component rendering/structure |
| G15 | Engine | King multi-capture direction changes |
| G19 | Trainer | paramsVersion check (#133) |
| G20 | Trainer | Epsilon decay formula |
| G24 | Board | Memoization invalidation |
| G29 | Server | Rate limit cleanup interval |

### LOW Priority (backlog)
| # | Area | Issue |
|---|------|-------|
| G4 | Draw detection | Counter during multi-capture chain |
| G10 | Auto-save | 3-tier integration test |
| G14 | ParamsPanel | Keyboard navigation |
| G16 | Engine | Pawn→king promotion during multi-capture |
| G17 | Engine | isLegal() dedicated test |
| G18 | Engine | makeMoveUnchecked test |
| G21 | Trainer | Buffer + saveState interaction |
| G22 | Trainer | Model save/load round-trip (needs TF.js) |
| G25 | Dashboard | Canvas chart (needs jsdom) |
| G30 | Proxy | Error propagation |
| G31 | Server | Oversized JSON payload |

---

## Test Quality Notes

1. **Logic duplication:** Many test files mirror server code rather than importing it. If the server changes, tests won't break — they'll silently become wrong. Examples: `wsHandlerLogic.test.js` has `validateSetParams` with ranges `1-8` and `32-1024`, but server has `1-5` and `32-512`.

2. **No test framework:** Tests use raw `assert` and manual pass/fail counting. No describe/it blocks, no setup/teardown, no mocking library. This limits test expressiveness.

3. **Integration tests require running C++ engine:** `drawDetection.test.js` and `kingMovesPath.test.js` hit `localhost:8080` — they need the engine running. No CI-friendly mocking.

4. **React component tests require browser/DOM:** No React Testing Library, no jsdom setup. Components are completely untestable in the current setup.

---

## Recommendations

1. **Add Vitest or Jest** for proper test framework (describe/it, mocking, coverage reports)
2. **Add React Testing Library** for component tests
3. **Fix server.cpp** board/set handler to call `engine.reset()` — unlocks draw detection threshold test
4. **Extract shared validation functions** from server/index.js into `server/validation.js` — import in both server and tests instead of duplicating
5. **Add coverage reporting** (`vitest --coverage`) to identify unknown gaps
