# 🔍 Data Leak Audit — Checkers_vibe

**Date:** 2026-03-24
**Auditor:** Jarvis Horner (hunter-sub-002-leakchecker)
**Scope:** `/opt/Checkers_vibe` — server, engine (C++), client, proxy

---

## Summary

| # | Check | Status | Severity |
|---|-------|--------|----------|
| 1 | C++ internal errors → client | ✅ PASS | — |
| 2 | X-Forwarded-For spoofing (rate limiting) | ✅ PASS | — |
| 3 | Sensitive data logging | ⚠️ MINOR | Low |
| 4 | Error handlers leak info | ⚠️ FINDING | Medium |
| 5 | CSP header config | ✅ PASS | — |

**Overall: 3/5 clean. Two low/medium findings, no critical leaks.**

---

## 1. C++ Internal Errors → Client ✅ PASS

**Checked:** `engine/src/server.cpp` error handlers, `server/index.js` cppFetch/getGameState

The C++ engine catches exceptions and returns generic messages:
- `json::parse_error` → `"invalid json in request"` (400)
- `json::type_error` → `"invalid type in request"` (400)
- `std::exception` → `"internal error"` (500)
- `...` (catch-all) → `"internal error"` (500)

No stack traces, no file paths, no exception details leak from C++.

**Node.js side** also sanitizes: `getGameState()` catches all errors and returns `error: 'Failed to fetch game state'` — never exposes C++ error messages to the client. The `cppFetch` helper catches ECONNREFUSED/AbortError and throws new generic `Error` objects.

**Verdict:** Fix for sanitize `getGameState` is solid. No C++ internal errors reach the client.

---

## 2. X-Forwarded-For Spoofing (Rate Limiting) ✅ PASS

**Checked:** `server/index.js` lines 22, 60-78

```js
app.set('trust proxy', false); // SEC: prevent IP spoofing via X-Forwarded-For
```

Rate limiter uses `req.ip || req.socket.remoteAddress`. With `trust proxy: false`, Express ignores `X-Forwarded-For` entirely and `req.ip` equals `req.socket.remoteAddress` (actual TCP peer IP).

The rate limit map also has:
- Periodic cleanup (every 60s) of expired entries
- Hard cap at 10,000 entries with LRU eviction
- Memory-safe — no unbounded growth

**Verdict:** X-Forwarded-For spoofing is fully mitigated. Rate limiter is robust.

---

## 3. Sensitive Data Logging ⚠️ MINOR (Low)

**Checked:** All `console.log/error/warn` statements in server/index.js, proxy.js

### Findings:

**3a. Proxy logs internal C++ base URL** (`server/proxy.js:32`)
```js
console.log(`[Proxy] → ${req.method} ${req.url} → ${CPP_TARGET}`);
```
`CPP_TARGET` is `http://localhost:8080` — reveals internal port/architecture. Only visible in server-side logs, but if logs are exposed (e.g., log aggregation, error monitoring), this leaks infrastructure details.

**Severity:** Low — server-side only, but unnecessary. Should sanitize to `[Proxy] → POST /api/move → <engine>`.

**3b. Socket ID logging** (multiple lines)
```js
console.log(`[WS] Client connected: ${socket.id}`);
```
Socket IDs are session-scoped random strings, low risk. Acceptable for debugging.

**3c. `__dirname` / file paths**
`__dirname` is used for `MODEL_DIR` and `BUFFER_FILE` construction but never exposed to clients. Safe.

**3d. `process.env` usage**
Only `PORT`, `HOST`, `CORS_ORIGIN`, `CSP_ALLOW_WS`, `TF_ENABLE_ONEDNN_OPTS` — none are secrets, none are exposed.

**Verdict:** Low risk. The proxy URL log is the only actionable item — mask the internal target.

---

## 4. Error Handlers Leak Info ⚠️ FINDING (Medium)

**Checked:** All `res.json()` and `socket.emit('error', ...)` responses

### Finding 4a: `setParams` validation echoes actual values (MEDIUM)

`server/index.js:632`:
```js
socket.emit('error', { message: `Nieprawidłowe parametry: ${errors.join('; ')}` });
```

Where `errors` contains strings like:
- `neurons=99999 (zakres: 32-512)`
- `layers=-5 (zakres: 1-5)`
- `batchSize=NaN (expected finite number)`
- `dropout=999 (zakres: 0-0.5)`

This tells an attacker the **exact validation ranges and expected types** for every model parameter. While model params aren't secrets per se, echoing user-supplied values back enables:
- Probing for accepted value ranges
- Understanding the internal model architecture constraints
- Potential injection if values were ever interpolated into other contexts (not currently the case)

**Fix:** Return generic message:
```js
socket.emit('error', { message: 'Nieprawidłowe parametry modelu' });
```

### Finding 4b: Validation errors reveal internal coordinate system (LOW)

`server/index.js:492, 518, 522, 533`:
```js
socket.emit('error', { message: 'Invalid "from" coordinate — expected [row, col] with values 0-7' });
socket.emit('error', { message: `Invalid capture at index ${i} — expected [row, col] with values 0-7` });
```

These reveal the internal 0-indexed coordinate system. Low risk for a checkers game (the client needs to know this anyway for valid moves), but the `index ${i}` echo of attacker-supplied data is unnecessary.

**Fix:** Sanitize: `'Invalid coordinate — expected [row, col] 0-7'`

### Clean error responses:
- HTTP endpoints: `"Prediction failed"`, `"Training failed"`, `"Reset failed"` ✅
- WebSocket: `"Move failed"`, `"Failed to start game"`, `"Reset failed"` ✅
- C++: `"internal error"` (no stack traces) ✅

---

## 5. CSP Header Configuration ✅ PASS

**Checked:** `server/index.js:37`

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; 
  img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; 
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

| Directive | Value | Assessment |
|-----------|-------|------------|
| `default-src` | `'self'` | ✅ Restrictive baseline |
| `script-src` | `'self'` | ✅ No inline/eval/unsafe |
| `style-src` | `'self'` | ✅ No inline styles allowed |
| `img-src` | `'self' data:` | ✅ data: OK for inline images |
| `font-src` | `'self'` | ✅ No external fonts |
| `connect-src` | `'self' wss:` | ✅ WebSocket restricted to wss: |
| `object-src` | `'none'` | ✅ Blocks Flash/plugins |
| `base-uri` | `'self'` | ✅ Prevents base tag injection |
| `frame-ancestors` | `'none'` | ✅ Prevents clickjacking |

**Note:** `ws:` (unencrypted WebSocket) is only allowed when `CSP_ALLOW_WS=true` env var is set — correct for local dev, blocked in production. ✅

**Additional security headers present:**
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` ✅
- `X-XSS-Protection: 0` (correct — modern browsers, avoids filter bypass) ✅
- `Referrer-Policy: strict-origin-when-cross-origin` ✅
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✅
- `X-Powered-By` removed (via `app.disable()` + `res.removeHeader()`) ✅

**Verdict:** CSP and security headers are correctly configured. No issues.

---

## Additional Observations

### Source Maps
No `.map` files in `client/dist/`. Vite production build strips source maps. ✅

### `.env` Files
No `.env` files found in the repo. Environment variables are read at runtime only. ✅

### Prototype Pollution Protection
`setParams` handler uses an explicit allowlist (`ALLOWED_PARAMS`) to filter incoming keys, preventing prototype pollution via `__proto__`, `constructor`, etc. ✅

### Locking (BUG-008)
Auto-save and reset use a Promise-based lock to prevent race conditions. No data corruption risk. ✅

---

## Recommendations

| Priority | Finding | Fix |
|----------|---------|-----|
| **Medium** | `setParams` validation echoes actual values to client | Replace with generic message: `'Nieprawidłowe parametry modelu'` |
| **Low** | Proxy logs internal C++ URL `localhost:8080` | Mask: `[Proxy] → POST /api/move → <engine>` |
| **Low** | Move validation errors echo attacker index `i` | Remove `${i}` from error message |

No critical findings. The codebase shows evidence of prior security hardening (the `SEC` comments reference specific fixes). The `sanitize getGameState` fix is working correctly — C++ errors are caught and replaced with generic messages before reaching the client.
