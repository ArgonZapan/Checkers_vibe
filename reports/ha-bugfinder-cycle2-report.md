# Hunter-Alpha Bug Finder — Cycle 2 Report

**Agent:** hunter-sub-001 (dynamic-bug-finder)  
**Date:** 2026-03-23  
**Baseline commit:** e2196b7 (HEAD — no new commits since baseline)  
**Scope:** server/index.js, server/ai/trainer.js, server/ai/model.js, server/proxy.js, server/boardConvert.js, client/src/

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 2     |
| Medium   | 1     |
| Low      | 2     |
| **Total**| **5** |

---

## BUG-C2-001: Resource Leak — Old TF.js Models Not Disposed in `/api/ai/params`

- **Severity:** High
- **File:** server/index.js
- **Lines:** 174, 177
- **Category:** Resource leak

**Description:**  
The `/api/ai/params` endpoint creates new TensorFlow.js models via `createModel()` but never calls `.dispose()` on the old models before reassigning:

```javascript
trainer.modelWhite = createModel({ ...trainer.modelParams });
trainer.modelBlack = createModel({ ...trainer.modelParams });
```

Each TF.js model holds GPU/CPU tensors, optimizer state, and layer weights. Without disposal, old model memory accumulates with every params change. The trainer class has `_replaceModel()` which properly disposes before creating, but this endpoint bypasses it.

**Suggestion:**  
Replace with `trainer._replaceModel()` or call `.dispose()` explicitly:
```javascript
trainer.modelWhite = trainer._replaceModel(trainer.modelWhite, { ...trainer.modelParams });
trainer.modelBlack = trainer._replaceModel(trainer.modelBlack, { ...trainer.modelParams });
```

---

## BUG-C2-002: Resource Leak — Old TF.js Models Not Disposed in `socket.on('restart')`

- **Severity:** High
- **File:** server/index.js
- **Lines:** 578, 579
- **Category:** Resource leak

**Description:**  
Same pattern as BUG-C2-001 in the WebSocket `restart` handler:

```javascript
trainer.modelWhite = createModel({ ...trainer.modelParams });
trainer.modelBlack = createModel({ ...trainer.modelParams });
```

Old models are orphaned without disposal. In aivai mode where `restart` might be called repeatedly, this leaks TF.js model memory each time.

**Suggestion:**  
Use `trainer._replaceModel()` or call `oldModel.dispose()` before reassignment.

---

## BUG-C2-003: Client Turn State Not Updated When Server Sends Falsy Turn

- **Severity:** Medium
- **File:** client/src/App.jsx
- **Lines:** ~175 (state event handler)
- **Category:** Edge case crash / state desync

**Description:**  
The state event handler only updates turn when the value is truthy:

```javascript
if (data.turn) setTurn(data.turn);
```

If the C++ engine sends `turn: 0` (e.g., at game over, or an unexpected state), the client's turn is **not** updated and remains at its previous value (`'white'` or `'black'`). This creates a desynchronized state where the UI indicates it's someone's turn to move when the game may actually be over or in an indeterminate state.

The server-side `turnToColor()` function defaults to `'white'` when turn is 0, but the client gate prevents this from propagating.

**Suggestion:**  
Change to: `if (data.turn !== undefined) setTurn(data.turn);`

---

## BUG-C2-004: Dead Code — Unused `result` Variable in Normal Game-Over Block

- **Severity:** Low
- **File:** server/ai/trainer.js
- **Line:** 641
- **Category:** Dead code

**Description:**  
In the normal game-over handling of `_playGame`, a `result` variable is computed but never used:

```javascript
let result = 0;
if (winner === 'white') {
  result = 1;        // ← never read
  this.stats.whiteWins++;
} else if (winner === 'black') {
  result = -1;       // ← never read
  this.stats.blackWins++;
} else {
  this.stats.draws++;
}
```

The numeric `result` was likely intended for sample assignment, but the code below assigns results using the `winner` string directly (`winnerVal = winner === 'white' ? 1 : -1`), making this variable dead code.

**Suggestion:**  
Remove the `result` variable and its assignments. The stats are updated directly via `this.stats.*Wins++` and sample results are assigned via `winnerVal` comparison.

---

## BUG-C2-005: Dead Code — Unused `result` Variable in No-Legal-Moves Block

- **Severity:** Low
- **File:** server/ai/trainer.js
- **Line:** 715
- **Category:** Dead code

**Description:**  
In the no-legal-moves force-draw path of `_playGame`:

```javascript
let result = 0;
this.stats.draws++;
this.stats.gamesPlayed++;
```

The `result` variable is declared, assigned 0, and never referenced. The stats update (`this.stats.draws++`) is the actual work. This is a copy-paste artifact from the normal game-over block above.

**Suggestion:**  
Remove `let result = 0;` — it serves no purpose.

---

## Analysis Notes (No Bugs Found)

- **Race conditions:** The `_moveQueue` promise chain per-socket correctly serializes moves. The `paramsVersion` guard in `_playGame` prevents stale-game writes after model reset. No exploitable races detected.
- **server/proxy.js:** Clean — error handler checks `res.headersSent` before writing, body re-serialization is conditional on `req.body` existing.
- **server/boardConvert.js:** Clean — comprehensive null/type/length validation in both `boardFromCpp` and `boardToCpp`.
- **server/ai/model.js:** Clean — tensor disposal in `predict()` and `train()` uses proper `try/finally` blocks. `saveModel()` uses atomic write with tmp+rename.
- **server/ai/buffer.js:** Clean — handles ENOENT and malformed JSON gracefully in `load()`.
- **Input validation (server/index.js):** `/api/ai/predict` validates board array elements (integer 0-4 check). `/api/ai/train` validates batch structure. WebSocket `move` handler validates coordinate ranges and capture elements.
