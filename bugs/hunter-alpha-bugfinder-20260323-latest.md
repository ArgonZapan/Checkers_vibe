# Hunter Alpha — Dynamic Bug Finder Report
**Date:** 2026-03-23 20:54 UTC  
**Target:** /opt/Checkers_vibe  
**Scope:** server/index.js, server/ai/trainer.js, server/ai/model.js, server/proxy.js  

---

## Test Results

```
npm test — ALL PASSED (0 failures)
```

Full test suite breakdown:
- SaveState/LoadState Edge Cases: 8 ✅
- calculateReward Edge Cases: 8 ✅
- _playGame Game-Over Logic: 10 ✅
- resetModel Cleanup Logic: 4 ✅
- aiMove Fallback Chain: 7 ✅
- handleMove Animation Delay: 6 ✅
- Client EMPTY_BOARD Construction: 7 ✅
- handleCellClick Selection Logic: 10 ✅
- Board Conversion Tests: 16 ✅
- WebSocket Move Validation: 43 ✅
- WebSocket setSpeed Validation: 26 ✅
- Draw Detection: 4 ✅ + 2 TODO (C++ engine, not Node.js)
- Trainer Policy Fix (#121, #122): 27 ✅
- Trainer Logic Tests: 42 ✅
- Board Set Lookup: 9 ✅
- Predict Masking: 9 ✅
- WebSocket Handler Tests: 49 ✅
- Trainer _playGame Tests: 35 ✅
- computePolicyIndex: 19 ✅
- Train Import: 7 ✅
- Board areEqual (captures): 23 ✅
- Config Speed Helpers: 20 ✅
- Trainer Reward Helpers: 29 ✅
- Color/Turn Conversion: 27 ✅
- WebSocket Handler Logic: 45 ✅
- Model Validation: 48 ✅
- Trainer Array Moves: 23 ✅
- ReplayBuffer: 16 ✅
- Auto-Save Logic: 17 ✅
- API Endpoint Validation: 22 ✅
- WebSocket Connection Lifecycle: 14 ✅
- Proxy Logic: 18 ✅
- Issues #132, #133, #134: 22 ✅
- Issue #129 (terminal reward string vs int): 21 ✅
- Issue #130 (computePolicyIndex vs 48-unit): 16 ✅
- Issue #131 (auto-save dirty flag): 18 ✅
- Board Convert Edge Cases: 35 ✅
- setSpeedMode Handler: 30 ✅
- AI Move Prediction Fallback: 32 ✅
- cppFetch Logic: 27 ✅
- Reset Handler: 28 ✅
- King Moves Path: 14 ✅
- Hunter Coverage Gap: 58 ✅
- Config AI & Board: 50 ✅
- Rate Limiter: 23 ✅
- Security Headers: 14 ✅
- getGameState Logic: 26 ✅
- AI Fallback Logic: 25 ✅
- SelfPlay State Management: 31 ✅
- Proxy Path Rewrite: 45 ✅
- Trainer Helpers Deep Edge: 39 ✅
- Board Convert Oversized: 25 ✅
- King Multi-Capture & Undo: 36 ✅
- Draw Detection Extra: 19 ✅
- Handle Move Flow: 19 ✅
- AI Move Flow: 14 ✅
- Train Bellman Equation: 19 ✅
- Set Params Whitelist: 24 ✅
- Move Serialization: 28 ✅
- Proxy Body Re-serialization: 29 ✅
- CSP Headers: 17 ✅
- CSP Resilience: 7 ✅
- Resilience Tests: 34 ✅
- CSP Header Content: 12 ✅
- Predict Policy Index: 9 ✅
- Board Round-Trip: 15 ✅
- Auto-Save Race Condition: 11 ✅
- Epsilon Validation Resilience: 11 ✅
- Auto-Save Dirty Snapshot: 16 ✅
- CSP Completeness: 26 ✅
- WS Handler Input Gap: 36 ✅
- Rate Limit Security: 13 ✅
- Hunter Security Fixes: 22 ✅
- Proxy Error Scenarios: 7 ✅
- securityFixes: 10 ✅
- Epsilon Validation Server-Side: 28 ✅
- Predict Policy Index Tests: 9 ✅

**Total: ~1400+ tests, 0 failures**

---

## TODO/FIXME/HACK Markers in Project Source

1. `server/index.js:843` — Comment: `(BUG-003)` — this is a documented design note about dirty flag snapshot behavior during auto-save. NOT an active bug — the code correctly handles this race condition.

---

## Findings

### BUG-001: WebSocket `move` handler missing `from === to` validation
- **Severity:** Important
- **File:** `server/index.js:484-510`
- **Description:** The WebSocket move handler validates coordinate ranges (`0-7`) but does NOT check if `from` equals `to` (no-op move). The `validateMove()` function in `server/ai/trainer.js:269` correctly rejects this case, but it's only used in the self-play loop — not for player-initiated moves via WebSocket.
- **Krok odtworzenia:** Connect via WebSocket, emit `{ from: [3,3], to: [3,3] }` — the handler passes validation and forwards to C++ engine.
- **Impact:** Depends on C++ engine validation. If C++ accepts it, the game state may become inconsistent (no turn change, stale board).
- **Fix:** Add `if (from[0] === to[0] && from[1] === to[1])` check after coordinate validation in WS handler.

### BUG-002: `turnToColor(0)` returns "white" — draw state misrepresented
- **Severity:** Important
- **File:** `server/index.js:267-272`
- **Description:** `turnToColor()` returns `"white"` as default fallback for any unrecognized value, including `0` (which represents a draw). If the C++ engine returns `winner: 0` (numeric) instead of `winner: "draw"` (string), draws would be reported as white wins.
- **Krok odtworzenia:** Trigger a game state where C++ engine returns `{ winner: 0 }` — `getGameState()` converts it via `turnToColor(0)` → `"white"`.
- **Impact:** Player UI shows "White wins!" instead of "Draw". Statistics miscount draws as white wins.
- **Known limitation:** Tests document this behavior (`turnToColor: 0 → "white" (default fallback)`). In practice the C++ engine likely sends string `"draw"` and numeric `0` may never appear. But the defense is fragile.
- **Fix:** Add explicit `if (turn === 0) return "draw"` at the top of `turnToColor()`.

### BUG-003: `predict()` double tensor disposal (cosmetic, TensorFlow.js handles gracefully)
- **Severity:** Cosmetic
- **File:** `server/ai/model.js:265-270`
- **Description:** Tensors (`tensor`, `policyTensor`, `valueTensor`) are disposed both inside the `try` block (before `return`) and again in the `finally` block. TensorFlow.js treats double-dispose as no-op, so no crash — but it's redundant code.
- **Krok odtworzenia:** Call `predict()` — observe tensor `.dispose()` called twice.
- **Impact:** None functional. Code smell only.
- **Fix:** Remove manual disposal in `try` block; rely solely on `finally`.

### BUG-004: Draw detection (40-move rule) delegated to C++ engine — no Node.js fallback
- **Severity:** Important (latent)
- **File:** `server/ai/trainer.js:700-715` (self-play loop)
- **Description:** The self-play loop tracks `moveCount` for the MAX_MOVES safety limit (300 moves) but does NOT track `movesWithoutCapture` for the standard 40-move draw rule. It relies entirely on the C++ engine to set `gameOver: true, winner: "draw"`. If the C++ engine's `/api/board/set` endpoint doesn't reset `movesWithoutCapture_` (as noted in existing TODO), the draw rule may never trigger during self-play.
- **Krok odtworzenia:** Play a self-play game where neither side captures for 40+ moves — C++ engine should return draw, but if it doesn't, game continues until MAX_MOVES=300.
- **Impact:** Self-play games could run 300 moves instead of being properly drawn at 40, wasting training time and producing low-quality samples.
- **Fix:** Add `movesWithoutCapture` counter in `_playGame()`, check for >= 40 before querying C++ engine state.

### NOT-A-BUG: `server.cpp /api/board/set` draw counter (existing TODO)
- Test output notes 2 TODO items about C++ engine features:
  1. `/api/board/set` doesn't reset `movesWithoutCapture_` counter — C++ issue, not Node.js
  2. No `/api/game/undo` HTTP endpoint — C++ feature missing
- These are C++ engine gaps, not Node.js bugs. Already documented.

---

## Security Observations (from code review)

- ✅ Rate limiting: properly implemented (120 req/min, IP-based)
- ✅ CSP headers: no unsafe-eval, no unsafe-inline, frame-ancestors none
- ✅ Input validation: comprehensive on predict, train, move, setParams endpoints
- ✅ Prototype pollution: whitelist in setParams blocks __proto__/constructor
- ✅ Trust proxy: set to false (prevents IP spoofing)
- ✅ No sensitive data leaks in error messages

---

## Summary

| Severity | Count | Descriptions |
|----------|-------|-------------|
| Critical | 0 | — |
| Important | 3 | BUG-001 (from===to), BUG-002 (turnToColor draw), BUG-004 (no Node.js draw counter) |
| Cosmetic | 1 | BUG-003 (double tensor dispose) |

**Verdict:** Codebase is in strong shape — 1400+ tests passing, 0 failures. Found 3 important bugs and 1 cosmetic issue. No critical bugs. The most impactful is BUG-004 (missing draw counter in self-play) which could degrade training quality. BUG-001 and BUG-002 are defense-in-depth gaps that depend on C++ engine validation.
