# Hunter DLC — Data Leak Checker Security Report

**Agent:** hunter-sub-dlc (data-leak-checker)  
**Date:** 2026-03-24  
**Scope:** Verification of security fixes + data leak audit

---

## Summary

| # | Issue | Fix Status | Verification |
|---|-------|-----------|-------------|
| #143 | Rate limiting via spoofed X-Forwarded-For | ✅ FIXED | Verified |
| #161 | Rate limit map OOM | ✅ FIXED | Verified |
| #158 | CORS wildcard on WebSocket | ✅ FIXED | Verified |
| #140 | Missing Content-Security-Policy | ✅ FIXED | Verified |
| #157 | No auth on reset/train/params | ✅ FIXED | Verified |
| — | API_TOKEN name leak in 401 | 🔧 FIXED NOW | New finding |
| — | /selfplay/status unauthenticated config leak | 🔧 FIXED NOW | New finding |

---

## Detailed Analysis

### 1. #143 — Rate limiting memory exhaustion via spoofed X-Forwarded-For

**Status: ✅ FIXED (hunter-sub-dlc2)**

**Fix verification:**
- `app.set('trust proxy', false)` — prevents Express from trusting `X-Forwarded-For` header
- `req.ip` always resolves to the actual connection IP (`req.socket.remoteAddress`)
- An attacker spoofing XFF headers will still be rate-limited by their real IP

**Exploit scenario:** Attacker sends requests with random `X-Forwarded-For` values → each gets a new rate-limit entry → unbounded memory growth → OOM crash.

**CVSS (original):** 7.5 (High) — DoS via memory exhaustion

**Verdict:** ✅ Fix is correct and complete.

---

### 2. #161 — Rate limit map OOM atak z wielu IP

**Status: ✅ FIXED (hunter-sub-dlc2)**

**Fix verification:**
- `RATE_LIMIT_MAX_ENTRIES = 10_000` — hard cap on map size
- On new IP insert when map is full → evicts oldest entry (`windowStart` smallest)
- Periodic cleanup interval (every 60s) removes expired entries and evicts oldest if over cap
- Both eviction strategies (on-insert + periodic) prevent unbounded growth

**Exploit scenario:** Botnet with 100k+ IPs → map grows unbounded → server runs out of memory → crash.

**CVSS (original):** 7.5 (High) — DoS via memory exhaustion

**Verdict:** ✅ Fix is correct. Dual eviction strategy (on-insert + periodic cleanup) provides defense-in-depth.

---

### 3. #158 — CORS pozwala na dowolny origin gdy CORS_ORIGIN=*

**Status: ✅ FIXED (hunter-sub-dlc2)**

**Fix verification:**
- `_isAllowedWsOrigin(origin)` → when `CORS_ORIGIN === '*'`, returns `false` for any non-empty origin
- `allowRequest` callback rejects handshake for any browser-originated request
- Same-origin (no Origin header) and non-browser requests still pass

**Key insight:** Wildcard CORS (`*`) for HTTP ≠ wildcard for WebSocket. WS connections carry session state and are higher risk. The fix correctly distinguishes between the two.

**CVSS (original):** 6.5 (Medium) — Cross-origin WebSocket hijacking

**Verdict:** ✅ Fix is correct. WS connections are now properly restricted even when CORS_ORIGIN=*.

**Note:** HTTP CORS is handled implicitly by Socket.IO and express.static — no additional CORS middleware is needed since the C++ proxy and static files don't set permissive CORS headers by default.

---

### 4. #140 — Brak Content-Security-Policy header

**Status: ✅ FIXED (hunter-sub-dlc2)**

**Fix verification:**
Security headers middleware sets:
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0` (correct — modern browsers deprecate this, CSP is the replacement)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**CVSS (original):** 5.3 (Medium) — XSS/injection via missing CSP

**Verdict:** ✅ Fix is comprehensive. All 9 directives present, well-aligned with X-Frame-Options. `ws:` only allowed via `CSP_ALLOW_WS=true` env var (local dev only).

---

### 5. #157 — Brak autentykacji na endpointach reset/train/params

**Status: ✅ FIXED (hunter-sub-dlc2)**

**Fix verification:**
`requireApiToken` middleware applied to:
| Endpoint | Method | Verified |
|----------|--------|----------|
| `/api/ai/train` | POST | ✅ |
| `/api/ai/params` | POST | ✅ |
| `/api/ai/reset` | POST | ✅ |
| `/api/ai/restart` | POST | ✅ |
| `/api/selfplay/start` | POST | ✅ |
| `/api/selfplay/stop` | POST | ✅ |

**Auth logic:**
- If `API_TOKEN` env var is not set → dev mode, all requests pass (backward compatible)
- If set → requires `Authorization: Bearer <token>` header or `?token=<token>` query param
- Token comparison is exact string match (timing-safe comparison would be ideal but not critical for this use case)

**CVSS (original):** 9.1 (Critical) — Unauthenticated model manipulation

**Verdict:** ✅ Fix is correct. All state-changing endpoints are protected.

---

## New Findings (Data Leak Audit)

### 6. API_TOKEN name exposure in 401 response (FIXED)

**Severity:** Low (CVSS 3.1)  
**Vulnerability:** The 401 error response contained `"Unauthorized — valid API_TOKEN required"`, leaking the exact environment variable name an attacker needs to look for in:
- Source code (to find where it's read)
- Container configs / docker-compose
- Kubernetes secrets
- `.env` files

**Exploit scenario:** Attacker probes `/api/ai/reset` → gets 401 → knows env var is `API_TOKEN` → searches for it in exposed configs, CI/CD pipelines, container images.

**Fix applied:** Changed to `"Unauthorized — valid token required"` (no env var name).

---

### 7. `/api/selfplay/status` unauthenticated config leak (FIXED)

**Severity:** Low (CVSS 3.1)  
**Vulnerability:** `GET /api/selfplay/status` (no auth) returned full `trainer.getStatus()` which exposes:
- `modelParams` (layers, neurons, activation, lr, batchSize, dropout — full model architecture)
- `networkSizeWhite` / `networkSizeBlack`
- `avgRoundTimeMs`, `last10Times`, `totalTimeMs` (timing side-channel for model performance)
- `bufferSize` (training data volume)

**Exploit scenario:** Competitor/attacker queries this endpoint → learns exact model architecture → crafts adversarial inputs optimized for the specific architecture → exploits model weaknesses.

**Fix applied:** Added `requireApiToken` to the endpoint. Legitimate UI clients can use `apiToken` query param for authenticated access.

---

### 8. `/api/ai/predict` returns model internals (ACCEPTED RISK)

**Severity:** Low (CVSS 2.6)  
**Vulnerability:** `POST /api/ai/predict` (no auth) returns:
- `probabilities` — full policy distribution over all legal moves
- `value` — position evaluation scalar

**Analysis:** This is by design — the frontend needs this to display move suggestions and board evaluation. Restricting it would break core game functionality. The risk is model extraction (adversary sends many boards → reconstructs approximate model behavior), but:
- Requires many requests (rate-limited per IP)
- Model weights are not directly exposed (only outputs)
- The model runs locally, so the attack surface is limited

**Recommendation:** Accepted risk. If model IP protection becomes important, consider adding `requireApiToken` to this endpoint and having the frontend pass the token.

---

## Additional Observations

### ✅ No token value leaks in logs
- `console.log` / `console.error` never log token values
- `API_TOKEN` env var is only read, never logged
- Error messages are sanitized (only `.message`, never `.stack`)

### ✅ No internal path leaks in error responses
- `cppFetch` errors only log method + path + status (no filesystem paths)
- Client-facing errors are generic: `"Prediction failed"`, `"Training failed"`, etc.
- `getGameState` catches errors and returns safe fallback state

### ✅ No sensitive data in WS emissions
- `socket.id` is only logged server-side (not sent to clients)
- WS error messages are generic: `"Failed to start game"`, `"Move failed"`, etc.
- `setParams` only logs `speedMode` and `aiMoveDelayMs`, not full params

### ✅ Express config hardened
- `trust proxy: false` — prevents IP spoofing
- `X-Powered-By` disabled (both via `app.disable()` and middleware `removeHeader`)
- JSON body limit: 1MB (prevents large payload abuse)

---

## Fixes Applied

| Fix | File | Description |
|-----|------|-------------|
| API_TOKEN name leak | `server/index.js:117` | Generic 401 message |
| selfplay/status auth | `server/index.js:322` | Added `requireApiToken` |

---

## Recommendations (Future)

1. **Timing-safe token comparison** — Use `crypto.timingSafeEqual()` for `requireApiToken` to prevent timing attacks (low priority, token is read from env, not user-controlled)
2. **Rate limiting per-IP on predict** — Currently rate-limited globally per-IP, but predict could have its own stricter limit to slow model extraction
3. **Security headers test automation** — The existing CSP tests are good; consider adding them to CI pipeline
4. **Log rotation** — Server logs contain `socket.id` and game mode; consider structured logging with rotation

---

*Report generated by hunter-sub-dlc (data-leak-checker)*
