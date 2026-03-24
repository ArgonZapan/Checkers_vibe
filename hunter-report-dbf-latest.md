# Hunter Report — Dynamic Bug Finder (hunter-sub-dbf)
**Date:** 2026-03-24 04:42 UTC  
**Cycle:** Hunter Alpha — Fix Phase  
**Commit:** `fefea73` — `fix: calcThreat double-counting and value clamp range (hunter-sub-dbf)`

---

## Bugs Fixed

### BUG 1: calcThreat double-counts threats
- **File:** `server/ai/trainer.js` ~lines 97-128
- **Severity:** Krytyczny
- **Root cause:** The inner loop condition `!isOwnPiece(board[adjIdx], turn)` was shared for both `isMy=true` and `isMy=false` branches. When iterating an opponent piece (`isMy=false`), the check `!isOwnPiece(adj, turn)` means "adjacent piece is NOT mine" — i.e., it could be another opponent piece or empty. This counted "opponent threatening opponent" as `oppThreats`, inflating the opponent threat score.
- **Fix:** Split the logic into two distinct branches:
  - `isMy=true`: Check if opponent at adjIdx can capture my piece (original logic preserved)
  - `isMy=false`: Check if **my** piece at adjIdx can capture the opponent piece (condition flipped to `isOwnPiece(board[adjIdx], turn)`, direction validation also inverted since we're checking my pawn's capture direction, not the opponent's)
- **Impact:** Threat calculation now correctly reflects only meaningful captures from each player's perspective.

### BUG 2: Value clamp [-1,1] flattens temporal reward differentiation
- **File:** `server/ai/model.js` ~line 399
- **Severity:** Krytyczny
- **Root cause:** Bellman target clamped to `[-1, 1]` with `Math.max(-1, Math.min(1, valueTarget))`. With `GAMMA=0.95` and `rewardWin=1.0`, a position winning in 2 moves has Q ≈ 1.95, clamped to 1.0. The model can't distinguish "win now" from "win in 2 moves" — both look like 1.0.
- **Fix:** Widened clamp range to `[-3, 3]`, which covers the realistic Q-value range with GAMMA=0.95 and reward values. This preserves temporal discounting: faster wins yield higher Q-values.
- **Impact:** Model can now learn to prefer faster victories over slower ones.

---

## Test Results

| Phase | Passed | Failed | Notes |
|-------|--------|--------|-------|
| Before fix | 3408 | 5 | 5 pre-existing failures (ws-origin, rate-limit) |
| After fix | 3408 | 5 | Same 5 pre-existing failures, **no regressions** |

All pre-existing failures are in `hunter-tw-ws-origin-rate` tests — unrelated to trainer.js or model.js changes.

---

## Files Changed

1. `server/ai/trainer.js` — calcThreat restructured (separated isMy/isEnemy branches)
2. `server/ai/model.js` — valueTarget clamp widened to [-3, 3]
