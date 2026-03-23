# Data Leak Check Report — hunter-sub-002
**Date:** 2026-03-23  
**Scope:** /opt/Checkers_vibe  

## Summary

| Category | Status | Issues Found |
|----------|--------|-------------|
| Server logging | ✅ OK | No sensitive data logged |
| Error responses | 🔧 **FIXED** | 2 issues (C++ `e.what()` leaks) |
| WebSocket messages | 🔧 **FIXED** | 1 issue (`_config` leak) |
| Config files / secrets | ✅ OK | No secrets in repo |
| .gitignore coverage | ✅ OK | Covers data/, build/, .env, .pem, etc. |
| Security headers | ✅ OK | Full CSP + all recommended headers |

## Details

### 1. Server Logging — ✅ Clean
- `console.log`/`console.error` calls do NOT log passwords, tokens, secrets, or auth data
- Socket IDs are logged (minor, not sensitive for local app)
- IP addresses used only for rate limiting (in-memory Map, not persisted)
- C++ proxy logs only method + URL for non-GET requests

### 2. Error Responses — 🔧 FIXED

**Issue C++-LEAK-01**: `e.what()` exposed in HTTP error responses  
**File:** `engine/src/server.cpp` (6 occurrences)  
**Risk:** Medium — json parse errors can include internal paths, parser state, implementation details  
**Fix:** Replaced all `e.what()` with generic messages ("invalid json in request", "invalid type in request", "internal error")  
**Commit:** `fix: sanitize error responses and remove internal config leak (hunter-sub-002)`

### 3. WebSocket Messages — 🔧 FIXED

**Issue WS-LEAK-01**: `_config: CONFIG.ai` sent to all clients  
**File:** `server/index.js:385`  
**Risk:** Low-Medium — exposed internal training params (bufferSize, trainEpochs, gamma, epsilonDecay, modelParams architecture details)  
**Fix:** Removed `_config` field from `paramsUpdate` WebSocket payload  
**Note:** Clients already receive individual params (epsilon, networkSize, speedMode, aiMoveDelayMs) — `_config` was redundant

**WebSocket data scope (post-fix):**
- `state` event: board, turn, legalMoves, gameOver, winner, lastMove — ✅ appropriate
- `paramsUpdate` event: epsilon, networkSize, speedMode, aiMoveDelayMs — ✅ appropriate
- `selfPlayStatus` event: active, gameNumber, stats — ✅ appropriate
- Error events: generic messages only — ✅ no stack traces

### 4. Config Files / Secrets — ✅ Clean
- No `.env`, `.pem`, `.key`, or secret files in repo
- `config.js` contains only app config (ports, timeouts, colors, AI params) — no secrets
- CORS origin configurable via `CORS_ORIGIN` env var (not hardcoded with credentials)
- `package-lock.json` contains no embedded secrets

### 5. .gitignore — ✅ Comprehensive
Covers:
- `build/`, `dist/` — build artifacts
- `models/`, `data/` — ML models and replay buffers
- `backups/` — backup data
- `node_modules/` — dependencies
- `.env`, `.env.*`, `.env.local`, `.env.*.local` — environment files
- `.npmrc`, `*.pem`, `*.key` — credentials
- `secrets/`, `credentials/` — secret directories
- `status.json` — runtime state
- `.vscode/`, `.idea/` — IDE configs
- `.DS_Store`, `Thumbs.db` — OS artifacts
- `*.log` — log files

Verified: `data/`, `build/`, `engine/build/` are NOT tracked in git ✅

### 6. Security Headers — ✅ Complete
All headers set in `server/index.js` middleware:
- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'` ✅
- `X-Content-Type-Options: nosniff` ✅
- `X-Frame-Options: DENY` ✅
- `X-XSS-Protection: 0` ✅ (correct modern value — disables buggy XSS filter)
- `Referrer-Policy: strict-origin-when-cross-origin` ✅
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✅
- `X-Powered-By` disabled (`app.disable('X-Powered-By')` + `res.removeHeader`) ✅

## Fixes Applied
1. `engine/src/server.cpp` — sanitized 6 error response catch blocks
2. `server/index.js` — removed `_config: CONFIG.ai` from WebSocket paramsUpdate
