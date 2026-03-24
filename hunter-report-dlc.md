# Hunter Report — Data Leak Checker (DLC)
**Date:** 2026-03-24
**Scope:** /opt/Checkers_vibe — server/index.js, proxy.js, config.js, ai/trainer.js, ai/model.js
**Focus:** Verify fixed issues #157, #158, #140, #143, #161 + search for new vulnerabilities

---

## VERIFY: #157 — Brak autentykacji na endpointach reset/train/params

- **Fix complete:** partially — HTTP endpoints secured, WebSocket endpoints UNPROTECTED
- **Issues:**
  - ✅ HTTP POST `/api/ai/train` — has `requireApiToken` (line ~163)
  - ✅ HTTP POST `/api/ai/params` — has `requireApiToken` (line ~190)
  - ✅ HTTP POST `/api/ai/reset` — has `requireApiToken` (line ~201)
  - ✅ HTTP POST `/api/ai/restart` — has `requireApiToken` (line ~223)
  - ✅ HTTP POST `/api/selfplay/start` — has `requireApiToken` (line ~236)
  - ✅ HTTP POST `/api/selfplay/stop` — has `requireApiToken` (line ~241)
  - ✅ HTTP GET `/api/selfplay/status` — has `requireApiToken` (line ~245)
  - ❌ **WS `reset` event — NO AUTH at all.** Any connected WebSocket client can call `reset` and wipe the model, buffer, and stats. No `requireApiToken` check, no mode check. (server/index.js, ~line 420)
  - ❌ **WS `restart` event — NO AUTH.** Any connected client can restart model weights. No token check. (server/index.js, ~line 440)
  - ❌ **WS `setParams` event — NO TOKEN AUTH.** Only checks `gameMode === 'aivai'`, but a client in PvAI mode could reconnect with `mode: 'aivai'` via `startGame` first. The mode gate is bypassable client-side. (server/index.js, ~line 340)
  - ❌ **WS `startSelfPlay` / `stopSelfPlay` — NO AUTH.** Any connected client can control self-play training. (server/index.js, ~lines 310-325)
  - ❌ **WS `setSpeed` / `setSpeedMode` — NO TOKEN AUTH.** Mode-gated only, same bypass risk as setParams. (server/index.js, ~lines 385-410)
  - ⚠️ **Token comparison uses `!==` (strict) but the replacement `replace(/^Bearer\s+/i, '')` could leave whitespace.** Minor — `trim()` would be safer.

**Conclusion:** Fix is INCOMPLETE. HTTP layer is secured but WebSocket layer is wide open. Any browser script on the same page can send WS events to reset/reconfigure the server.

---

## VERIFY: #158 — CORS pozwala na dowolny origin jeśli CORS_ORIGIN=*

- **Fix complete:** tak — for WebSocket. Partially for HTTP.
- **Issues:**
  - ✅ WS origin validation function `_isAllowedWsOrigin()` correctly returns `false` when `CORS_ORIGIN === '*'` — blocks unknown origins on WS upgrade. (server/index.js, lines ~28-30)
  - ✅ Socket.IO `allowRequest` hook rejects connections with disallowed origins. (server/index.js, lines ~38-44)
  - ⚠️ **HTTP Express CORS is still set to `origin: CORS_ORIGIN`** — if `CORS_ORIGIN=*`, the Express `cors` middleware (via socket.io) will still send `Access-Control-Allow-Origin: *` on HTTP responses. However, Express routes themselves don't use `cors()` middleware directly — they rely on Socket.IO's cors config. The proxy to C++ uses `changeOrigin: true` but no CORS middleware on proxied routes.
  - ⚠️ **No explicit Express CORS middleware for HTTP routes.** This means cross-origin HTTP requests from browsers will be blocked by browser CORS policy by default (which is actually MORE secure). But if a CORS middleware is added later with `CORS_ORIGIN=*`, it would open HTTP endpoints too.

**Conclusion:** Fix is adequate for WebSocket. HTTP routes don't have CORS middleware, so `CORS_ORIGIN=*` doesn't affect them currently — this is by accident, not design. Should add explicit comment or HTTP CORS middleware with the same wildcard guard.

---

## VERIFY: #140 — Brak Content-Security-Policy header

- **Fix complete:** tak
- **Issues:**
  - ✅ `Content-Security-Policy` header is set in the security middleware. (server/index.js, line ~65)
  - ✅ CSP is reasonably strict: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`
  - ✅ `ws:` scheme is only allowed when `CSP_ALLOW_WS=true` (dev mode), otherwise only `wss:`. (server/index.js, line ~63)
  - ✅ Other security headers present: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Referrer-Policy`, `Permissions-Policy`.
  - ⚠️ **`connect-src 'self' wss:` allows WebSocket connections to ANY wss:// origin.** This is overly broad — should be `wss: HOST:PORT` or narrowed to same-origin only. An attacker's page could use this CSP to connect to their own WSS server (limited impact since CSP is enforced on the served page, not on attacker pages, but still a relaxation).
  - ⚠️ **No `style-src 'unsafe-inline'` but also no nonce/hash** — inline styles from React build may break if any exist. Cosmetic, not a security issue.

**Conclusion:** Fix is complete and functional. Minor CSP relaxation on `connect-src wss:` could be tightened.

---

## VERIFY: #143 — Rate limiting — memory exhaustion przez spoofed X-Forwarded-For

- **Fix complete:** tak
- **Issues:**
  - ✅ `app.set('trust proxy', false)` — prevents Express from using X-Forwarded-For for `req.ip`. (server/index.js, line ~19)
  - ✅ Rate limiter uses `req.ip || req.socket.remoteAddress` — falls back to actual connection IP.
  - ✅ Periodic cleanup interval removes expired entries every `RATE_LIMIT_WINDOW_MS`. (server/index.js, lines ~73-85)
  - ✅ Hard cap `RATE_LIMIT_MAX_ENTRIES = 10,000` with eviction of oldest entries. (server/index.js, lines ~78-84)
  - ✅ In-request OOM guard: if map is full and new IP arrives, evicts oldest entry before inserting. (server/index.js, lines ~92-100)
  - ⚠️ **Rate limiter applies to ALL requests including static assets** (`express.static` is after rate limiter). Static file serving (React build) will consume rate limit quota. In production behind a CDN this is fine, but direct access could hit limits quickly on page load with many assets.
  - ⚠️ **No per-route rate limiting** — the `/api/ai/predict` endpoint (CPU-heavy) has the same 120 req/min limit as `/api/ai/info` (lightweight). Could benefit from stricter limits on predict/train.

**Conclusion:** Fix is complete and correct for the spoofing vector. Minor architectural notes above.

---

## VERIFY: #161 — Rate limit map OOM protection

- **Fix complete:** tak
- **Issues:**
  - ✅ `RATE_LIMIT_MAX_ENTRIES = 10,000` hard cap prevents unbounded growth. (server/index.js, line ~72)
  - ✅ Periodic cleanup evicts expired entries and then trims to max size. (server/index.js, lines ~73-85)
  - ✅ Request-time eviction: when a new IP arrives and map is at capacity, oldest entry is evicted via linear scan. (server/index.js, lines ~92-100)
  - ⚠️ **Linear scan for oldest entry is O(n) per request when map is full.** With 10,000 entries this is acceptable, but a min-heap would be more efficient. Not a security issue.
  - ✅ Both cleanup (interval) and per-request eviction are present — defense in depth.

**Conclusion:** Fix is complete and correct.

---

## NEW: WebSocket Authentication Bypass on Destructive Operations

- **Severity:** critical
- **Location:** server/index.js — WS event handlers: `reset` (~line 420), `restart` (~line 440), `setParams` (~line 340), `startSelfPlay` (~line 310), `stopSelfPlay` (~line 320)
- **Description:** WebSocket event handlers for destructive operations (reset model, restart, change params, control self-play) have NO API token authentication. The HTTP equivalents all use `requireApiToken`, but the WS path is completely open. Any script running in the browser context (XSS, malicious extension, or even a crafted page if CSP is bypassed) can connect via Socket.IO and call these events. The `setParams` WS handler only checks `gameMode === 'aivai'`, but a client can trivially emit `startGame({ mode: 'aivai' })` first. Similarly, `reset` and `restart` have zero gating.
- **Impact:** Full model destruction, training data loss, server reconfiguration by any WebSocket client.

---

## NEW: Unauthenticated WS `reset` and `restart` Can Wipe Production Models

- **Severity:** critical
- **Location:** server/index.js lines ~420-455 (WS reset/restart handlers)
- **Description:** The WS `reset` handler calls `trainer.resetModel()` which: (1) stops self-play, (2) clears replay buffer, (3) zeroes all stats, (4) recreates models with fresh random weights, (5) deletes model files from disk, (6) deletes buffer file from disk. There is no confirmation, no auth, and no rate limiting on these events (only the general HTTP rate limiter applies, not WS events). A single malicious WS message can permanently destroy all training progress.

---

## NEW: `setParams` WS Handler Allows Model Architecture Manipulation Without Auth

- **Severity:** important
- **Location:** server/index.js lines ~340-380
- **Description:** The `setParams` WS handler validates parameter ranges and has a whitelist of allowed keys (good). However, it only checks `socket.gameMode === 'aivai'` for authorization. A client can: (1) connect via WS, (2) emit `startGame({ mode: 'aivai' })`, (3) emit `setParams({ ... })` with any valid params. This allows unauthenticated manipulation of model architecture (layers, neurons), learning rate, strategy selection, and speed settings. The `requireApiToken` check present on the HTTP `/api/ai/params` endpoint is completely absent from the WS path.

---

## NEW: HTTP Endpoints `/api/ai/info` and `/api/ai/stats` Leak Internal State

- **Severity:** cosmetic/important (depending on deployment)
- **Location:** server/index.js lines ~112-127 (GET /api/ai/info), line ~268 (GET /api/ai/stats)
- **Description:** Both endpoints return detailed internal state without authentication: model architecture (layers, neurons), epsilon values (training progress), buffer size, games played, win/loss ratios. In a public deployment, this leaks competitive intelligence about the AI's training state. The `/api/ai/info` endpoint additionally exposes whether self-play is currently running. These should require authentication or be restricted to localhost.

---

## NEW: `/api/ai/predict` Endpoint Has No Authentication

- **Severity:** important
- **Location:** server/index.js lines ~130-160
- **Description:** The `/api/ai/predict` endpoint accepts arbitrary board states and returns AI move predictions without any authentication. While input validation is good (board array, legal moves, coordinates all validated), an unauthenticated attacker can: (1) probe the AI's strategy by sending carefully crafted board states, (2) cause CPU exhaustion by sending rapid predict requests (rate limited to 120/min per IP, but each predict is CPU-intensive due to TensorFlow inference). The endpoint should require `requireApiToken` or at minimum have a stricter per-route rate limit.

---

## NEW: C++ Backend Proxy Has No Additional Auth Layer

- **Severity:** important
- **Location:** server/proxy.js
- **Description:** The proxy forwards all `/api/*` requests (except `/api/ai/*` and `/api/selfplay/*`) to the C++ backend at `localhost:8080`. The proxy does NOT add any authentication headers or check `requireApiToken`. This means any request that passes the Express rate limiter can reach the C++ engine directly. If the Node.js server is exposed externally (e.g., `HOST=0.0.0.0`), the C++ engine's endpoints (game state, moves, legal moves) are accessible without auth. Currently the server binds to `127.0.0.1` by default, which mitigates this, but the proxy should ideally add auth forwarding.

---

## NEW: `wsThrottle` Helper Stores State on Socket Object — Minor Memory Leak

- **Severity:** cosmetic
- **Location:** server/index.js, `wsThrottle` function (~line 285)
- **Description:** The `wsThrottle` function stores throttle timestamps on `socket._throttle` object. When a socket disconnects, this object is garbage collected (no leak). However, there's no cleanup of `socket._moveQueue` promises. If a client disconnects mid-move, the promise chain continues executing (the `.catch` handler will fire but the chain is still referenced). Not a real memory leak since V8 will GC the socket, but could delay GC of associated state.

---

## NEW: Error Messages May Leak Internal File Paths

- **Severity:** cosmetic
- **Location:** server/ai/model.js (createModel, saveModel), server/ai/trainer.js (resetModel)
- **Description:** Error messages from `saveModel` and `resetModel` log `err.message` which may contain full filesystem paths (e.g., `file:///opt/Checkers_vibe/data/model.tmp`). While these go to server logs (not client responses), the `trainer.resetModel()` errors can surface through WS `error` events to clients as generic "Reset failed" (good). However, the auto-save interval logs full paths on error. In a shared-hosting scenario, path disclosure in logs is a minor concern.

---

## Summary

| Issue | Status | Notes |
|-------|--------|-------|
| #157 Auth on reset/train/params | ⚠️ PARTIAL | HTTP ✅, WS ❌ — any WS client can reset/train/params |
| #158 CORS wildcard | ✅ FIXED | WS origin check works; HTTP has no CORS middleware |
| #140 CSP header | ✅ FIXED | Minor: `wss:` in connect-src is broad |
| #143 X-Forwarded-For spoofing | ✅ FIXED | trust proxy false + rate limiter uses req.ip |
| #161 Rate limit OOM | ✅ FIXED | Hard cap + periodic cleanup + request-time eviction |

**Critical new findings:** 2 (WS auth bypass on reset/restart, WS auth bypass on setParams/selfplay)
**Important new findings:** 2 (predict endpoint no auth, C++ proxy no auth)
**Cosmetic new findings:** 3 (info/stats leak, wsThrottle, path disclosure)
