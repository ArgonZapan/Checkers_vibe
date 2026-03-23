# Security Leak Check — Checkers_vibe
**Date:** 2026-03-23
**Agent:** hunter-sub-leakcheck
**Tests:** 1810 passed, 0 failed

## Summary

The project is **mostly clean** — previous hardening (hunter-sub-dynbug commit) already addressed the most critical CSP issue. One additional fix applied: client config isolation.

---

## Audit Results

### 1. CSP Header — `ws:` bare scheme
**Status: ✅ Already fixed in HEAD (hunter-sub-dynbug) + tests updated**

The `server/index.js` already has dynamic CSP with `wsDirectives` controlled by `CSP_ALLOW_WS` env var:
```js
const wsDirectives = process.env.CSP_ALLOW_WS === 'true' ? 'ws: wss:' : 'wss:';
```
Production default: `wss:` only. `ws:` requires explicit `CSP_ALLOW_WS=true`.

Updated 6 test files that still hardcoded `ws: wss:` to match the new production default.

### 2. Error Responses — stack trace / config leaks
**Status: ✅ Clean**

All error endpoints return generic messages:
- `{ error: 'Prediction failed' }` (500)
- `{ error: 'Training failed' }` (500)
- `{ error: 'Reset failed' }` (500)
- `{ error: 'Move failed' }` (WS)
- `{ error: 'Failed to start game' }` (WS)

Stack traces go to `console.error` only (server-side logs), never in response body. No `err.stack` in any response.

### 3. Proxy Error Handler
**Status: ✅ Clean**

```js
error: (err, _req, res) => {
  console.error('[Proxy] C++ backend error:', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'C++ backend unavailable' }));
  }
}
```
Returns generic "C++ backend unavailable". Does NOT expose `CPP_TARGET` (`http://localhost:8080`) or internal URLs.

### 4. Config.js — client bundle exposure
**Status: ⚠️ Fixed**

`config.js` contained `server.cppBase: 'http://localhost:8080'` and the client imported the entire CONFIG object. While localhost:8080 isn't reachable from outside, it's unnecessary infrastructure disclosure.

**Fix applied:**
- Created `client/boardConfig.js` — exports only `BOARD_CONFIG` (colors, cell size, animation)
- Updated `client/src/components/Board.jsx` to import from `boardConfig.js` instead of `config.js`
- Bundler now only includes board UI config, not server internals

### 5. socket.io `selfPlayStatus` — model detail leaks
**Status: ✅ Clean**

`selfPlayStatus` emits:
- `active` (boolean), `gameNumber` (int), `stats` (gamesPlayed, wins, draws)
- `avgTime`, `roundTimes`, `totalTimeMs` (performance metrics)

None leak model weights, internal paths, or sensitive architecture details beyond what `paramsUpdate` already sends (user-tunable params).

### 6. .env / env vars exposure
**Status: ✅ Clean**

No `.env` file exists. `process.env` usage:
- `TF_ENABLE_ONEDNN_OPTS` — performance tuning
- `PORT` — server port
- `HOST` — bind address
- `CORS_ORIGIN` — CORS config

None are secrets. `config.js` reads `CORS_ORIGIN` with a safe default.

---

## Fixes Applied

| Fix | Commit |
|-----|--------|
| CSP test updates (match wss:-only production default) | `1ceed3e` |
| Client config isolation (boardConfig.js) | `1ceed3e` |

## No Action Needed
- Error responses: no stack trace leaks
- Proxy handler: no internal URL exposure
- selfPlayStatus: no model weight/detail leaks
- .env: no secrets exposed
