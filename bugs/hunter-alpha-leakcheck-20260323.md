# Data Leak Check Report — 2026-03-23

**Scope:** /opt/Checkers_vibe  
**Checker:** Jarvis Horner (hunter-sub-leakcheck)  
**Date:** 2026-03-23  

---

## Summary

**Status: ✅ CLEAN — No critical data leaks found.**

The codebase is well-hardened against data leaks. All client-facing error responses use generic messages, security headers are in place, .env files are properly gitignored, and no secrets were found in git history.

---

## Findings

### LEAK-001: Stack trace exposed in Fatal Error handler
- **File:** `server/index.js:894`
- **Line:** `console.error('[Server] Fatal error:', err);`
- **What:** The full error object (including stack trace) is logged via `console.error`. While this only goes to server logs and NOT to clients, the full error object could leak internal file paths, module names, and code line numbers in production log aggregation systems.
- **Severity:** Low
- **Suggested fix:** Log only `err.message` for consistency: `console.error('[Server] Fatal error:', err.message)`

### LEAK-002: CORS origin defaults to localhost — misconfiguration risk
- **File:** `config.js:30`
- **Line:** `corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',`
- **What:** If `CORS_ORIGIN` env var is not set in production, the server will accept WebSocket connections from `http://localhost:3000` only, which is fine for security (restrictive) but could cause unexpected behavior if the production URL differs. No actual data leak, but a potential availability issue.
- **Severity:** Informational
- **Suggested fix:** Document that `CORS_ORIGIN` must be set for production deployments. Consider adding a startup warning if not set.

### LEAK-003: Internal architecture disclosed via error messages
- **File:** `server/index.js:289,295,299` (cppFetch helper)
- **Lines:** Error messages like `"C++ ${path} → ${res.status}"`, `"C++ engine timeout"`, `"C++ engine unreachable — ${err.code}"`
- **What:** These error messages are only logged to server console (NOT sent to clients), but they reveal internal architecture details (C++ backend, internal port/path info) in server logs.
- **Severity:** Informational
- **Suggested fix:** Already acceptable — errors stay in server logs. No action needed.

### LEAK-004: Socket.IO logs expose socket IDs
- **File:** `server/index.js:404,412,445,519,525,535,727`
- **Lines:** `console.log(\`[WS] Client connected: ${socket.id}\`)` and similar
- **What:** Socket IDs are logged to server console. Socket IDs are ephemeral session identifiers (not user credentials) and pose no security risk.
- **Severity:** Informational
- **Suggested fix:** No action needed — these are ephemeral IDs useful for debugging.

---

## Verification Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Error responses don't expose stack traces | ✅ | All `res.json({ error: '...' })` use generic messages |
| WebSocket error messages are sanitized | ✅ | `socket.emit('error', { message: '...' })` — clean |
| Proxy errors don't forward internal details | ✅ | Generic `"C++ backend unavailable"` |
| Model prediction errors are generic | ✅ | `"Prediction failed"` — no model internals |
| Training errors are generic | ✅ | `"Training failed"` — no training internals |
| .env files in .gitignore | ✅ | `.env`, `.env.*`, `.env.local`, `.env.*.local` all covered |
| No secrets in git history | ✅ | Searched for API_KEY, SECRET, TOKEN, PASSWORD, PEM — clean |
| No hardcoded secrets in client HTML | ✅ | `index.html` is clean — no keys, tokens, or internal URLs |
| No hardcoded secrets in client JSX | ✅ | Socket connects to `/` (same origin) — no hardcoded IPs/ports |
| Security headers present | ✅ | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| `X-Powered-By` disabled | ✅ | Explicitly removed in middleware |
| No `.pem`/`.key`/`.npmrc` files committed | ✅ | Gitignored + no files found on disk |
| ErrorBoundary doesn't leak errors to UI | ✅ | Shows generic message, no stack trace in DOM |

---

## Detailed Server-Side Error Response Audit

### server/index.js — HTTP API endpoints
| Endpoint | Error Handler | Leaks Stack? | Leaks Internals? |
|----------|--------------|-------------|-----------------|
| `POST /api/ai/predict` | `catch (err)` → `err.message` logged, generic `"Prediction failed"` to client | ❌ No | ❌ No |
| `POST /api/ai/train` | `catch (err)` → `err.message` logged, generic `"Training failed"` to client | ❌ No | ❌ No |
| `POST /api/ai/reset` | `catch (err)` → `err.message` logged, generic `"Reset failed"` to client | ❌ No | ❌ No |
| WebSocket `startGame` | `catch (err)` → `err.message` logged, generic `"Failed to start game"` to client | ❌ No | ❌ No |
| WebSocket `move` | `.catch(err)` → `err.message` logged, generic `"Move failed"` to client | ❌ No | ❌ No |
| WebSocket `setParams` | `catch (err)` → `err.message` logged, generic `"Failed to update parameters"` to client | ❌ No | ❌ No |
| WebSocket `reset` | `catch (err)` → `err.message` logged, generic `"Reset failed"` to client | ❌ No | ❌ No |

### server/proxy.js — Proxy error handling
| Scenario | Response to Client | Leaks Backend? |
|----------|-------------------|---------------|
| C++ backend unreachable | `{"error":"C++ backend unavailable"}` (502) | ❌ No — generic message |

### server/ai/model.js — Model operations
| Operation | Error Handling | Leaks Model Internals? |
|-----------|---------------|----------------------|
| `predict()` | Server-side `console.warn` for invalid turn; no client-facing errors | ❌ No |
| `train()` | No client-facing errors (called internally) | ❌ No |
| `createModel()` | Server-side `console.warn` for invalid params; no client-facing errors | ❌ No |

### server/ai/trainer.js — SelfPlay trainer
| Operation | Error Handling | Leaks Trainer State? |
|-----------|---------------|---------------------|
| `cppFetch()` | Server-side logging; throws generic messages | ❌ No |
| `_playGame()` | Errors caught in `_loop()` — generic messages to WebSocket | ❌ No |
| `saveState()` | `console.error` with `err.message` only | ❌ No |

---

## Git History Audit

Searched for:
- `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `BEGIN.*PRIVATE`
- `.env*`, `*.pem`, `*.key` files

**Result:** ✅ No secrets found in any commit.

---

## .gitignore Coverage

```
.env              ✅
.env.*            ✅
.env.local        ✅
.env.*.local      ✅
.npmrc            ✅
*.pem             ✅
*.key             ✅
secrets/          ✅
credentials/      ✅
status.json       ✅
```

**Result:** ✅ All secret file patterns are covered.

---

## Conclusion

The Checkers_vibe codebase follows security best practices for preventing data leaks to clients:

1. All client-facing errors use generic, non-revealing messages
2. Stack traces and internal details stay in server-side logs only
3. Security headers (CSP, X-Frame-Options, etc.) are properly configured
4. Environment files and secrets are properly gitignored
5. No secrets found in git history

**Recommendation:** This is a well-secured codebase. The findings above are all informational or low-severity. No critical or high-severity data leaks detected.
