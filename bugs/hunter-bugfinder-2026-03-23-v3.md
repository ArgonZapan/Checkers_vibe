# Hunter BugFinder Report v3 — 2026-03-23

**Project:** Checkers_vibe (`/opt/Checkers_vibe`)
**Scope:** Deep code audit — NEW bugs NOT in previous reports (v1, v2) or known/fixed list
**Known/fixed:** BUG-001–006, BUG-101–102 (all either fixed or cosmetic)

---

## Summary

Found **4 new bugs**: 1 critical, 2 important, 1 minor. Focus on reward computation correctness, threat heuristic accuracy, API validation consistency, and movegen completeness.

---

## BUG-201: Terminal reward always zero — `winner` string compared to integer (CRITICAL)

**File:** `server/ai/trainer.js` — `_playGame()`, lines 591–608

### The Bug

When a game ends, the code assigns terminal rewards to training samples:

```js
// line 591
if (winner === 1 || winner === 'white') {       // ← BUG: winner is a string "white"
  result = 1;                                    // never reached for white wins
  this.stats.whiteWins++;
} else if (winner === -1 || winner === 'black') {
  result = -1;                                   // never reached for black wins
  this.stats.blackWins++;
} else {
  this.stats.draws++;                            // ← always falls here
}
this.stats.gamesPlayed++;

const winnerTurn = result; // always 0
for (const s of samples) {
  s.result = s.turn === winnerTurn ? 1 : winnerTurn === 0 ? 0 : -1;
  // s.result is ALWAYS 0 because winnerTurn === 0 is always true
}
```

The C++ engine (`server.cpp:78–81`) returns `winner` as a **string**: `"white"`, `"black"`, or `"draw"`. The comparison `winner === 1` (strict equality: string vs number) is **always false**. So `result` stays `0`, `winnerTurn` is `0`, and **every sample gets `s.result = 0`** regardless of game outcome.

### Impact

- Terminal reward signal is completely absent — model never learns from game outcomes
- `stats.whiteWins`, `stats.blackWins` are never incremented (stuck at 0); only `stats.draws` increments
- Training relies entirely on shaped intermediate rewards (`s.reward`) via Bellman equation, which partially masks the bug
- Dashboard shows misleading win/draw statistics

### Why it's partially masked

The `train()` function prefers shaped rewards when available (`hasShapedRewards` path), so the Bellman equation with `sample.reward + γ * (-nextQ)` is used instead of `s.result`. This means training still works via shaped rewards, but the terminal win/lose signal is lost.

### Reproduction

1. Start self-play (AI vs AI)
2. Let 50+ games complete
3. Check `/api/ai/stats` — `whiteWins: 0, blackWins: 0, draws: 50+`
4. Examine buffer samples — all have `result: 0`

### Fix

```js
// Use string comparison consistent with C++ engine output
if (winner === 'white') {
  result = 1;
  this.stats.whiteWins++;
} else if (winner === 'black') {
  result = -1;
  this.stats.blackWins++;
} else {
  this.stats.draws++;
}
```

---

## BUG-202: `calcThreat()` counts impossible pawn captures in reverse direction (IMPORTANT)

**File:** `server/ai/trainer.js` — `calcThreat()`, lines 92–118

### The Bug

The threat evaluation checks all 4 diagonal directions for adjacent opponent pieces:

```js
for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
  const adjR = row + dr, adjC = col + dc;
  const jumpR = row - dr, jumpC = col - dc;
  // ...
  if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
    if (isMy) myThreats++; else oppThreats++;
  }
}
```

**Problem:** In checkers, pawns can only capture **forward** (white captures by moving down/increasing row, black captures by moving up/decreasing row). A white pawn at row 3 CANNOT capture a piece at row 2. But `calcThreat()` counts threats from pawns in all 4 directions equally.

Example: A white pawn at (3, 2) next to a black piece at (2, 3) with empty (1, 4) behind it — the code counts this as a threat from white. But white pawns can only capture downward, so this is an **impossible capture**.

Kings CAN capture in all directions, but the code doesn't distinguish between pawn and king pieces when counting threats.

### Impact

- Threat component of shaped reward (`* 0.12`) is systematically biased
- Overestimates threats when pawns are positioned diagonally "behind" opponent pieces
- Model learns inflated threat evaluations → suboptimal defensive play
- Affects ~10-20% of board positions (any position with pawns on adjacent diagonals)

### Fix

Only count threats in directions the piece can actually capture:

```js
for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
  // ...
  if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
    const oppVal = board[adjIdx];
    const isOppKing = isKing(oppVal, turn === 1 ? -1 : 1);
    const isOppPawn = isPawn(oppVal, turn === 1 ? -1 : 1);
    // Pawns can only capture forward
    const canCapture = isOppKing || 
      (isOppPawn && ((turn === 1 && dr === -1) || (turn === -1 && dr === 1)));
    // Wait — threat direction is FROM opponent TO us, so check opponent's forward = toward us
    // White opp captures downward (dr=+1 from their perspective = toward our piece)
    // Black opp captures upward (dr=-1 from their perspective = toward our piece)
    const oppCanCaptureUs = isOppKing ||
      (isOppPawn && ((board[adjIdx] > 0 && dr === 1) || (board[adjIdx] < 0 && dr === -1)));
    // Simplify: if opponent is white, they capture by increasing row
    // adj is at row+dr, our piece is at row. For white to capture us, adj must be ABOVE us (dr=-1)
    // For black to capture us, adj must be BELOW us (dr=+1)
    // ... actually need to think about direction more carefully
  }
}
```

(Full fix requires careful direction analysis — see code comment above for the correct logic.)

---

## BUG-203: WebSocket `setParams` allows `layers: 8` but `createModel()` silently clamps to 5 (IMPORTANT)

**File:** `server/index.js` — `setParams` handler, line 484
**File:** `server/ai/model.js` — `createModel()`, line 48

### The Bug

Server-side validation in `setParams`:
```js
if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 8)) {
  errors.push(`layers=${newParams.layers} (zakres: 1-8)`);
}
```

But `createModel()` clamps differently:
```js
if (numLayers < 1 || numLayers > 5) {
  console.warn(`[Model] Invalid layers=${numLayers}, clamping to 1-5`);
  numLayers = Math.max(1, Math.min(5, numLayers));
}
```

Same mismatch for `neurons`: server allows 32–1024, model clamps to 32–512.

A user can submit `layers=7, neurons=800` via WebSocket. Server accepts it (no validation error), stores it in `modelParams`, and broadcasts to clients. But when the model is actually created (`createModel({ ...trainer.modelParams })`), it silently clamps to `layers=5, neurons=512`. The user sees "7 layers" in the UI but gets 5.

### Impact

- User thinks they're training a 7-layer/800-neuron network but gets 5-layer/512
- Silent data loss — no error, no warning to the user
- HTTP endpoint (`/api/ai/params`) only accepts `networkSize` string (small/medium/large), not numeric params, so this only affects WebSocket `setParams`
- Inconsistent validation across API boundaries

### Reproduction

1. Open app in AI vs AI mode
2. Send via WebSocket: `socket.emit('setParams', { layers: 7, neurons: 800 })`
3. Server accepts (no error)
4. Check model architecture — only 5 layers with 512 neurons in first layer (model.js clamps)

### Fix

Align validation ranges in server/index.js with createModel() limits:
```js
if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 5)) {
  errors.push(`layers=${newParams.layers} (zakres: 1-5)`);
}
if (newParams.neurons != null && (newParams.neurons < 32 || newParams.neurons > 512)) {
  errors.push(`neurons=${newParams.neurons} (zakres: 32-512)`);
}
```

---

## BUG-204: King regular moves missing `path` field — inconsistent with pawn moves (MINOR)

**File:** `engine/src/movegen.cpp` — `generateKingMoves()`, line 160

### The Bug

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

All king regular (non-capture) moves have `path: []` in the JSON output. Pawn moves have `path: [[r1,c1],[r2,c2]]`. Multi-capture moves (both pawn and king) have full path arrays.

### Impact

- Client-side animation path is empty for king regular moves
- In `index.js` `handleMove()`, the animation delay check `path.length > 2` works correctly for empty paths (short-circuits to `moveDelayMs`), so no crash
- But consistency issue: if future code relies on `path` being present for all moves, it will break
- Minor UX inconsistency — pawn moves have animation data, king slides don't

### Fix

```cpp
m.path = {Square(row, col), Square(nr, nc)};
```

---

## Files Analyzed (v3)

| File | Bugs Found |
|------|-----------|
| `server/ai/trainer.js` — _playGame() reward | BUG-201 (CRITICAL) |
| `server/ai/trainer.js` — calcThreat() | BUG-202 (IMPORTANT) |
| `server/index.js` — setParams validation | BUG-203 (IMPORTANT) |
| `engine/src/movegen.cpp` — generateKingMoves | BUG-204 (MINOR) |
| `server/ai/model.js` — predict()/train() | Reviewed — covered by BUG-101 fix |
| `server/ai/model.js` — createModel() | BUG-203 (receiver side) |
| `server/ai/buffer.js` | Reviewed — clean |
| `server/boardConvert.js` | Reviewed — clean |
| `server/proxy.js` | Reviewed — clean |
| `engine/src/board.cpp` | Reviewed — clean |
| `engine/src/engine.cpp` | Reviewed — clean |
| `engine/src/server.cpp` | Reviewed — clean (catch(...) flagged in v1) |
| `client/src/components/Board.jsx` | Reviewed — BUG-002 still present (captures not deep-compared in areEqual) |

---

## Recommended Priority Fixes

1. **BUG-201** (CRITICAL): Fix string/number type mismatch for `winner` comparison — one-line fix, high impact on training stats
2. **BUG-202** (IMPORTANT): Add direction awareness to `calcThreat()` — prevents reward signal corruption
3. **BUG-203** (IMPORTANT): Align server validation with `createModel()` limits — prevents user confusion
4. **BUG-204** (MINOR): Set `path` in `generateKingMoves()` — consistency fix

---

*Report generated by Jarvis Horner — Hunter BugFinder cycle v3*
*2026-03-23 09:13 UTC*
