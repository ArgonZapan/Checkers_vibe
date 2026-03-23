# 🔍 Dynamic Bug Finder Report — hunter-sub-006

**Date:** 2026-03-23
**Scope:** `/opt/Checkers_vibe` — server/index.js, client/src/, server/tests/, __tests__/
**Tests baseline:** 1227 ✅ / 0 ❌ (pre-scan) → 1266 ✅ / 0 ❌ (post-fix, includes pre-existing uncommitted test additions)

---

## 🔧 Bugs Found & Fixed

### BUG-006-01: CSP missing `font-src` directive (MEDIUM)
- **File:** `server/index.js` — security headers middleware
- **Problem:** Content-Security-Policy header had no `font-src` directive. Browsers that don't find `font-src` fall back to `default-src`, but older/some browsers may default to `'none'`, blocking all font loads. The app references system fonts (`Inter`, `JetBrains Mono`, `Fira Code`) — without explicit `font-src 'self'`, custom font files served from the same origin could be blocked.
- **Fix:** Added `font-src 'self'` to the CSP string.
- **Regression risk:** None — restrictive addition only.

### BUG-006-02: Test validation ranges don't match server (LOW-MEDIUM)
- **File:** `__tests__/wsHandlerLogic.test.js` — `validateSetParams` function
- **Problem:** The test's extracted `validateSetParams` used ranges `layers: 1-8` and `neurons: 32-1024`, while the actual server in `server/index.js` validates `layers: 1-5` and `neurons: 32-512`. Tests that accepted `layers=8` or `neurons=1024` as valid would give a false sense of correctness — the real server would reject these values. The UI sliders (`ParamsPanel.jsx`) correctly use `max={5}` and `max={512}`, matching the server.
- **Fix:** Updated test ranges to `layers: 1-5`, `neurons: 32-512` and adjusted boundary test cases (`layers=5 passes`, `layers=6 rejected`, `neurons=512 passes`, `neurons=513 rejected`).
- **Regression risk:** None — test-only change.

---

## ✅ Areas Verified — No Issues Found

### Recent fixes regression check
| Fix | Status |
|-----|--------|
| CSP headers (LEAK-001) | ✅ Present, now includes font-src |
| Rate limiting (LEAK-002) | ✅ Correct: 120 req/min per IP, cleanup interval, hard cap at 10k entries |
| CSS animation fix (#137) | ✅ `.piece { transition: none; }` present in index.css |
| Test cleanup (duplicate removal) | ✅ No duplicates found in test files |

### Security headers
- All 6 headers present with correct values
- `X-Frame-Options: DENY` — prevents clickjacking ✅
- `X-XSS-Protection: 0` — modern best practice ✅
- `Referrer-Policy: strict-origin-when-cross-origin` ✅
- `Permissions-Policy` blocks camera, microphone, geolocation ✅

### Rate limiting & throttling
- HTTP: 120 req/min per IP, sliding window, periodic cleanup ✅
- WS: per-socket throttle (move: 50ms, setParams: 1s, setSpeed: 1s) ✅
- Hard cap at 10,000 entries prevents unbounded memory ✅

### Input validation (server)
- `/api/ai/predict`: board length (64), element type/range (0-4) ✅
- `/api/ai/train`: batch size cap (10000), sample structure validation ✅
- `/api/ai/params`: epsilon range (0-1), networkSize enum ✅
- WS `move`: coordinate validation (0-7), captures array element validation ✅
- WS `setParams`: whitelist of allowed keys (prevents prototype pollution) ✅
- WS `setSpeed/setSpeedMode`: aivai-mode-only auth, type/range checks ✅

### Client-server consistency
- Board state format: server sends 8x8 arrays, client expects 8x8 arrays ✅
- Turn format: server sends color strings ('white'/'black'), client uses strings ✅
- Legal moves: server sends `[{from:[r,c], to:[r,c], captures:[]}]`, client matches ✅
- WS events: state, legalMoves, gameOver, selfPlayStatus, paramsUpdate — all handled ✅

### Edge cases
- Buffer overflow: FIFO eviction works correctly (tested) ✅
- Model save: atomic via tmp+rename ✅
- Engine crash recovery: isEngineUp + waitForEngine with retry ✅
- Race conditions: paramsVersion guard (#133), per-socket move queue ✅
- Multi-capture animation: step-by-step path animation with captured piece removal ✅

---

## 📝 Notes (not bugs, worth knowing)

1. **Unused components:** `MoveHistory.jsx` and `GameTimer.jsx` are defined but not imported in `App.jsx`. Move history is rendered inline. These are dead code — safe to remove if not planned for future use.

2. **Proxy filter edge case:** `/ai` (without trailing slash) passes through to C++ engine because the filter checks `startsWith('/ai/')`. This is benign since no `/ai` endpoint exists on the C++ server.

3. **Pre-existing uncommitted tests:** Several `__tests__/` files had uncommitted additions (39 new tests) covering captures validation, gameMode auth, and more. These were not my changes but are now included in the 1266 total.

---

**Commit:** `fix: add font-src to CSP, align test validation ranges with server (hunter-sub-006)`
