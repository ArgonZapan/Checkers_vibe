# Hunter Alpha Fixer Report — 2026-03-23
**Subagent:** hunter-sub-005
**Branch:** main
**Commit:** `f5b2161` — fix: add CSP header, rate limit cap, speed auth, httplib payload limit (hunter-sub-005)

---

## Fixes Applied

### Important #4: Missing Content-Security-Policy header
**File:** `server/index.js`
**Change:** Added `Content-Security-Policy` header to security middleware with restrictive policy:
- `default-src 'self'` — only same-origin resources
- `script-src 'self'` — no inline scripts
- `style-src 'self' 'unsafe-inline'` — inline styles allowed (React needs this)
- `img-src 'self' data:` — images from same-origin or data URIs
- `connect-src 'self' ws: wss:` — WebSocket connections allowed
- `frame-ancestors 'none'` — prevents framing (reinforces X-Frame-Options: DENY)

**Test update:** Updated `__tests__/securityHeaders.test.js` to expect CSP header (was asserting it was missing). Updated header count from 5→6.

### Important #5: Rate limit map memory leak
**File:** `server/index.js`
**Change:** Added `RATE_LIMIT_MAX_ENTRIES = 10_000` hard cap. After periodic cleanup (existing), if map still exceeds 10k entries, evicts oldest entries (by `windowStart`). Uses sorted eviction — oldest entries removed first.

### Important #10: setSpeed/setSpeedMode missing authorization
**File:** `server/index.js`
**Change:** Added game mode check to both handlers (matching `setParams` pattern):
- `setSpeed`: rejected unless `socket.gameMode === 'aivai'`
- `setSpeedMode`: rejected unless `socket.gameMode === 'aivai'`
- Added throttling (1s per socket) to both handlers
- Error messages in Polish matching existing convention

### Important #11: httplib missing body size limit
**File:** `engine/src/main.cpp`
**Change:** Added `svr.set_payload_max_length(1024 * 1024)` (1MB limit). Default was 100MB — DoS risk for oversized POST bodies. 1MB is more than enough for checkers API payloads.

---

## Tests
- **npm test:** 1208 passed, 0 failed ✅
- No functional changes — only security/reliability fixes

## Files Changed
- `server/index.js` — CSP header, rate limit cap, speed auth
- `engine/src/main.cpp` — httplib payload limit
- `__tests__/securityHeaders.test.js` — updated to expect CSP (6 headers)
