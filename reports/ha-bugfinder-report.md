# Hunter Alpha — Bug Finder Report (Fresh Scan)

**Date:** 2026-03-23
**Scope:** client/src/*.jsx components, engine/ directory, __tests__/ test files, server/ai/model.js, server/ai/buffer.js, config.js
**Previous scan:** 13 bugs (BUG-001 through BUG-013) in `__tests__/hunter-bugReport.md`
**Focus:** New areas — model save/load, buffer, test-production drift, engine internals, React components

---

### BUG-014: saveModel non-atomic swap — data loss window between rm and rename

- **Severity:** krytyczny
- **Plik:** server/ai/model.js:398-400
- **Opis:** `saveModel()` executes `await rm(dirPath, ...)` then `await rename(tmpDir, dirPath)`. Between these two awaits, if the process crashes or is killed, BOTH the original model AND the tmp directory are gone — complete data loss of a model that may have taken hours to train. The comment acknowledges "rm first because rename cannot overwrite non-empty directories on Linux" but the safety trade-off is wrong.
- **Propozycja fixu:** Atomic swap strategy: rename old dir to `dirPath + '.backup'`, then rename tmp to target, then rm backup. Invariant: at every point in time, at least one complete model copy exists on disk.

---

### BUG-015: Test buffer.test.js sample() uses different algorithm than production

- **Severity:** ważny
- **Plik:** __tests__/buffer.test.js:25-35 vs server/ai/buffer.js:24-34
- **Opis:** The test's `sample()` uses a reservoir-sampling variant that replaces items probabilistically. Production uses Fisher-Yates shuffle then returns first k items. These produce different probability distributions — reservoir sampling has slight bias toward later items. The test validates the wrong algorithm and would miss bugs in production sampling.
- **Propozycja fixu:** Align test's sample() with production: Fisher-Yates shuffle over all items, return first k.

---

### BUG-016: Test buffer.test.js save() doesn't use atomic rename

- **Severity:** ważny
- **Plik:** __tests__/buffer.test.js:62-66
- **Opis:** The test's `save()` writes to tmpPath then writes AGAIN to filePath (double write). Production writes to tmpPath then does `rename(tmpPath, filePath)` (atomic swap). The test doesn't verify the atomic save behavior — if the rename logic in production breaks, the test won't catch it.
- **Propozycja fixu:** Update test's save() to: writeFile(tmpPath) then rename(tmpPath, filePath), matching production.

---

### BUG-017: Test buffer.test.js load() expects throw on corrupt JSON — production silently recovers

- **Severity:** ważny
- **Plik:** __tests__/buffer.test.js:87-92 vs server/ai/buffer.js:55-59
- **Opis:** Test asserts `buf.load()` rejects with SyntaxError on malformed JSON. Production catches SyntaxError, logs a warning, and resets buffer silently. The test FAILS against actual production code — false confidence that corrupt-file handling works as tested.
- **Propozycja fixu:** Update test to expect silent recovery: `await buf.load(corruptPath)` resolves, buffer is empty after.

---

### BUG-018: modelValidation.test.js copies computePolicyIndex with different darkFrom formula

- **Severity:** kosmetyczny
- **Plik:** __tests__/modelValidation.test.js:99 vs server/ai/model.js:211
- **Opis:** Test copies `computePolicyIndex` with `darkFrom = Math.floor((fromRow * 8 + fromCol) / 2)`. Production uses `darkFrom = fromRow * 4 + Math.floor(fromCol / 2)`. For valid dark squares both produce identical results, but this is code duplication that will silently diverge if production changes. The test also comments about "policy vector size 48" while production uses 128.
- **Propozycja fixu:** Import actual `computePolicyIndex` from model.js for testing. Or add a sync-verification test that compares outputs on 50 random dark-square pairs.

---

### BUG-019: King multi-capture can silently exceed MAX_CAPTURES=12

- **Severity:** ważny
- **Plik:** engine/src/movegen.cpp (multiCapture function, around line 210)
- **Opis:** The recursive `multiCapture()` pushes captures into an unbounded `std::vector<Square>`. When building the final Move, it copies up to `Move::MAX_CAPTURES` (12) with the condition `i < captures.size() && i < Move::MAX_CAPTURES`. If a king capture chain exceeds 12 captures (theoretical max ~24 for zigzag king), excess captures are silently dropped. The resulting Move has correct from/to but truncated captures — the engine executes a different move than generated.
- **Propozycja fixu:** Add `if (captures.size() >= Move::MAX_CAPTURES) return;` guard at the start of each recursive branch. Or log a warning when truncation occurs.

---

### BUG-020: /api/board/set doesn't reset gamesPlayed counter

- **Severity:** kosmetyczny
- **Plik:** engine/src/server.cpp (POST /api/board/set handler)
- **Opis:** `/api/board/set` calls `engine.reset()` (clears history_ and movesWithoutCapture_) then sets custom board. But `gamesPlayed` atomic counter keeps incrementing. After board/set, subsequent `/api/game/start` uses `gamesPlayed % 2` for first-move alternation, which may give wrong starting player after many board/set operations.
- **Propozycja fixu:** Either reset gamesPlayed in board/set, or add a query param `resetCount=true|false`.

---

### BUG-021: GameTimer resets to 0 on `running` prop change instead of pausing

- **Severity:** kosmetyczny
- **Plik:** client/src/components/GameTimer.jsx:8-10
- **Opis:** The effect `useEffect(() => { setSeconds(0); }, [running, gameOver])` resets the timer whenever `running` changes. If pause/unpause is implemented by toggling `running`, the timer resets instead of pausing. Currently latent because `running` defaults to `true` and is never toggled.
- **Propozycja fixu:** Separate reset from pause: reset only on new game (track via gameId/key prop), pause via clearing interval without resetting seconds.

---

### BUG-022: Dashboard canvas resize can race with lossHistory redraw

- **Severity:** kosmetyczny
- **Plik:** client/src/components/Dashboard.jsx:53-73
- **Opis:** Two separate effects draw the chart: one for mount+resize (uses lossRef), one for lossHistory changes. If resize fires during a lossHistory update, the debounced resize handler may draw stale data from the ref after the lossHistory effect already drew fresh data. Visual flicker or briefly stale chart.
- **Propozycja fixu:** Single effect with combined deps: `[lossHistory]` + a resize counter state. Or always read lossHistory directly in the draw function (no ref).

---

### BUG-023: config.js CORS_ORIGIN defaults to localhost — breaks non-localhost deploys

- **Severity:** kosmetyczny
- **Plik:** config.js:27
- **Opis:** `corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000'`. If deployed on a different host (VPS, Docker), WebSocket connections are blocked by CORS unless CORS_ORIGIN env var is set. No startup validation or documentation warns about this.
- **Propozycja fixu:** Add startup check: if NODE_ENV=production and CORS_ORIGIN is not set, log warning. Or default to `process.env.CORS_ORIGIN || '*'` in non-production.

---

## Summary

| ID | Severity | Area | Description |
|----|----------|------|-------------|
| BUG-014 | **Krytyczny** | Server/AI | saveModel non-atomic swap — data loss between rm and rename |
| BUG-015 | **Ważny** | Tests | buffer.test.js sample() uses wrong algorithm (reservoir vs Fisher-Yates) |
| BUG-016 | **Ważny** | Tests | buffer.test.js save() doesn't use atomic rename |
| BUG-017 | **Ważny** | Tests | buffer.test.js load() expects throw on corrupt JSON — production recovers |
| BUG-018 | **Kosmetyczny** | Tests | modelValidation.test.js copies computePolicyIndex with different formula |
| BUG-019 | **Ważny** | Engine/C++ | King multi-capture can silently exceed MAX_CAPTURES=12 |
| BUG-020 | **Kosmetyczny** | Engine/C++ | /api/board/set doesn't reset gamesPlayed counter |
| BUG-021 | **Kosmetyczny** | Client | GameTimer resets on running prop change instead of pausing |
| BUG-022 | **Kosmetyczny** | Client | Dashboard canvas resize race with lossHistory update |
| BUG-023 | **Kosmetyczny** | Config | CORS_ORIGIN defaults to localhost — breaks non-localhost deploys |

**Total new findings: 1 critical, 4 important, 5 cosmetic (10 bugs)**
**Grand total (all scans): 2 critical, 10 important, 11 cosmetic (23 bugs)**

---

## Notes

- The boardToTensor/buildInputArray encoding was carefully analyzed and found **correct** for the standard C++ encoding (1=wp, 2=wk, 3=bp, 4=bk). Initial suspicion of misclassification was wrong upon thorough tracing.
- C++ engine internals (board.h, board.cpp, movegen.cpp, engine.cpp) are well-written with proper bitboard operations. MAX_CAPTURES guard is the main concern.
- React components are generally solid. ErrorBoundary, GameControls, and Board are well-structured.
- Test-production code divergence in buffer.test.js is the most impactful test finding — 3 tests validate behavior that doesn't match production.
- The `computePolicyIndex` in model.js uses policy vector of 128 slots (32 dark squares × 4 directions), consistent with the model's policy head output.
