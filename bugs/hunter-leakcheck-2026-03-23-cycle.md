# Hunter Data-Leak-Checker — Cycle Report

**Date:** 2026-03-23  
**Branch:** main  
**Scanner:** hunter-sub-leakcheck (cycle scan)  
**Scope:** /opt/Checkers_vibe — data leaks, security issues, state exposure  
**Previous reports:** `hunter-leakcheck-2026-03-23.md`, `hunter-leakcheck-2026-03-23-v2.md`

---

## Summary of Previous Fixes

| Issue | Status | Notes |
|-------|--------|-------|
| LEAK-002 (CORS `*`) | ✅ FIXED | Changed to `http://localhost:3000` default, env-overridable |
| LEAK-008 (.gitignore gaps) | ✅ FIXED | `.env`, `.npmrc`, `*.pem`, `*.key`, `secrets/`, `status.json` added |
| LEAK-013 (`/api/ai/train` broken import) | ✅ FIXED | `train` import now present, batch length check exists |
| LEAK-014/015 (Error response leaks) | ✅ FIXED | HTTP and WS error messages sanitized |

---

## Current Findings

### LEAK-016: GitHub PAT Still Exposed in Git Remote

- **File:** `.git/config`
- **Severity:** critical
- **Description:** The `origin` remote URL still contains a GitHub Personal Access Token in plaintext: `https://[REDACTED]@github.com/ArgonZapan/Checkers_vibe.git`. This token has been reported in every previous scan cycle and has NOT been rotated or removed.
- **Impact:** Full repository access. Token is visible via `git remote -v`, `git config`, and would appear in any diagnostic dump or backup.
- **Remediation:** Rotate the token IMMEDIATELY on GitHub. Replace the remote URL with SSH: `git remote set-url origin git@github.com:ArgonZapan/Checkers_vibe.git`. Use `git credential-manager` or SSH keys for authentication.

### LEAK-017: No Authentication on HTTP API Endpoints

- **File:** `server/index.js` (all `/api/ai/*` and `/api/selfplay/*` routes)
- **Severity:** important
- **Description:** No endpoint requires authentication. Destructive endpoints are publicly accessible:
  - `POST /api/ai/reset` — resets all model weights and saved files
  - `POST /api/ai/train` — accepts arbitrary training batches, can corrupt the model
  - `POST /api/ai/params` — changes epsilon, network architecture
  - `POST /api/ai/restart` — restarts model training
  - `POST /api/selfplay/start` and `/stop` — controls self-play loop
- **Impact:** Anyone with network access can reset the model, inject poisoned training data, or manipulate training parameters. Combined with the proxy setup, all `/api/game/*` calls to the C++ engine are also unauthenticated.
- **Remediation:** Add API key middleware for destructive endpoints. At minimum, protect `reset`, `train`, `params`, and `restart`. Consider environment variable `API_KEY` checked in a middleware.

### LEAK-018: No Authentication on WebSocket Handlers

- **File:** `server/index.js` (`io.on('connection')` handlers)
- **Severity:** important
- **Description:** All WebSocket event handlers operate without authentication:
  - `startSelfPlay` / `stopSelfPlay` — control training loop
  - `setParams` — change model architecture (partially gated by gameMode, but `startGame` allows setting any mode first)
  - `reset` — full system reset (model + buffer + game + stats)
  - `setSpeed` — modifies global `CONFIG` object affecting ALL clients
  - `setSpeedMode` — changes server speed mode globally
- **Impact:** Any connected WebSocket client can reset the entire system, corrupt training, or change server behavior for all users.
- **Remediation:** Add token-based WebSocket authentication during handshake (e.g., `socket.handshake.auth.token`). Gate `reset`, `setSpeed`, `setSpeedMode` behind auth. Consider per-socket speed instead of global config mutation.

### LEAK-019: C++ Engine HTTP Server Has No CORS or Access Control

- **File:** `engine/src/server.cpp`
- **Severity:** important
- **Description:** The C++ httplib server binds to `0.0.0.0:8080` (default) with no CORS headers, no authentication, and no origin checking. While the Node.js server proxies to it, the C++ server is directly accessible on port 8080 if the port is exposed. All game endpoints (`/api/move`, `/api/board/set`, `/api/game/reset`, `/api/game/start`) are fully open.
- **Impact:** If the C++ port is reachable (e.g., in Docker with port mapping, or on a shared host), anyone can manipulate game state directly, bypassing any Node.js-level controls. The `/api/board/set` endpoint allows arbitrary board configuration.
- **Remediation:** Bind the C++ server to `127.0.0.1` only (not `0.0.0.0`) since it's an internal service. Or add basic origin/auth checking in the C++ server. Verify Docker/firewall rules don't expose port 8080.

### LEAK-020: `/api/ai/info` Exposes Internal Server State

- **File:** `server/index.js`, `GET /api/ai/info`
- **Severity:** info
- **Description:** Returns internal training state without authentication: network architecture sizes, epsilon exploration values, replay buffer size, game statistics, and whether training is running.
- **Impact:** Information disclosure — attackers can fingerprint the server, understand training state, and time attacks.
- **Remediation:** Remove or add authentication. If needed for debugging, gate behind auth or restrict to localhost.

### LEAK-021: `/api/selfplay/status` Returns Full Trainer Status

- **File:** `server/index.js`, `GET /api/selfplay/status`
- **Severity:** info
- **Description:** Returns `trainer.getStatus()` which includes modelParams (layers, neurons, activation, lr, batchSize, dropout), round timing data, buffer size, and full stats.
- **Impact:** Exposes model architecture details and training performance metrics to unauthenticated users.
- **Remediation:** Return only public-facing status (running/not running, game count) or add auth.

### LEAK-022: `setSpeed` / `setSpeedMode` Modify Global Server Config Without Auth

- **File:** `server/index.js`, WebSocket handlers `setSpeed` and `setSpeedMode`
- **Severity:** info
- **Description:** Any WebSocket client can call `setSpeed` (0-10000ms) or `setSpeedMode` (fast/normal) to modify `CONFIG.server.aiMoveDelayMs`, `CONFIG.server.normalModeDelayMs`, and `CONFIG.server.speedMode`. These are shared mutable config objects affecting ALL connected clients. Validation exists (range check) but no authorization.
- **Impact:** A malicious client can slow down or speed up the game for all users, or switch to fast mode to skip animations.
- **Remediation:** Add authentication. Consider per-socket speed settings instead of global config mutation.

### LEAK-023: Model Files at Predictable Path Under Project Root

- **File:** `data/model/white/model.json`, `data/model/white/weights.bin`, `data/model/black/model.json`, `data/model/black/weights.bin`
- **Severity:** info
- **Description:** Models are saved to predictable paths inside the project directory. The `data/` directory is gitignored (correct), and `express.static` only serves `client/dist/` (correct). However, if any new route or middleware accidentally serves from the project root, model weights could become downloadable.
- **Impact:** Currently low risk. Model weights (289KB each) could reveal the neural network architecture and training state.
- **Remediation:** No immediate action needed. Monitor for any changes to static file serving configuration.

### LEAK-024: `backups/` Directory Contains Training Data Outside .gitignore Scope

- **File:** `backups/20260323/data/data/buffer.json` (6.8MB), `backups/20260322/data/`
- **Severity:** info
- **Description:** The `backups/` directory IS in `.gitignore` (added in commit d43e1ca), so it's not committed to git. However, the backup directory contains full snapshots of buffer.json (training replay data with board states and legal moves) and model weights. These are on disk in plaintext.
- **Impact:** Low — backups are local only and not in git. But the `data/buffer.json` (5.2MB) contains game board states and legal moves which, while not sensitive user data, represent training data investment.
- **Remediation:** No action needed for this project. Consider encryption at rest for production deployments.

---

## Verified Clean Areas

| Area | Verdict |
|------|---------|
| Hardcoded secrets in source code | ✅ None found — no tokens/passwords in `.js`/`.jsx`/`.cpp` files |
| `.env` files | ✅ None exist on disk |
| Git history secrets | ✅ No `.env` or secret files ever committed (checked `git log --diff-filter=D`) |
| `localStorage`/`sessionStorage` misuse | ✅ Zero usage in client code |
| `eval()`, `innerHTML`, `dangerouslySetInnerHTML` | ✅ None found |
| Path traversal vulnerabilities | ✅ All file paths are hardcoded constants (`path.join(__dirname, ...)`) — no user input in paths |
| SQL injection | ✅ N/A — no SQL database used |
| CORS on Express routes | ✅ Only Socket.IO CORS is configured; Express routes don't set CORS headers (correct) |
| Input validation on moves | ✅ WebSocket `move` handler validates coordinates (0-7 range, array type) |
| Input validation on setParams | ✅ Validates layers (1-5), neurons (32-512), batchSize (8-256), dropout (0-0.5) |
| Buffer overflow | ✅ Replay buffer is bounded (circular, maxSize=10000) |
| Sensitive logging | ✅ Server logs socket IDs, move data, and generic error messages — no tokens or user data |
| `config.js` secrets | ✅ Contains only UI defaults and server config — no passwords/keys |

---

## Summary Table

| ID | Severity | Category | Status |
|----|----------|----------|--------|
| LEAK-016 | critical | Credential Leak | **OPEN** — GitHub PAT still in `.git/config`, unrotated across 3 scan cycles |
| LEAK-017 | important | Auth (HTTP) | **OPEN** — no auth on any API endpoint |
| LEAK-018 | important | Auth (WebSocket) | **OPEN** — no auth on any WS handler |
| LEAK-019 | important | Network Exposure | **OPEN** — C++ engine on 0.0.0.0:8080, no auth/CORS |
| LEAK-020 | info | Info Disclosure | OPEN |
| LEAK-021 | info | Info Disclosure | OPEN |
| LEAK-022 | info | Authorization | OPEN |
| LEAK-023 | info | File Exposure | LOW RISK — static serving correct |
| LEAK-024 | info | Data at Rest | OK — backups gitignored |

**Current: 1 critical, 3 important, 5 info**  
**Previously fixed (still fixed): LEAK-002, LEAK-008, LEAK-013, LEAK-014/015**

---

## Top Priority Actions

1. **🚨 Rotate the GitHub token** (LEAK-016) — This has been reported in 3 consecutive scans. The token `[REDACTED]` is compromised. Rotate on GitHub NOW and switch to SSH auth.
2. **Add API key authentication** (LEAK-017, LEAK-018) — At minimum for `reset`, `train`, `params`, `restart` endpoints and WS `reset`, `setParams`, `setSpeed` handlers.
3. **Bind C++ server to localhost** (LEAK-019) — The engine should only listen on `127.0.0.1`, not `0.0.0.0`.
