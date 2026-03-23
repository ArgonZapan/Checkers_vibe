# Hunter Data-Leak-Checker v2 — Checkers_vibe

**Date:** 2026-03-23  
**Branch:** main  
**Scanner:** hunter-sub-leakcheck (v2 re-scan)  
**Scope:** /opt/Checkers_vibe — data leaks, security issues, state exposure  
**Previous report:** `hunter-leakcheck-2026-03-23.md` (commit 92c6bad)

---

## Delta from v1

| Issue | v1 Status | v2 Status | Notes |
|-------|-----------|-----------|-------|
| LEAK-001 (GitHub PAT) | CRITICAL — open | **UNCHANGED** | Token still in `.git/config`. Cannot fix in code — requires operational rotation. |
| LEAK-002 (CORS `*`) | HIGH — open | **✅ FIXED** | Changed to configurable origin, defaults to `http://localhost:3000`. |
| LEAK-003 (No HTTP auth) | HIGH — open | **UNCHANGED** | Architectural change required. |
| LEAK-004 (No WS auth) | HIGH — open | **UNCHANGED** | Architectural change required. |
| LEAK-005 (`/api/ai/info` disclosure) | MEDIUM — open | **UNCHANGED** | |
| LEAK-006 (`/api/selfplay/status` disclosure) | MEDIUM — open | **UNCHANGED** | |
| LEAK-007 (`setSpeed` global mutation) | MEDIUM — open | **IMPROVED** | Validation tightened (0-10000), but still no auth. |
| LEAK-008 (.gitignore gaps) | LOW — open | **✅ FIXED** | Added `.env`, `.npmrc`, `*.pem`, `*.key`, `secrets/`, `status.json`. |
| LEAK-009 (Predictable model path) | LOW — open | **UNCHANGED** | Low risk — express.static only serves `client/dist/`. |
| LEAK-013 (`/api/ai/train` arbitrary data) | HIGH — open | **RESOLVED** | `train` import was fixed in earlier commit (1b168a8). Input validation still weak but batch length check exists. |

---

## NEW Issues Found (v2)

### LEAK-014: Error Responses Leak Internal Implementation Details

- **Severity:** HIGH
- **File:** `server/index.js` (HTTP endpoints), `server/proxy.js` (proxy error handler)
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** Multiple API endpoints and WebSocket handlers returned raw `err.message` strings to clients. These could expose:
  - Internal file paths (`C++ /api/move → 400`)
  - Engine timeout values (`C++ engine timeout (5000ms)`)
  - Connection error codes (`C++ engine unreachable — ECONNREFUSED`)
  - TensorFlow stack traces from prediction failures
- **Impact:** Information disclosure — aids attackers in fingerprinting the stack and identifying attack surfaces.
- **Status:** ✅ **FIXED** — All HTTP error responses now return generic messages. WebSocket error emissions sanitized. Proxy error handler no longer includes `detail: err.message`.
- **Commit:** `ede313d`

### LEAK-015: Error Responses Leak Internal Details (WebSocket)

- **Severity:** MEDIUM
- **File:** `server/index.js` (WebSocket handlers)
- **CVSS:** 4.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** WebSocket error handlers (`startGame`, `getLegalMoves`, `move`, `startSelfPlay`, `setParams`, `reset`) sent raw `err.message` to the connected client. While scoped to the requesting socket (not broadcast), these could still expose internal state.
- **Impact:** Limited information disclosure to individual connected clients.
- **Status:** ✅ **FIXED** — All WebSocket catch-all handlers now emit generic user-facing messages.
- **Commit:** `ede313d`

---

## Remaining Unfixed Issues

### LEAK-001: GitHub PAT in Git Remote (CRITICAL)

- **File:** `.git/config`
- **Status:** UNCHANGED since v1
- **Action required:** Rotate the token. Switch to SSH auth or credential helper.
- **Note:** This is an operational issue, not a code issue. Cannot be fixed by code changes alone.

### LEAK-003: No Authentication on HTTP Endpoints (HIGH)

- **File:** `server/index.js`, all `/api/ai/*` and `/api/selfplay/*` routes
- **Status:** UNCHANGED
- **Impact:** Anyone with network access can reset models, inject training data, change parameters.
- **Recommendation:** Add API key middleware at minimum for destructive endpoints (`reset`, `train`, `params`).

### LEAK-004: No Authentication on WebSocket Handlers (HIGH)

- **File:** `server/index.js`, `io.on('connection')` handlers
- **Status:** UNCHANGED
- **Impact:** Any WS client can reset the system, corrupt training, change global speed.
- **Note:** `setParams` has a gameMode gate (only `aivai` mode), but `startGame` allows setting any mode first.
- **Recommendation:** Token-based WS auth during handshake.

### LEAK-005/006: State Endpoints Expose Internal Details (MEDIUM)

- **Files:** `GET /api/ai/info`, `GET /api/selfplay/status`
- **Status:** UNCHANGED
- **Impact:** Attackers can fingerprint server, learn model architecture, timing.

---

## Items Verified Clean (no new issues)

| Area | Verdict |
|------|---------|
| API keys/tokens in source code | ✅ None found — no hardcoded secrets in any `.js`/`.jsx` file |
| Git history secrets | ✅ No `.env` files ever committed; no secrets in diff history |
| `localStorage`/`sessionStorage` misuse | ✅ Zero usage in client code |
| `eval()`, `innerHTML`, `dangerouslySetInnerHTML` | ✅ None found |
| SQL injection | ✅ N/A — no SQL database used |
| Path traversal | ✅ All file paths are hardcoded constants (`path.join(__dirname, ...)`) — no user input in paths |
| Sensitive logging | ✅ Server logs only socket IDs, move data, and error messages — no user data or tokens |
| `config.js` secrets | ✅ Contains only UI defaults and server config — no passwords/keys |
| Buffer overflow | ✅ Replay buffer is bounded (circular, maxSize=10000) |
| CORS on Express routes | ✅ Express routes don't set CORS headers (only Socket.IO had the issue, now fixed) |

---

## Summary

| ID | Severity | Category | Status |
|----|----------|----------|--------|
| LEAK-001 | CRITICAL | Credential Leak | **OPEN** — operational fix needed |
| LEAK-002 | HIGH | CORS | **✅ FIXED** |
| LEAK-003 | HIGH | Auth (HTTP) | **OPEN** — architectural change |
| LEAK-004 | HIGH | Auth (WebSocket) | **OPEN** — architectural change |
| LEAK-005 | MEDIUM | Info Disclosure | OPEN |
| LEAK-006 | MEDIUM | Info Disclosure | OPEN |
| LEAK-007 | MEDIUM | Authorization | IMPROVED (validation tightened) |
| LEAK-008 | LOW | Git Security | **✅ FIXED** |
| LEAK-014 | HIGH | Error Response Leak | **✅ FIXED** |
| LEAK-015 | MEDIUM | Error Response Leak | **✅ FIXED** |

**Fixed in this scan: 3 issues (LEAK-002, LEAK-008, LEAK-014/015)**  
**Remaining: 1 CRITICAL, 2 HIGH, 2 MEDIUM**

### Top Priority Actions
1. **Rotate GitHub token** (LEAK-001) — still exposed in `.git/config`
2. **Add authentication** to destructive endpoints (LEAK-003, LEAK-004) — highest impact remaining
3. Consider rate limiting on API endpoints to prevent abuse
