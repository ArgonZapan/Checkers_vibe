# Hunter Data-Leak-Checker — Checkers_vibe

**Date:** 2026-03-23  
**Branch:** fix/hunter-bugfixes  
**Scanner:** hunter-sub-leakcheck  
**Scope:** /opt/Checkers_vibe — data leaks, security issues, state exposure

---

## LEAK-001: GitHub Personal Access Token in Git Remote

- **Severity:** CRITICAL
- **File:** `.git/config` (git remote)
- **Line:** N/A
- **CVSS:** 9.1 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:N)
- **Description:** The `origin` remote URL contains a GitHub Personal Access Token in plaintext:
  `https://[REDACTED]@github.com/ArgonZapan/Checkers_vibe.git`
  This token is visible to anyone with access to the machine and would be included in any `git remote -v` output or diagnostic dumps.
- **Impact:** Full repository access. If this token has broader scopes, it could grant access to other repos, gists, or org resources.
- **Fix:** Rotate the token immediately (`[REDACTED]` is compromised). Use SSH keys or credential helpers instead of embedding tokens in URLs. Use `git remote set-url origin git@github.com:ArgonZapan/Checkers_vibe.git`.

---

## LEAK-002: Socket.IO CORS origin set to wildcard `*`

- **Severity:** HIGH
- **File:** `server/index.js`, line 22
- **CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N)
- **Description:** `new SocketIO(httpServer, { cors: { origin: '*' } })` allows any website to open a WebSocket connection to the server. Combined with no authentication (see LEAK-004), any webpage can interact with the server.
- **Impact:** Cross-origin WebSocket hijacking, CSRF-like attacks via socket.io, unauthorized state manipulation.
- **Fix:** Set `origin` to the specific domain(s) that should access the app, e.g. `origin: 'http://localhost:3000'` or use an environment variable.

---

## LEAK-003: No Authentication on Any API Endpoint

- **Severity:** HIGH
- **File:** `server/index.js`, lines 34-130 (all HTTP endpoints)
- **CVSS:** 8.6 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L)
- **Description:** No endpoint requires authentication. Every route — including destructive and state-altering ones — is publicly accessible:
  - `POST /api/ai/train` — accepts arbitrary training batches, can corrupt the model
  - `POST /api/ai/reset` — resets all model weights, deletes saved files
  - `POST /api/ai/params` — changes epsilon, network architecture
  - `POST /api/ai/restart` — restarts model training
  - `POST /api/selfplay/start` and `/stop` — controls self-play
- **Impact:** Anyone who can reach the server (and with CORS `*`, anyone on any website) can reset the model, inject training data, or manipulate parameters.
- **Fix:** Add authentication middleware (API key, JWT, or at minimum IP allowlisting for sensitive endpoints). At the very least, protect `reset`, `train`, and `params` endpoints.

---

## LEAK-004: WebSocket Handlers Allow Unauthenticated State Manipulation

- **Severity:** HIGH
- **File:** `server/index.js`, lines 200-370 (io.on('connection') handlers)
- **CVSS:** 8.6 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L)
- **Description:** All WebSocket event handlers operate without any authentication:
  - `startSelfPlay` / `stopSelfPlay` — control training loop
  - `setParams` — change model architecture (partially gated by gameMode check, but startGame allows setting any mode)
  - `reset` — full system reset (model + buffer + game)
  - `setSpeed` — change server-side move delay (affects all clients)
  - `setSpeedMode` — change server speed mode
- **Impact:** Any connected WebSocket client can reset the entire system, corrupt training, or change server behavior for all users.
- **Fix:** Add authentication to WebSocket connections (e.g., token-based auth during handshake). The `setParams` handler at least has a gameMode check — similar checks should be applied to `reset`, `setSpeed`, `setSpeedMode`.

---

## LEAK-005: `/api/ai/info` Exposes Internal Server State

- **Severity:** MEDIUM
- **File:** `server/index.js`, lines 35-47
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** The `GET /api/ai/info` endpoint returns internal training state without authentication:
  - Network architecture sizes (`networkSizeWhite`, `networkSizeBlack`)
  - Epsilon exploration values (`epsilonWhite`, `epsilonBlack`)
  - Replay buffer size
  - Game statistics
  - Whether training is running
- **Impact:** Information disclosure. Attackers can fingerprint the server, understand the training state, and time attacks accordingly.
- **Fix:** Remove this endpoint or add authentication. If needed for debugging, gate behind auth.

---

## LEAK-006: `/api/selfplay/status` Returns Full Trainer Status

- **Severity:** MEDIUM
- **File:** `server/index.js`, lines 108-110
- **CVSS:** 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** `GET /api/selfplay/status` returns `trainer.getStatus()` which includes modelParams (layers, neurons, activation, lr, batchSize, dropout), round timing data, and buffer size.
- **Impact:** Exposes model architecture details and training performance metrics.
- **Fix:** Return only public-facing status (running/not running, game count) or add auth.

---

## LEAK-007: `setSpeed` WebSocket Handler Modifies Server Runtime Config

- **Severity:** MEDIUM
- **File:** `server/index.js`, lines 331-339
- **CVSS:** 6.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L)
- **Description:** Any WebSocket client can call `setSpeed` to modify `CONFIG.server.aiMoveDelayMs` and `CONFIG.server.normalModeDelayMs`. This is a shared mutable config that affects ALL connected clients. There is validation (0-60000 range, then clamped to 0-10000) but no authorization.
- **Impact:** A malicious client can slow down or speed up the game for all users.
- **Fix:** Add authentication. Consider per-socket speed settings instead of global config mutation.

---

## LEAK-008: `.gitignore` Missing Sensitive File Patterns

- **Severity:** LOW
- **File:** `.gitignore`
- **CVSS:** 3.7 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** The `.gitignore` does not include patterns for common sensitive files:
  - `.env`, `.env.*` — environment variables/secrets
  - `.npmrc` — may contain auth tokens
  - `secrets/`, `credentials/` — secret storage
  - `*.pem`, `*.key` — private keys
  - `status.json` — exists in the repo root and may contain runtime state
- **Impact:** Risk of accidentally committing secrets if any are added later.
- **Fix:** Add to `.gitignore`:
  ```
  .env
  .env.*
  .npmrc
  secrets/
  credentials/
  *.pem
  *.key
  status.json
  ```

---

## LEAK-009: Model Saved to Potentially Predictable Path

- **Severity:** LOW
- **File:** `server/ai/model.js`, `saveModel()` function
- **CVSS:** 3.1 (AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- **Description:** Models are saved to `data/model/white/` and `data/model/black/` inside the project directory. The `data/` directory is gitignored (good), but the path is predictable and within the project tree. If the web server serves static files from the project root (it doesn't currently — only `client/dist/`), model weights could be downloadable.
- **Impact:** Currently low risk since express.static only serves `client/dist/`. However, a misconfiguration or added route could expose model files.
- **Note:** The `data/` directory IS in `.gitignore`, which is correct. Model weights are not committed to git.

---

## LEAK-010: Replay Buffer Bounded — No Issue

- **Severity:** NONE (informational)
- **File:** `server/ai/buffer.js`
- **Description:** The replay buffer uses a circular buffer with `maxSize` (default 10000 from `CONFIG.ai.bufferSize`). It cannot grow unbounded. The `add()` method overwrites old entries when the buffer is full.
- **Verdict:** No issue. Buffer is properly bounded.

---

## LEAK-011: No Hardcoded Secrets in Client Code

- **Severity:** NONE (informational)
- **Files:** `client/src/App.jsx`, `client/src/main.jsx`
- **Description:** Scanned all client source files. No API keys, tokens, passwords, or secrets found. No `.env` files exist. No `localStorage` usage found. The client connects to `/` (same origin) for WebSocket, which is correct.
- **Verdict:** No issues found in client code.

---

## LEAK-012: No Secrets in `config.js`

- **Severity:** NONE (informational)
- **File:** `config.js`
- **Description:** `config.js` contains only UI configuration (colors, sizes) and server defaults (port, timeouts, AI hyperparameters). No passwords, API keys, or tokens.
- **Verdict:** No issues found. Note that `config.js` IS committed to git, but its contents are safe.

---

## LEAK-013: `POST /api/ai/train` Accepts Arbitrary Training Data

- **Severity:** HIGH
- **File:** `server/index.js`, lines 56-70
- **CVSS:** 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:L)
- **Description:** The `/api/ai/train` endpoint accepts a `batch` array in the request body and passes it directly to `train()`. An attacker can send crafted training data to poison the model. Additionally, `train` is used but never imported — this would throw a ReferenceError at runtime (bug, but also means the endpoint currently doesn't work as intended).
- **Impact:** Model poisoning if the import were fixed. Currently the endpoint is broken (would crash), which is accidentally protective.
- **Fix:** Remove this endpoint or add authentication + input validation. The missing `train` import should also be fixed if the endpoint is intended to work.

---

## Summary

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| LEAK-001 | CRITICAL | Credential Leak | GitHub PAT in git remote URL |
| LEAK-002 | HIGH | CORS | WebSocket CORS origin `*` |
| LEAK-003 | HIGH | Auth | No authentication on any HTTP endpoint |
| LEAK-004 | HIGH | Auth | No authentication on WebSocket handlers |
| LEAK-005 | MEDIUM | Info Disclosure | `/api/ai/info` exposes training state |
| LEAK-006 | MEDIUM | Info Disclosure | `/api/selfplay/status` exposes model params |
| LEAK-007 | MEDIUM | Authorization | `setSpeed` modifies global config without auth |
| LEAK-008 | LOW | Git Security | Missing sensitive file patterns in .gitignore |
| LEAK-009 | LOW | File Exposure | Model saved to predictable project path |
| LEAK-010 | NONE | — | Buffer properly bounded (no issue) |
| LEAK-011 | NONE | — | No secrets in client code |
| LEAK-012 | NONE | — | No secrets in config.js |
| LEAK-013 | HIGH | Input Validation | `/api/ai/train` accepts arbitrary data |

**Total: 4 HIGH, 3 MEDIUM, 2 LOW, 3 informational (no issue)**

### Top Priority Actions
1. **Rotate the compromised GitHub token** (LEAK-001) — do this NOW
2. **Add authentication** to destructive endpoints (LEAK-003, LEAK-004)
3. **Restrict CORS** to specific origins (LEAK-002)
4. **Update .gitignore** with sensitive file patterns (LEAK-008)
