# Hunter Bug Report v2 — Checkers_vibe

**Date:** 2026-03-23
**Scope:** Server AI (trainer, model, minimax), client (App, Board)
**Previous report:** `hunter-bugReport.md` (13 bugs)
**Focus:** Logic bugs, reward shaping, minimax correctness

---

## BUG-V2-001: calcThreat reward signal is inverted (own vs opponent threats swapped)

- **Location:** `server/ai/trainer.js:calcThreat()` (lines ~108-111)
- **Description:** When iterating over board pieces, the function detects pieces adjacent to the current `board[i]` that could capture it. The `isMy` flag indicates whether `board[i]` belongs to the current player. But the counter increment is wrong:
  - When `isMy` is true (MY piece is threatened by opponent), the code increments `oppThreats` — should be `myThreats`
  - When `isMy` is false (OPPONENT piece is threatened by my piece), the code increments `myThreats` — should be `oppThreats`
  Both counters are swapped. Since the return formula is `(oppThreats - myThreats) / max(...)`, the actual computed value is `(myThreats - oppThreats)` — the OPPOSITE of the intended signal. This means the reward function penalizes the player for having threats against the opponent and rewards them for being threatened.
- **Severity:** **Important** — inverted reward signal biases DQN training
- **Fix:** Swap the counter increments so `isMy → myThreats++` and `!isMy → oppThreats++`

## BUG-V2-002: calcAdvance pawn advancement direction is inverted for both colors

- **Location:** `server/ai/trainer.js:calcAdvance()` (lines ~88-95)
- **Description:** C++ engine starting positions: white at rows 0-2 (promotes at row 7, forward = increasing row), black at rows 5-7 (promotes at row 0, forward = decreasing row). The function uses:
  - White: `adv = (7 - row) / 7` → gives 1.0 at row 0 (starting position!) and 0.0 at row 7 (promotion row!). Completely backwards.
  - Black: `adv = row / 7` → gives 0.0 at row 0 (promotion row!) and 1.0 at row 7 (starting position!). Completely backwards.
  The reward signal tells pawns to retreat toward their starting rows instead of advancing toward promotion.
- **Severity:** **Important** — reward teaches pawns to move backward
- **Fix:** White: `adv = row / 7`, Black: `adv = (7 - row) / 7`

## BUG-V2-003: Minimax evaluate() pawn advancement direction is inverted for both colors

- **Location:** `server/ai/minimax.js:evaluate()` (lines ~31-33)
- **Description:** Same directional inversion as BUG-V2-002 but in the minimax static evaluation:
  - White: `advance = (7 - row)` → gives 7 at row 0 (starting position), 0 at row 7 (promotion). Backwards.
  - Black: `advance = row` → gives 0 at row 0 (promotion), 7 at row 7 (starting position). Backwards.
  Combined with BUG-V2-004, the minimax AI moves pawns backward AND only in the wrong direction. Minimax is completely broken for pawn movement.
- **Severity:** **Critical** — minimax evaluation is directionally wrong, combined with BUG-V2-004 makes minimax unusable
- **Fix:** White: `advance = row`, Black: `advance = 7 - row`

## BUG-V2-004: Minimax generateLegalMoves pawn direction is reversed for both colors

- **Location:** `server/ai/minimax.js:generateLegalMoves()` (lines ~95-98) and `_extendCapture()` (lines ~161-164)
- **Description:** C++ engine: white at rows 0-2, moves forward = increasing row (toward row 7). Black at rows 5-7, moves forward = decreasing row (toward row 0). The code:
  - White skips `dr > 0` (downward/increasing row) → white only moves `dr < 0` (upward/decreasing row). WRONG — white should move `dr > 0`.
  - Black skips `dr < 0` (upward/decreasing row) → black only moves `dr > 0` (downward/increasing row). WRONG — black should move `dr < 0`.
  Pawns literally cannot reach their promotion row with this logic. The minimax AI can never promote a pawn.
- **Severity:** **Critical** — minimax pawn movement is fundamentally broken
- **Fix:** White: skip `dr < 0` (move increasing row). Black: skip `dr > 0` (move decreasing row).

## BUG-V2-005: Minimax promotion row check is reversed for both colors

- **Location:** `server/ai/minimax.js:applyMove()` (lines ~60-64)
- **Description:** Promotion logic:
  - White: `(turn === 1 && toRow === 0)` → promotes at row 0. WRONG — white promotes at row 7.
  - Black: `(turn === -1 && toRow === 7)` → promotes at row 7. WRONG — black promotes at row 0.
  Combined with BUG-V2-004 (wrong movement direction), pawns can never promote in the minimax simulation.
- **Severity:** **Critical** — minimax can never produce king promotions
- **Fix:** White promotes at `toRow === 7`, Black promotes at `toRow === 0`

## BUG-V2-006: predict() bestIdx can be undefined when cumulative probability doesn't trigger

- **Location:** `server/ai/model.js:predict()` (lines ~213-218)
- **Description:** The sampling loop `for (const idx of legalIndices) { cumulative += ...; if (r <= cumulative) { bestIdx = idx; break; } }` may never trigger if `r` is exactly 1.0 and floating-point `cumulative` is slightly less than 1.0 due to rounding. In that case `bestIdx` stays as `legalIndices[0]` (initialized on line 212). This is harmless due to the fallback, but there's no warning logged. More importantly, the `selectedMove` lookup on line 221 uses `bestIdx` which could be just the first index — silently degrading model quality without any log message.
- **Severity:** **Cosmetic** — silent degradation, no crash, but masks a sampling edge case
- **Fix:** After the loop, add: `if (bestIdx === undefined) { console.warn('[predict] bestIdx undefined after sampling, r=${r}, cumulative=${cumulative}'); bestIdx = legalIndices[legalIndices.length - 1]; }`

## Summary

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| BUG-V2-001 | **Important** | Trainer/Reward | calcThreat own/opponent threat counters swapped |
| BUG-V2-002 | **Important** | Trainer/Reward | calcAdvance pawn direction inverted for both colors |
| BUG-V2-003 | **Critical** | Minimax | evaluate() pawn advancement direction inverted |
| BUG-V2-004 | **Critical** | Minimax | generateLegalMoves pawn direction reversed |
| BUG-V2-005 | **Critical** | Minimax | Promotion row check reversed |
| BUG-V2-006 | **Cosmetic** | Model | predict() silent bestIdx fallback |

**Total: 3 critical, 2 important, 1 cosmetic**
