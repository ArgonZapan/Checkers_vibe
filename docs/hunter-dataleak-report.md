# Hunter Alpha — Data Leak Audit Report

**Date:** 2026-03-23  
**Scope:** `/opt/Checkers_vibe` — server, client, config, .env files  
**Prior state:** No regressions found in previous audits  
**Auditor:** data-leak-checker (subagent)

---

## Summary

| Category | Status | Findings |
|---|---|---|
| 1. Hardcoded secrets | ✅ Clean | No tokens, passwords, or API keys found |
| 2. Environment variables | ✅ Clean | Only non-sensitive vars (PORT, TF_ENABLE_ONEDNN_OPTS, CORS origin) |
| 3. WebSocket messages | ✅ Clean | Game state, stats, config — no secrets or internal paths |
| 4. Client bundle | ⚠️ Stale dist | ErrorBoundary dist shows error.message (source fixed, dist not rebuilt) |
| 5. API responses | ✅ Clean | All error catches send generic messages, never err.stack |

---

## Detailed Findings

### 1. Data Leaks — Sensitive Data in Logs/Responses

**Status: CLEAN**

- `server/index.js`: All `catch` blocks log `err.message` to server console only. Client-facing error responses use hardcoded strings like `'Failed to start game'`, `'Prediction failed'`, `'Reset failed'`. No stack traces leak.
- `server/proxy.js` (`cppFetch`): Error messages logged server-side only (`[cppFetch]` prefix). Client receives generic `Error('C++ path → status')` with no file paths exposed.
- Client `console.warn` on error events: logs only `(k?.message) || k` — acceptable for dev, no secrets.

### 2. Environment Variables — Secrets Hardcoded or Leaked

**Status: CLEAN**

- **No .env files exist** on disk (checked `/opt/Checkers_vibe/.env`, `.env.local`, `server/.env`, `client/.env`).
- **No .env files tracked in git** (`git ls-files` confirms).
- `.gitignore` correctly excludes `.env`, `.env.*`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `secrets/`, `credentials/`.
- Environment variables used:
  - `process.env.PORT` — server port (non-sensitive)
  - `process.env.TF_ENABLE_ONEDNN_OPTS` — TensorFlow optimization flag
  - `process.env.CORS_ORIGINS` — CORS config (set in process, not leaked)
- `config.js`: Contains only game/AI parameters (layers, neurons, rewards, buffer sizes). No secrets.

### 3. WebSocket Messages — Internal State Exposure

**Status: CLEAN**

WebSocket events audited:

| Event | Payload | Risk |
|---|---|---|
| `state` | board, turn, gameOver, winner, lastMove, path | ✅ Game state only |
| `legalMoves` | from, moves (filtered) | ✅ Legal moves only |
| `gameOver` | winner, moves count | ✅ Game result only |
| `selfPlayStatus` | active, gameNumber, stats (games/wins/draws) | ✅ Aggregate stats |
| `paramsUpdate` | modelParams, epsilon, networkSize, speedMode, _config | ⚠️ See note below |
| `loss` | loss value | ✅ Training metric |
| `error` | generic message string | ✅ No stack traces |

**Note on `paramsUpdate._config`:** Sends `CONFIG.ai` snapshot to clients on connect. This includes hyperparameters (layers, neurons, lr, batchSize, rewards, buffer size). This is intentional for UI synchronization and contains **no secrets** — only AI training configuration visible to any user of the app.

### 4. Client Bundle — dist/ Exposing Server Internals

**Status: WARNING**

- `client/dist/` contains minified React + socket.io bundle.
- **No server internals** (no `__dirname`, no `process.env`, no file paths, no config.js contents).
- `grep` for server paths in dist returned zero results.

**⚠️ STALE DIST — ErrorBoundary leak (source fixed, dist not rebuilt):**

| File | Timestamp | Shows error.message? |
|---|---|---|
| `client/dist/index.html` | Mar 23 10:59 | — |
| `client/dist/assets/index-Dwf6JLHd.js` | Mar 23 10:59 | **YES** (`this.state.error?.message`) |
| `client/src/components/ErrorBoundary.jsx` | Mar 23 13:09 | **NO** (generic: "Wystąpił nieoczekiwany błąd") |

The source code was updated to show a generic error message, but **the dist bundle was not rebuilt**. If the app serves from `dist/`, React error messages (including internal invariant errors) will be displayed to users. While React errors are typically benign (component lifecycle errors), they can reveal component tree structure.

**Recommendation:** Rebuild client (`npm run build` or equivalent) to pick up the ErrorBoundary fix.

### 5. API Responses — Stack Traces, Internal Paths, Debug Info

**Status: CLEAN**

HTTP API endpoints audited:

| Endpoint | Error Response | Leaks? |
|---|---|---|
| `POST /api/ai/predict` | `{ error: 'Prediction failed' }` | ✅ No |
| `POST /api/ai/train` | `{ error: 'Training failed' }` | ✅ No |
| `POST /api/ai/reset` | `{ error: 'Reset failed' }` | ✅ No |
| `POST /api/ai/restart` | `{ error: 'Reset failed' }` | ✅ No |
| Rate limiting | `{ error: 'Too many requests' }` | ✅ No |
| Input validation | `{ error: 'board must be an array...' }` | ✅ No (descriptive, not internal) |

All validation errors are descriptive but generic (no file paths, no stack traces, no internal variable names).

---

## Verdict

**4/5 categories clean. 1 minor warning (stale dist).**

The codebase is well-hardened against data leaks:
- No secrets anywhere in source, config, or tracked files
- Server errors never expose stack traces to clients
- WebSocket payloads contain only game-relevant data
- API responses use generic error strings

**The only action item: rebuild `client/dist/`** to deploy the updated ErrorBoundary that no longer exposes error messages to users.

---

*End of report.*
