# 🔍 Data Leak & Security Audit — Checkers_vibe
**Date:** 2026-03-23
**Auditor:** hunter-sub-dataleakchecker
**Scope:** Hardcoded credentials, information leakage, CORS, env handling, WebSocket error exposure

---

## Summary

| Category | Status | Notes |
|---|---|---|
| Hardcoded credentials/secrets | ✅ Clean | No passwords, tokens, or API keys found |
| Config.js exposure | ✅ Clean | Only UI colors, port, AI params |
| Server error leakage | ⚠️ Minor | One WebSocket handler leaks raw `err.message` |
| CORS configuration | ⚠️ Warning | Defaults to localhost, but no validation of production value |
| Environment variables | ✅ Clean | Only `PORT`, `CORS_ORIGIN`, `TF_ENABLE_ONEDNN_OPTS` |
| .gitignore coverage | ✅ Good | `.env*`, `models/`, `data/`, `status.json` all excluded |
| Model/training data exposure | ✅ Clean | Binary model files + replay buffer (7.4MB) excluded from git |
| Authentication | 🔴 Missing | No auth on any API or WebSocket endpoint |

---

## Finding 1: No Authentication on API Endpoints
**Severity:** 🔴 High
**Files:** `server/index.js` (all routes), `server/proxy.js`

None of the API endpoints or WebSocket handlers require any authentication. An attacker with network access can:

- `POST /api/ai/train` — inject arbitrary training batches
- `POST /api/ai/params` — modify epsilon, network size, model parameters
- `POST /api/ai/reset` — delete trained models and reset all progress
- `POST /api/ai/restart` — restart model training from scratch
- `POST /api/selfplay/start` / `/stop` — control self-play training
- WebSocket `setParams` — change model configuration in real-time
- WebSocket `reset` — wipe game state

**Recommendation:** Add API key or token-based auth middleware. At minimum for production:
```js
app.use('/api/ai/*', (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (key !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});
```

---

## Finding 2: WebSocket Error Message Leaks Internal Details
**Severity:** ⚠️ Medium
**File:** `server/index.js:324`
**Code:**
```js
socket.emit('error', { message: 'Failed to start game: ' + err.message });
```

Raw `err.message` is sent to the client. If the error originates from the C++ engine or internal Node.js code, it could reveal:
- Internal file paths
- C++ engine error details
- Stack trace fragments (if `err.message` includes them)

**Recommendation:** Use generic error messages for client-facing errors:
```js
socket.emit('error', { message: 'Failed to start game' });
console.error('[WS] startGame error:', err); // full error in server logs only
```

All other WebSocket error handlers already use generic messages — this is the only exception.

---

## Finding 3: CORS Default Allows Only localhost (OK for Dev, Insufficient for Prod)
**Severity:** ⚠️ Low
**Files:** `config.js:29`, `server/index.js:22`

```js
corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000'
```

- Socket.IO also uses this: `cors: { origin: CONFIG.server.corsOrigin }`
- Default is restrictive (localhost only) ✅
- No validation that `CORS_ORIGIN` is a reasonable value (someone could set `*`) ⚠️

**Recommendation:** If deployed publicly, ensure `CORS_ORIGIN` is set to the actual frontend domain. Consider adding validation:
```js
if (corsOrigin === '*') throw new Error('Wildcard CORS not allowed in production');
```

---

## Finding 4: No Rate Limiting
**Severity:** ⚠️ Medium
**Files:** `server/index.js`, `server/proxy.js`

No rate limiting on any endpoint. The training endpoint (`/api/ai/train`) accepts arbitrary batch sizes, and `/api/ai/preset` runs model inference. Self-play can be started/stopped rapidly.

**Recommendation:** Add basic rate limiting:
```js
import rateLimit from 'express-rate-limit';
app.use('/api/', rateLimit({ windowMs: 60000, max: 100 }));
```

---

## Finding 5: Hardcoded localhost URL in Config
**Severity:** ℹ️ Informational
**File:** `config.js:30`

```js
cppBase: 'http://localhost:8080',
```

This is not a security issue per se (it's an internal service URL), but it's hardcoded rather than configurable via env var. The C++ engine address should use an env var for containerized deployments:
```js
cppBase: process.env.CPP_BASE || 'http://localhost:8080',
```

---

## Finding 6: Training Data Not Sensitive But Large
**Severity:** ℹ️ Informational
**Files:** `data/buffer.json` (7.4MB), `data/model/`

The replay buffer contains board states, legal moves, and chosen moves — this is game data, not user data. Model weights are binary neural network parameters. Neither contains PII or credentials. Both are properly excluded from git via `.gitignore`.

---

## What Was Checked and Found Clean

- **grep for passwords/secrets/tokens/API keys:** Only false positives in minified React bundle and test file math calculations (number `10` matching `token` regex, etc.)
- **config.js:** Contains only UI configuration, server port, and AI hyperparameters
- **proxy.js:** Error handler returns generic `"C++ backend unavailable"` message — good ✅
- **.gitignore:** Properly excludes `.env*`, `models/`, `data/`, `status.json`, `secrets/`, `credentials/`, `*.pem`, `*.key`
- **No .env files exist** on disk
- **No internal IPs** (192.168.x, 10.x, 172.x) found in source
- **console.log in server:** No tokens/keys/passwords logged. Only game state, move info, and generic error messages.
- **HTTP API error responses:** Use generic messages (`"Prediction failed"`, `"Training failed"`, `"Reset failed"`) — no stack traces leak to client ✅

---

## Verdict

The codebase is **clean of hardcoded secrets** and **good at hiding internal errors from clients**. The main risk is the **complete lack of authentication** on management endpoints, which is acceptable for local development but critical to fix before any network exposure.
