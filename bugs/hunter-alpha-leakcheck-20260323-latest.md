# Data Leak & Security Audit — Checkers_vibe
**Date:** 2026-03-23
**Agent:** hunter-sub-leakcheck
**Branch:** main

## Summary

| Metric | Value |
|--------|-------|
| Leaks found | 1 (critical) + 4 (informational) |
| Leaks fixed | 1 |
| Tests written | 5 |
| Escalations | 0 |

---

## CRITICAL: C++ Exception Message Leak (FIXED)

**File:** `engine/src/server.cpp` — `/api/move` handler
**Severity:** CRITICAL
**Lines affected:** 227, 232, 237 (original)

### Problem
The `/api/move` endpoint caught three exception types and sent `e.what()` directly to the HTTP response:

1. `json::parse_error` → `"invalid json: " + e.what()` — leaks internal JSON parsing details, buffer contents
2. `json::type_error` → `"invalid type in request: " + e.what()` — leaks type information, expected schema
3. `std::exception` → `e.what()` — leaks ANYTHING (file paths, memory addresses, internal errors)

**Contrast:** The `/api/board/set` endpoint already handled this correctly — using `catch (json::parse_error&)` without binding `e`, sending generic messages.

### Fix
Replaced all three catch blocks to use generic error messages:
- `json::parse_error` → `"invalid json in request"`
- `json::type_error` → `"invalid type in request"`
- `std::exception` → `"internal error"`

### Test
`__tests__/hunter-alpha-leak-001-cpp-exception.test.js` — 5 tests, all passing.

---

## Informational: Server-Side Logging (No Fix Needed)

These are server-side console logs only — not exposed to clients via HTTP responses.

| Item | Location | Notes |
|------|----------|-------|
| Socket IDs logged | `server/index.js` (7 locations) | Random, ephemeral, server-side only |
| Internal backend URL logged | `server/proxy.js:32` | `http://localhost:8080` in server-side log only |
| C++ error codes logged | `server/index.js:289` | HTTP status codes in server-side log only |

---

## Good Practices Verified (No Issues)

- ✅ Config uses env vars (`CORS_ORIGIN`, `CSP_ALLOW_WS`) — no hardcoded secrets
- ✅ No `.env` files containing secrets
- ✅ CSP, X-Frame-Options, X-Content-Type-Options all set
- ✅ Rate limiting with memory cleanup
- ✅ `trust proxy: false` prevents IP spoofing
- ✅ Socket.io params whitelist prevents prototype pollution
- ✅ Node.js errors log only `err.message`, never stack traces
- ✅ Proxy error handler sends generic "C++ backend unavailable" message
- ✅ `process.env` never referenced in error responses to clients

---

## Files Changed

1. `engine/src/server.cpp` — replaced `e.what()` with generic messages in 3 catch blocks
2. `__tests__/hunter-alpha-leak-001-cpp-exception.test.js` — new test file (5 tests)
