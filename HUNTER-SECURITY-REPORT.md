# 🔒 Security Audit Report — Checkers_vibe

**Date:** 2026-03-23
**Auditor:** Jarvis Horner (hunter-sub-alpha-002)
**Repo:** /opt/Checkers_vibe (ArgonZapan/Checkers_vibe)
**Scope:** Data leaks, security misconfigurations, dependency vulnerabilities

---

## Summary

| Category | Issues Found | Critical | Medium | Low |
|----------|-------------|----------|--------|-----|
| Server Config | 2 | 0 | 2 | 0 |
| Data Logging | 1 | 0 | 1 | 0 |
| Authentication | 1 | 0 | 1 | 0 |
| Dependencies | 0 | 0 | 0 | 0 |
| Secrets/Keys | 0 | 0 | 0 | 0 |
| **Total** | **4** | **0** | **4** | **0** |

---

## ✅ Already Good

| Check | Status | Details |
|-------|--------|---------|
| Content-Security-Policy | ✅ Set | Present in server/index.js line 39 (issue #140 already resolved) |
| Other Security Headers | ✅ Set | X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| CORS | ✅ Configured | Socket.IO CORS locked to `CORS_ORIGIN` env or `localhost:3000` |
| Stack Trace Leaks | ✅ Clean | All error responses use generic messages; no `.stack` exposed to client |
| npm audit | ✅ Clean | 0 vulnerabilities found |
| .env files | ✅ Not committed | `.env`, `.env.*`, `.env.local` properly in .gitignore |
| Hardcoded Secrets | ✅ None found | No API keys, tokens, passwords in source code |
| Rate Limiting | ✅ Implemented | 120 req/min per IP, with periodic cleanup and hard cap at 10k entries |
| Body Parser Limit | ✅ Reasonable | `express.json({ limit: '1mb' })` |
| WebSocket Throttling | ✅ Implemented | Per-socket throttling on `setParams`, `setSpeed`, `setSpeedMode` (1s cooldown) |
| Server Binding | ✅ Safe | Defaults to `127.0.0.1` (localhost only), not `0.0.0.0` |

---

## ⚠️ Issues Found

### SEC-001: Missing `X-Powered-By` Header Removal (Medium)

**File:** `server/index.js`
**Location:** No `app.disable('X-Powered-By')` anywhere

**Problem:** Express.js adds `X-Powered-By: Express` response header by default. This reveals server technology to attackers, making targeted exploits easier.

**Proof:** The security header middleware (line 32-39) sets 6 security headers but does NOT disable `X-Powered-By`.

**Impact:** Information disclosure. Attacker knows the exact framework and can search for Express-specific vulnerabilities.

**Recommendation:** Add `app.disable('X-Powered-By')` before the middleware stack, or use the `helmet` package which handles this automatically.

---

### SEC-002: Full WebSocket Parameters Logged to Console (Medium)

**File:** `server/index.js`
**Location:** Line 556

```javascript
console.log(`[WS] setParams from ${socket.id}:`, newParams);
```

**Problem:** The entire `newParams` object is logged to the console using `console.log`. While the `setParams` handler validates known fields, an attacker could send arbitrary additional fields that get logged verbatim. This could:
- Fill disk with log spam (DoS via logging)
- Log injected data that confuses log monitoring
- Reveal internal parameter structure in production logs

**Impact:** Log injection, potential log-based attacks, information disclosure in log files.

**Recommendation:** Log only specific validated fields, not the raw object:
```javascript
console.log(`[WS] setParams from ${socket.id}:`, {
  speedMode: newParams.speedMode,
  aiMoveDelayMs: newParams.aiMoveDelayMs,
});
```

---

### SEC-003: No WebSocket Authentication (Medium)

**File:** `server/index.js`
**Location:** Socket.IO connection handler (line ~365)

**Problem:** WebSocket connections have NO authentication. Any client that can reach the server port can:
- Start/stop games
- Change AI parameters (`setParams`)
- Modify speed settings (`setSpeed`, `setSpeedMode`)
- Reset the model (`restart`)
- Start/stop self-play training

While the server defaults to `127.0.0.1` (localhost), if deployed behind a reverse proxy or on a shared network, anyone on the network can control the application.

**Impact:** Unauthorized access to game control and AI model manipulation.

**Recommendation:** For production deployments, add WebSocket authentication (token-based or session-based). At minimum, document that the application is intended for local/development use only.

---

### SEC-004: Missing `trust.proxy` Configuration (Medium)

**File:** `server/index.js`
**Location:** Line 62 — rate limiting uses `req.ip || req.socket.remoteAddress`

**Problem:** Rate limiting relies on `req.ip` for client identification. However, there is no `app.set('trust proxy', ...)` configuration. When deployed behind a reverse proxy (nginx, Cloudflare, etc.):
- `req.ip` will always be the proxy's IP address (e.g., `127.0.0.1`)
- All clients share the same rate limit counter
- Rate limiting becomes ineffective

**Impact:** Rate limiting bypassed when behind a reverse proxy. All requests appear to come from the same IP.

**Recommendation:** Add `app.set('trust proxy', 1)` (or appropriate hop count) when running behind a reverse proxy. Alternatively, use `X-Forwarded-For` header parsing with proper validation.

---

## 🔍 Checks That Passed

| Check | Method | Result |
|-------|--------|--------|
| Hardcoded secrets | `grep -rn "password\|secret\|api_key\|token\|credential"` | None found |
| CORS config | `grep -rn "cors\|CORS\|Access-Control"` | Properly locked to configured origin |
| Stack traces in responses | `grep -rn "stack" server/index.js` | Generic error messages only |
| Console.log sensitive data | `grep -rn "password\|token\|key" console.log` | No sensitive data logged |
| Dependency vulnerabilities | `npm audit --production` | 0 vulnerabilities |
| .env in git | `git ls-files | grep .env` | Not committed |
| Express body limit | `express.json({ limit: '1mb' })` | Reasonable limit |
| Server listens on 0.0.0.0 | `grep "HOST.*0.0.0.0"` | No; defaults to 127.0.0.1 |

---

## Conclusion

The codebase is in **good security shape**. The Content-Security-Policy issue (#140) has already been addressed. All 4 findings are **Medium severity** — none are critical. The most impactful issue is the missing `X-Powered-By` removal (trivial fix) and the lack of WebSocket authentication (expected for a local dev tool, but worth documenting).

No critical issues requiring immediate GitHub issues were found.
