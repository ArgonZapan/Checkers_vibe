# Hunter Bug Report — Animation Issues #137 & #138
**Date:** 2026-03-23
**Scope:** `client/src/components/Board.jsx`, `client/src/index.css`, `server/index.js`, `config.js`
**Issues:** #137 (CSS transition/SVG transform conflict), #138 (wrong animation offset direction)

---

## Context — Existing Fix Attempts

Git history shows two prior fix attempts:

1. **`d56c4f9`** — Flipped offset direction from `(e.c - np.c)` to `(np.c - e.c)`. **This was WRONG** — it would cause backwards animation. Reverted in `93ff25d`.
2. **`93ff25d`** — Reverted offset back to correct `(e.c - np.c)` and added `className="piece"` to `<g>` elements.
3. **`2cd1559`** — Changed `button { transition: all 0.15s }` to explicit property list, added `.piece { transition: none; }` in CSS.

**Current state of offset formula (CORRECT):**
```js
// Board.jsx:180-183
animOffsets[`piece-${np.r}-${np.c}`] = {
  x: (e.c - np.c) * CELL_SIZE,   // e = old (empty) pos, np = new pos
  y: (e.r - np.r) * CELL_SIZE,
};
```

---

## Issue #137: CSS transition / SVG transform conflict

### Verdict: Partially addressed, CSS fix is defensive but harmless

**File:** `client/src/index.css` (lines 100, 159-161)
**File:** `client/src/components/Board.jsx` (line 328)

### Analysis

The animation uses `requestAnimationFrame` (Board.jsx:190-210) to update SVG `transform` **attribute** on `<g>` elements. This is correct — SVG `transform` attribute and CSS `transform` property are separate namespaces in the browser.

**What the existing fix does:**

1. `button { transition: background 0.15s, color 0.15s, ... }` (line 100) — removed `all` from transition. This is good defensive coding. `transition: all` could theoretically cause issues if a browser quirk extended it to SVG children.

2. `.piece { transition: none; }` (line 161) + `className="piece"` on `<g>` (line 328) — explicitly prevents CSS transition on piece elements. **Works correctly** — the class IS present on `<g>` elements.

### Remaining concern

The multi-capture overlay `<g key="multi-cap-piece">` (Board.jsx:399) does **NOT** have `className="piece"`. If CSS transitions ever affect SVG elements, the overlay would be unprotected. Minor risk.

```jsx
// Board.jsx:399 — missing className="piece"
<g key="multi-cap-piece" pointerEvents="none">
```

**Fix:** Add `className="piece"` to the multi-capture overlay `<g>`:
```jsx
<g key="multi-cap-piece" className="piece" pointerEvents="none">
```

### Status: LOW risk — current fix is adequate for normal moves. Overlay is unprotected but unlikely to trigger issues.

---

## Issue #138: Wrong animation direction — piece animates backwards

### Verdict: Real bugs found, but NOT in the single-move offset formula

The single-move offset calculation `(e.c - np.c) * CELL_SIZE` is **CORRECT**. The previous fix attempt (d56c4f9) that flipped it to `(np.c - e.c)` would have CAUSED backwards animation and was correctly reverted.

### Real bugs found:

---

### BUG 138-A: Multi-capture animation has NO smooth movement between steps

**File:** `client/src/components/Board.jsx` (lines 62-108)
**Severity:** MEDIUM — visual quality issue, pieces "teleport" between capture steps

**Problem:**

The multi-capture animation sets `animStep` on a timer but the overlay piece at Board.jsx:395-415 positions instantly at `path[animStep]`:

```jsx
// Board.jsx:395-399 — piece SNAPS to new position, no transition
const px = col * CELL_SIZE + CELL_SIZE / 2;
const py = row * CELL_SIZE + CELL_SIZE / 2;
return (
  <g key="multi-cap-piece" pointerEvents="none">
    <circle cx={px} cy={py} ... />
```

There is no CSS transition or RAF interpolation between steps. The piece appears at `path[0]`, then after `STEP_DURATION_MS` (200ms) it disappears and reappears at `path[1]`, etc.

**Fix:** Apply a CSS transition to the multi-capture overlay, or animate the overlay position with RAF similar to single-move animation:

```css
/* Option A: CSS transition on overlay */
.multi-cap-animated {
  transition: transform 200ms ease-out;
}
```

Or add a `<g>` wrapper with `style={{ transition: 'transform 200ms ease-out' }}` and use CSS `transform: translate()` instead of SVG attributes for the overlay.

---

### BUG 138-B: Promotion case — animation offset calculation fails for pawn→king

**File:** `client/src/components/Board.jsx` (lines 174-186)
**Severity:** MEDIUM — wrong animation during promotion

**Problem:**

The piece-matching algorithm compares `color` AND `king` status:

```js
// Board.jsx:177
if (e.color === np.color && e.king === np.king) {
```

When a pawn promotes to king (reaches last row):
- Old board: `{ color: 'white', king: false }` at position (5, 0)
- New board: `{ color: 'white', king: true }` at position (7, 0)

`e.king === np.king` → `false === true` → **no match for the moving piece!**

The algorithm then matches the new king against ANOTHER white pawn (say at (5, 2)):
```
animOffsets["piece-7-0"] = {
  x: (2 - 0) * 60 = 120,   // piece starts 2 cells to the LEFT
  y: (5 - 7) * 60 = -120,   // piece starts 2 cells UP
}
```

The piece animates from a WRONG starting position. Visually, another pawn "jumps" to the promotion square while the actual promoting pawn doesn't animate at all (it was in `empties` but never matched).

**Example scenario:**
```
Before: white pawn at (5,0), white pawn at (5,2)
After:  white king at (7,0), white pawn at (5,2)
Match:  king(7,0) matched with pawn(5,2) → offset = (2,-2) cells
Expected: king(7,0) matched with empty(5,0) → offset = (0,2) cells (down 2 rows)
```

**Fix:** Relax the matching condition for promotion, or detect promotion separately:

```js
// Option: match by color only, treat king status change as promotion
if (e.color === np.color && (!e.king || e.king === np.king)) {
  animOffsets[`piece-${np.r}-${np.c}`] = {
    x: (e.c - np.c) * CELL_SIZE,
    y: (e.r - np.r) * CELL_SIZE,
  };
  empties.splice(i, 1);
  break;
}
```

Or better, match first by color+king, then fall back to color-only for unmatched pieces.

---

### BUG 138-C: Server/client animation duration mismatch

**File:** `config.js` (lines 26, 42-45), `server/index.js` (line ~172)
**Severity:** LOW — timing race condition

**Problem:**

The client uses `CONFIG.board.animation.stepDurationMs` = **200ms** per step:
```js
// Board.jsx:6
const STEP_DURATION_MS = CONFIG.board.animation.stepDurationMs; // 200ms
```

The server uses `CONFIG.animationStepDurationMs` = `Math.floor(500 / 2)` = **250ms**:
```js
// config.js:44
get animationStepDurationMs() {
  return Math.floor(this.moveDelayMs / 2); // 250ms
}
```

The server computes animation delay before sending AI move:
```js
// server/index.js — handleMove, PvAI flow
const animDelay = (playerPath && playerPath.length > 2)
  ? playerPath.length * animStepMs + CONFIG.moveDelayMs  // 250ms * steps
  : CONFIG.moveDelayMs;
await new Promise(r => setTimeout(r, animDelay));
```

For a 3-step multi-capture: server waits `3 * 250 + 500 = 1250ms`, but client animation takes `3 * 200 = 600ms`. The extra 650ms is OK (client finishes before AI move arrives). But if `moveDelayMs` is 0 (fast mode), server waits only `3 * 250 = 750ms` while client takes 600ms — still OK.

**When it breaks:** If `speedMode === 'fast'`, `animationStepDurationMs` returns 0, and `moveDelayMs` returns 0. The server sends the AI move with NO delay. The client's multi-capture animation gets interrupted by the new board state.

```js
// config.js:42-43 — fast mode returns 0
get animationStepDurationMs() {
  if (this.server.speedMode === 'fast') return 0;
```

**Fix:** Either:
1. Use `CONFIG.board.animation.stepDurationMs` consistently on both server and client
2. Or have the server send animation duration in the state payload so the client uses it

---

### BUG 138-D: Post-multi-capture single-move animation may fire with wrong state

**File:** `client/src/components/Board.jsx` (lines 113-210)
**Severity:** LOW — edge case, currently mitigated by timing

**Problem:**

When multi-capture completes:
1. `setAnimStep(-1)` + `setAnimBoard(null)` — React batches both
2. Next render: `displayBoard = board` (regular board), `animStep = -1`
3. Animation effect (line 113) fires: `animStep >= 0` is false → proceeds
4. `prevBoardRef` was NOT updated during multi-capture (effect was skipped because `animStep >= 0`)
5. Effect compares `prevBoardRef` (pre-animation) with `board` (post-animation)
6. All captures + move show as changes → single-move animation starts

This causes a secondary animation AFTER multi-capture finishes. The piece smoothly slides from old to new position (covering the entire multi-capture distance in one motion). This can look like "backwards" movement if the piece was at an intermediate position.

**Currently mitigated by:** The `board` state usually arrives AFTER the multi-capture timeout clears. In that case, `prevBoardRef` was already updated to the final board, and the animation detects no changes.

**When it breaks:** If the final board state arrives BEFORE `clearAnimTimer` fires, `prevBoardRef` is set to the final board during one of the skipped effect runs. Then when animation clears, no changes are detected. This is actually correct behavior. The bug only manifests if the board arrives between step timers.

**Fix:** Add a flag to explicitly skip the single-move animation after multi-capture:
```js
// After multi-capture clears
const clearTimer = setTimeout(() => {
  setAnimStep(-1);
  setAnimBoard(null);
  prevBoardRef.current = board.map((row) => [...row]); // sync to prevent secondary animation
}, STEP_DURATION_MS);
```

---

## Summary

| Bug | File | Line(s) | Severity | Status |
|-----|------|---------|----------|--------|
| #137 (overlay unprotected) | Board.jsx | 399 | LOW | Fix trivial |
| 138-A (no smooth multi-cap) | Board.jsx | 395-415 | MEDIUM | Needs fix |
| 138-B (promotion mismatch) | Board.jsx | 177 | MEDIUM | Needs fix |
| 138-C (duration mismatch) | config.js | 42-45 | LOW | Needs fix |
| 138-D (post-multi-cap animation) | Board.jsx | 206-209 | LOW | Edge case |

## Are the bugs related?

**Yes, partially:**
- **138-A and 138-D** are connected — fixing the multi-capture animation (138-A) would also eliminate the need for the secondary animation guard (138-D).
- **138-B** is independent — it's a matching logic issue that affects any promotion, not just multi-capture.
- **138-C** is independent — it's a server/client configuration mismatch.
- **#137** is independent — it's a CSS concern, already mostly addressed.

**Recommended fix order:** 138-B → 138-A → 138-C → 138-D → #137 overlay
