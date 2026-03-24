# Hunter Alpha — Dynamic Bug Finder Report

**Date:** 2026-03-24
**Scope:** Full codebase scan — server (index.js, trainer.js, model.js, minimax.js, buffer.js, boardConvert.js, proxy.js), client (App.jsx, Board.jsx, Dashboard.jsx, GameControls.jsx, ParamsPanel.jsx, ErrorBoundary.jsx, GameTimer.jsx), config.js

---

### BUG: Config object mutated at runtime despite deep-freeze contract
- **Severity:** critical
- **Location:** server/index.js (setSpeed handler ~L602, setSpeedMode ~L622, setParams ~L570), server/ai/trainer.js (setParams)
- **Description:** `config.js` deep-freezes all strategy objects but leaves `CONFIG.server` mutable. Multiple WS handlers mutate `CONFIG.server.speedMode`, `CONFIG.server.aiMoveDelayMs`, `CONFIG.server.normalModeDelayMs` directly. The `setParams` handler (line ~570) also does `CONFIG.ai.strategy.white = newStrategy` which mutates the strategy map at runtime. If two clients connect simultaneously and send `setParams` at the same time, one can overwrite the other's strategy/speed config because there's no mutex or versioning for CONFIG mutations. This is a data race on shared mutable state.
- **Fix suggestion:** Use a separate runtime state object for mutable settings instead of mutating CONFIG directly. Or at minimum, protect CONFIG mutations behind the model lock or a dedicated mutex.

---

### BUG: calcThreat double-counts — own and opponent threat counts are swapped/inflated
- **Severity:** critical
- **Location:** server/ai/trainer.js:97-128 (calcThreat)
- **Description:** In `calcThreat`, the loop iterates ALL pieces (both own and opponent). For each piece at position `i`, it checks adjacent diagonals. The variable `isMy` is set based on `board[i]`. When `isMy` is true (own piece), finding an opponent adjacent that could capture increments `myThreats` — correct. But when `isMy` is false (opponent piece), the adjacent check uses `!isOwnPiece(board[adjIdx], turn)` — this checks if `board[adjIdx]` is NOT one of MY pieces (i.e., it's opponent or empty). For an opponent piece, finding another opponent piece adjacent that could capture it would increment `oppThreats`. This counts "opponent threatening opponent" which is strategically meaningless. The actual intended logic should be: count threats TO my pieces and threats TO opponent pieces. The current code inflates both counts with self-threats.
- **Fix suggestion:** Restructure: when `isMy` is true, only count `myThreats` (opponent adjacent that can capture my piece). When `isMy` is false, only count `oppThreats` (my pieces adjacent that can capture opponent piece). Don't double-count.

---

### BUG: Loss value clamped to [-1, 1] flattens temporal reward differentiation
- **Severity:** important
- **Location:** server/ai/model.js:310-312 (train function)
- **Description:** The Bellman target is clamped: `valueTarget = Math.max(-1, Math.min(1, valueTarget))`. With GAMMA=0.95 and rewardWin=1.0, a winning position 2 moves ahead has Q ≈ 1 + 0.95*1 = 1.95, which gets clamped to 1.0. The model can't learn to prefer "winning sooner" over "winning later" — all winning positions look identical to the value head. Similarly, deep losses all appear as -1. This degrades the quality of move selection: the AI can't distinguish between an immediate win and a win 5 moves away.
- **Fix suggestion:** Use a wider clamp range (e.g., [-3, 3]) matching the actual Q-value range with GAMMA=0.95, or remove the clamp and let the tanh activation naturally compress extreme values.

---

### BUG: minimaxSearch ignores CONFIG strategy weights — UI tuning is non-functional
- **Severity:** important
- **Location:** server/ai/minimax.js:35-73 (evaluate), server/ai/trainer.js:330-335 (_playGame minimax path)
- **Description:** When minimax strategy is selected, `_playGame` calls `minimaxSearch()` which uses `evaluate()` with hardcoded positional bonuses (0.05 advance, 0.1 center, 0.3 king center). The CONFIG minimax strategy defines `weights: { material: 1.0, position: 0.3 }` but these values are NEVER passed to or used by `evaluate()`. The function has no parameter for weights. The `0.3` position weight in config is a dead value. Adjusting minimax weights in the UI has zero effect on actual play.
- **Fix suggestion:** Pass strategy weights to `evaluate()` and `minimaxSearch()`, or document that minimax weights are unused and remove them from the config to avoid confusion.

---

### BUG: Race condition — handleMove fetches game state twice without C++ state lock
- **Severity:** important
- **Location:** server/index.js:193-242 (handleMove)
- **Description:** After the player's move, `handleMove` calls `getGameState()` (parallel fetch of game state + legal moves). If PvAI and game isn't over, it emits the state, waits for animation delay, calls `aiMove()` (which sends another `/api/move` to C++), then calls `getGameState()` AGAIN. Between the two `getGameState()` calls, the AI has modified C++ state via `cppFetch('/api/move')`. If the C++ engine's response is slow or the internal state hasn't fully updated, the second `getGameState()` could return a state where the AI's move isn't yet reflected — causing the client to see the pre-AI-move board briefly, then the correct board on the next state event.
- **Fix suggestion:** Use the response from the AI's `/api/move` call directly (convert via `boardFromCpp` like `_playGame` does), or add a small delay after the AI move before the second state fetch.

---

### BUG: ParamsPanel sends non-model keys via setParams — modelParams accumulates stale keys
- **Severity:** important
- **Location:** client/src/App.jsx:336 (handleApplyModelParams), server/index.js:496-532 (setParams handler), server/ai/trainer.js:135 (setModelParams)
- **Description:** `handleApplyModelParams` sends `{ ...modelParams }` to the server. The `modelParams` React state includes keys from all sliders: `minEpsilon`, `epsilonDecay`, `gamma`, `bufferSize`, `epochs`, `rewardCapture`, `rewardLosePiece`, `rewardPromotion`, `rewardWin`, `rewardLose`, plus architecture keys. The server's ALLOWED_PARAMS whitelist accepts all these. They're passed to `trainer.setModelParams()` which does `Object.assign(this.modelParams, newParams)`. Over time, `this.modelParams` accumulates non-architecture keys (like `gamma`, `rewardWin`) that aren't used by `createModel()` but get spread into `{ ...this.modelParams }` and passed to model creation. While currently harmless (createModel ignores unknown keys), this creates a bloated object and could cause bugs if createModel is refactored to validate its options.
- **Fix suggestion:** In `setModelParams`, filter to only architecture-relevant keys (layers, neurons, activation, lr, batchSize, dropout). Store training params (gamma, rewards, epsilon) separately.

---

### BUG: WebSocket startSelfPlay optimistic toggle can desync from server
- **Severity:** important
- **Location:** client/src/App.jsx:327-337 (handleToggleSelfplay)
- **Description:** `handleToggleSelfplay` optimistically toggles `selfPlayActiveRef.current` and `selfPlayActive` state BEFORE the server confirms. If the server's `trainer.start()` throws (engine down, model not initialized), the server emits `error` event. The client handles the error event by showing a toast, but does NOT revert the self-play toggle state. The client permanently shows "Self-Play: Active" while the server shows inactive, and vice versa.
- **Fix suggestion:** In the `error` event handler, check if the error relates to self-play and revert the toggle. Or remove optimistic update entirely and wait for server `selfPlayStatus` confirmation.

---

### BUG: setParams handler doesn't clamp aiMoveDelayMs — client can set absurd values
- **Severity:** important
- **Location:** server/index.js:566-574 (setParams handler)
- **Description:** The `setParams` WS handler validates `aiMoveDelayMs` as `Number.isFinite` but does NOT clamp to 0-10000 like the dedicated `setSpeed` handler (line 604) does. A malicious or buggy client can set `aiMoveDelayMs` to 999999 via `setParams`, causing the `animationStepDurationMs` getter in config.js to return `Math.floor(999999/2) = 499999ms` (~8 minutes per animation step), effectively freezing the UI.
- **Fix suggestion:** Add `const clamped = Math.max(0, Math.min(10000, newParams.aiMoveDelayMs))` before assignment in the setParams handler, matching the setSpeed handler's validation.

---

### BUG: Dead code — unused `rewards` array in train function
- **Severity:** cosmetic
- **Location:** server/ai/model.js (train function)
- **Description:** The `train` function references `sample.reward` for Bellman calculation but there's a commented-out or remnant `rewards` array pattern. Checking actual source: `sample.reward` is used directly, no `rewards` array exists. (Previously identified pattern was already cleaned up.) Verified: no dead rewards array.
- **Fix suggestion:** N/A — already clean.

---

### BUG: Dead code — unused `result` variable in _playGame no-moves edge case
- **Severity:** cosmetic
- **Location:** server/ai/trainer.js:395-397 (_playGame, "no legal moves" block)
- **Description:** In the edge case where the engine reports no legal moves, `let result = 0;` is declared but never read. The actual result assignment happens via `s.result = 0` in the loop below. The variable is a leftover from a previous refactor.
- **Fix suggestion:** Remove `let result = 0;` line.

---

### BUG: Unused component — GameTimer.jsx defined but never imported or rendered
- **Severity:** cosmetic
- **Location:** client/src/components/GameTimer.jsx
- **Description:** `GameTimer` is a fully implemented React component (renders elapsed time, handles start/stop/gameOver) but is never imported by any parent component. No file in the project imports `GameTimer`. This is dead code in the client bundle.
- **Fix suggestion:** Either integrate GameTimer into the game UI (e.g., show elapsed time during gameplay) or delete the file.

---

### BUG: Unused import in Board.jsx — CONFIG.board.animation.easeOut never used
- **Severity:** cosmetic
- **Location:** client/boardConfig.js:16, client/src/components/Board.jsx
- **Description:** `boardConfig.js` exports `animation: { stepDurationMs: 200, easeOut: true }`. Board.jsx uses `STEP_DURATION_MS` from `CONFIG.board.animation.stepDurationMs` but never reads `CONFIG.board.animation.easeOut`. The `easeOut` flag controls nothing — the animation uses a hardcoded ease-out formula `1 - (1-t)^2` regardless.
- **Fix suggestion:** Either use the `easeOut` flag to select between ease-out and linear animation, or remove it from the config.

---

### BUG: `handleStartPvai` doesn't emit `stopSelfPlay` — self-play continues behind PvAI game
- **Severity:** cosmetic
- **Location:** client/src/App.jsx:255-268 (handleStartPvai)
- **Description:** When starting a PvAI game, `handleStartPvai` emits `startGame` with mode `pvai`. The server's `startGame` handler calls `trainer.stop()` if self-play is running. But the client-side state is not synced: `setSelfPlayActive(false)` is called locally, but the server's `selfPlayStatus` event with `active: false` may arrive AFTER the `state` event for the new game. If a timing issue causes `selfPlayStatus` to be missed, the server shows self-play as stopped but the client's `selfPlayActiveRef` might be out of sync. This is very unlikely in practice.
- **Fix suggestion:** After emitting `startGame`, also emit `stopSelfPlay` explicitly. Or wait for `selfPlayStatus` confirmation before transitioning to PvAI mode.

---

### BUG: Board animation — prevBoardRef updated synchronously inside effect, causing stale check
- **Severity:** cosmetic
- **Location:** client/src/components/Board.jsx:107-132 (board change detection effect)
- **Description:** The board-change detection effect stores `prevBoardRef.current = board` at line ~120 (after using `prev` for animation). This means on the SAME render where `board` changed, `prevBoardRef.current` is already updated to the NEW board. The cleanup return function (line ~132) cancels RAF, but `prevBoardRef.current` is already the new board. On the NEXT render (e.g., from `forceUpdate` in animation), `board === prevBoardRef.current` is true (both are the new board), so `animBoard` is never cleared by the "board changed after animation" branch. The only mechanism clearing `animBoard` is the explicit `if (animBoard) setAnimBoard(null)` at line ~118, which works correctly. This is a code smell (the stale-ref check is dead logic) but doesn't cause visible bugs because the explicit clear handles it.
- **Fix suggestion:** Remove the dead `board === prevBoardRef.current` check branch, since `animBoard` is already cleared at line ~118 when animation is done.

---

### Summary

| Severity | Count |
|----------|-------|
| Critical | 2     |
| Important | 7    |
| Cosmetic | 5     |
| **Total** | **14** |

### Top Impact Findings

1. **CONFIG mutation race** — multiple clients can corrupt shared config state
2. **calcThreat double-counting** — reward signal is inaccurate, degrading AI training
3. **Loss clamping** — model can't learn temporal reward differences (winning sooner = winning later)
4. **minimax ignores config weights** — strategy tuning UI is non-functional for minimax
5. **aiMoveDelayMs not clamped in setParams** — client can freeze UI with absurd delay values
6. **modelParams accumulates stale keys** — long-running sessions accumulate configuration cruft
7. **Optimistic self-play toggle** — client state can desync permanently from server
