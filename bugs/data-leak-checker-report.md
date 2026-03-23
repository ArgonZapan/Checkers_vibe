# Data Leak Checker — Security Audit Report
**Date:** 2026-03-23  
**Auditor:** Jarvis Horner (data-leak-checker)  
**Scope:** `/opt/Checkers_vibe` (excluding `node_modules`)  
**Files audited:** `server/index.js`, `server/proxy.js`, `server/ai/model.js`, `server/ai/trainer.js`, `config.js`, `engine/src/server.cpp`

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 3 |
| Info | 3 |

---

## Findings

### 🔴 LEAK-001: No WebSocket Authentication — Any Client Can Control Game
- **Location:** `server/index.js:~155` (io.on('connection'))
- **Type:** information-disclosure / injection
- **Severity:** **Critical**
- **Problem:** WebSocket connections have zero authentication. Any client that connects can call `startGame`, `move`, `startSelfPlay`, `stopSelfPlay`, `reset`, `setParams`, `setSpeed`, `setSpeedMode`. There is no auth token, no session verification, no origin check beyond CORS.
- **Impact:** An attacker on the same network or a rogue browser tab can:
  - Stop/start self-play training
  - Reset the model (destroying trained weights)
  - Change model parameters (poisoning the AI)
  - Set speed to 0 (DoS on CPU via infinite self-play)
- **Fix:** Implement WebSocket authentication (JWT token, session cookie, or API key). Verify token on `connection` event and disconnect unauthorized clients. Add auth middleware to Socket.IO:
  ```js
  const io = new SocketIO(httpServer, {
    cors: { origin: CONFIG.server.corsOrigin },
    connectionStateRecovery: {},
    // Add auth verification
  });
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!verifyToken(token)) return next(new Error('Unauthorized'));
    next();
  });
  ```

### 🟠 LEAK-002: Config Object Broadcast to All WebSocket Clients
- **Location:** `server/index.js:~164-173`
- **Type:** information-disclosure
- **Severity:** **High**
- **Problem:** On every new WebSocket connection, the server sends `_config: CONFIG.ai` (full AI config snapshot) to the client. This exposes internal server configuration including buffer sizes, training epochs, gamma, epsilon decay rates, and model architecture defaults.
- **Impact:** Information disclosure — an attacker learns server internals useful for crafting targeted attacks (e.g., buffer overflow via oversized training batches, knowing exact model architecture).
- **Fix:** Remove `_config: CONFIG.ai` from the `paramsUpdate` emit. Send only the minimum UI-required fields:
  ```js
  socket.emit('paramsUpdate', {
    modelParams: { ...trainer.modelParams },
    whiteEpsilon: trainer.epsilonWhite,
    blackEpsilon: trainer.epsilonBlack,
    // REMOVE: _config: CONFIG.ai
  });
  ```

### 🟠 LEAK-003: Overly Verbose Error Messages in C++ Engine
- **Location:** `engine/src/server.cpp:~177, ~213`
- **Type:** information-disclosure
- **Severity:** **High**
- **Problem:** The C++ backend returns raw exception messages to clients:
  ```cpp
  err["error"] = std::string("invalid json: ") + e.what();
  err["error"] = std::string("invalid type in request: ") + e.what();
  err["error"] = e.what();  // raw std::exception
  ```
- **Impact:** `e.what()` may contain stack traces, memory addresses, or internal implementation details. This is a classic information-disclosure vulnerability.
- **Fix:** Return generic error messages to clients, log detailed errors server-side:
  ```cpp
  // In /api/move catch blocks:
  case json::parse_error& e:
      err["error"] = "invalid request format";
      // Log e.what() server-side only
  case std::exception& e:
      err["error"] = "internal error";
      // Log e.what() server-side only
  ```

### 🟠 LEAK-004: Socket.IO Broadcasts Game State to ALL Connected Clients
- **Location:** `server/index.js:~196` (PvP mode: `io.emit('state', ...)`)
- **Type:** information-disclosure
- **Severity:** **High**
- **Problem:** In PvP mode, game state is broadcast via `io.emit()` to ALL connected WebSocket clients, not just the two players. Any connected client can observe all PvP games in real-time.
- **Impact:** Spectators can see opponents' game states without consent. In a competitive context, this is a privacy leak.
- **Fix:** Use Socket.IO rooms to isolate game sessions:
  ```js
  // Create a room per game
  socket.join(`game:${gameId}`);
  io.to(`game:${gameId}`).emit('state', statePayload);
  ```

### 🟠 LEAK-005: Rate Limiting Uses In-Memory Map — Not Effective Behind Proxy
- **Location:** `server/index.js:~36-58`
- **Type:** dos
- **Severity:** **High**
- **Problem:** Rate limiting is implemented as an in-memory `Map` keyed by `req.ip`. While `trust proxy` is set to `false` (good), the implementation has weaknesses:
  1. No rate limiting on WebSocket connections/events (only HTTP routes)
  2. The 120 req/min limit is generous for a checkers app
  3. No burst protection — 120 requests in 1 second is allowed within a window
  4. WebSocket `move` events are only throttled at 50ms per socket (20/sec), which is still high
- **Impact:** A single client can still make 120 HTTP requests per minute and 20 moves per second via WebSocket, potentially exhausting CPU.
- **Fix:** 
  - Add per-event WebSocket rate limiting (not just move)
  - Implement burst detection (token bucket or sliding window)
  - Consider using `express-rate-limit` package with Redis store for production
  - Add connection rate limiting: max N connections per IP

### 🟡 LEAK-006: No `strict-origin-when-cross-origin` for WebSocket Upgrade Requests
- **Location:** `server/index.js:~22-25` (Socket.IO config)
- **Type:** csrf
- **Severity:** **Medium**
- **Problem:** The Socket.IO CORS config only sets `origin` but doesn't restrict methods or headers. WebSocket upgrade requests bypass the Express middleware chain where CSP headers are set. The CSP header (`connect-src 'self' ws: wss:`) on page responses doesn't prevent WebSocket connections from malicious pages since WebSocket upgrades are separate HTTP requests.
- **Impact:** A malicious site could potentially open WebSocket connections to the server if the user's browser allows it (depends on browser WebSocket origin policy, which varies).
- **Fix:** Add explicit origin verification in Socket.IO and restrict allowed transports:
  ```js
  const io = new SocketIO(httpServer, {
    cors: { 
      origin: (origin, cb) => {
        if (origin === CONFIG.server.corsOrigin) cb(null, true);
        else cb(new Error('Not allowed'));
      },
      methods: ['GET', 'POST']
    },
    transports: ['websocket']  // disable polling to reduce attack surface
  });
  ```

### 🟡 LEAK-007: CSP Missing `upgrade-insecure-requests` Directive
- **Location:** `server/index.js:~16-22`
- **Type:** csrf
- **Severity:** **Medium**
- **Problem:** The CSP header is solid overall but missing:
  - `upgrade-insecure-requests` — no automatic HTTP→HTTPS upgrade
  - `base-uri 'self'` — allows `<base>` tag injection
  - `form-action 'self'` — allows form submission to external sites
  - No `Strict-Transport-Security` (HSTS) header
- **Impact:** MitM attacks possible if deployed without HTTPS. `<base>` tag injection could redirect relative URLs.
- **Fix:** Add to security headers middleware:
  ```js
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Update CSP to include:
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; 
   font-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none';
   base-uri 'self'; form-action 'self'; upgrade-insecure-requests"
  ```

### 🟡 LEAK-008: C++ Engine Binds to localhost Without Access Control
- **Location:** `config.js:30` (`cppBase: 'http://localhost:8080'`)
- **Type:** information-disclosure
- **Severity:** **Medium**
- **Problem:** The C++ engine (httplib) listens on localhost:8080 with no authentication. Any local process can send requests to `/api/board/set` to arbitrarily set the board state, potentially exploiting the game engine.
- **Impact:** On a shared host, any local user can manipulate the game engine. The `/api/board/set` endpoint accepts arbitrary board configurations without validation of game rules (only value range 0-4).
- **Fix:** Add authentication to the C++ engine's HTTP server (e.g., a shared secret header check), or use Unix sockets instead of TCP.

### 🟡 LEAK-009: `express.json({ limit: '1mb' })` — Large Payload Acceptance
- **Location:** `server/index.js:~30`
- **Type:** dos
- **Severity:** **Medium**
- **Problem:** The JSON body parser accepts payloads up to 1MB. The `/api/ai/train` endpoint accepts batches up to 10,000 samples. A 1MB JSON payload with 10,000 samples could cause memory pressure.
- **Impact:** Memory exhaustion DoS — an attacker could send large training batches to consume server memory.
- **Fix:** Reduce JSON limit for non-training endpoints:
  ```js
  app.use(express.json({ limit: '100kb' }));  // Default for most endpoints
  app.post('/api/ai/train', express.json({ limit: '5mb' }), async (req, res) => { ... });
  ```

### 🟡 LEAK-010: WebSocket `setParams` Allows Arbitrary Model Architecture Changes
- **Location:** `server/index.js:~263-320` (setParams handler)
- **Type:** dos
- **Severity:** **Medium**
- **Problem:** While there's a whitelist of allowed keys (`ALLOWED_PARAMS`), any connected WebSocket client (in aivai mode) can change model architecture (layers, neurons, activation, lr, dropout). This forces model recreation and buffer clearing.
- **Impact:** A rogue client could set `layers: 5, neurons: 512` to create a massive model that exhausts memory, or set `lr: 0.1` to destroy model convergence.
- **Fix:** Restrict `setParams` to authenticated admin users only. Add server-side rate limiting for parameter changes (not just per-socket throttling).

### 🔵 LEAK-011: `__dirname` Computation Exposes Server File Structure
- **Location:** `server/index.js:~12-13`, `server/ai/model.js:~1-2`, `server/ai/trainer.js:~9`
- **Type:** information-disclosure
- **Severity:** **Low**
- **Problem:** Error messages from file operations (model save/load, buffer save/load) may include file paths. While errors are caught and logged, some propagate to WebSocket error events.
- **Impact:** Minor — error messages could reveal internal directory structure.
- **Fix:** Sanitize error messages before sending to clients. Use generic messages.

### 🔵 LEAK-012: C++ Engine Exception Details Leak in HTTP Responses
- **Location:** `engine/src/server.cpp:~177` (`catch (json::parse_error& e)`)
- **Type:** information-disclosure
- **Severity:** **Low**
- **Problem:** `e.what()` from nlohmann/json exceptions can include byte offsets and parsing context.
- **Impact:** Reveals JSON parsing internals.
- **Fix:** Generic error message for parse errors.

### 🔵 LEAK-013: No Request ID / Correlation ID for Tracing
- **Location:** `server/index.js` (global)
- **Type:** information-disclosure
- **Severity:** **Low**
- **Problem:** No request tracing. When errors occur, there's no way to correlate client-side errors with server-side logs.
- **Impact:** Operational — makes debugging harder, not directly a security issue.
- **Fix:** Add `X-Request-ID` header generation and include it in all responses.

### ℹ️ INFO-001: `app.set('trust proxy', false)` Set Twice
- **Location:** `server/index.js:~10,~13`
- **Type:** info
- **Severity:** Info
- **Problem:** Duplicate `app.set('trust proxy', false)` call. Harmless but indicates code quality issue.
- **Fix:** Remove duplicate line.

### ℹ️ INFO-002: WebSocket Throttle Uses 50ms — Allows 20 Moves/Second
- **Location:** `server/index.js:~133` (`wsThrottle(socket, 'move', 50)`)
- **Type:** info
- **Severity:** Info
- **Problem:** Move throttle allows 20 moves per second. While the C++ engine processes one move at a time, this could still cause queue buildup.
- **Fix:** Consider increasing to 200ms (5 moves/sec) for human players.

### ℹ️ INFO-003: Proxy Passes All Non-AI API Routes to C++ Engine
- **Location:** `server/proxy.js:~14-17`
- **Type:** info
- **Severity:** Info
- **Problem:** The proxy filter only excludes `/ai/` and `/selfplay/` prefixed routes. Any new API route added to the C++ engine is automatically proxied without Node.js-side validation.
- **Impact:** If the C++ engine adds endpoints with sensitive operations, they'll be exposed through the proxy without additional security.
- **Fix:** Consider an explicit allowlist instead of a blocklist for proxy routes.

---

## Positive Security Measures Found ✅

1. **CSP headers** — Well-configured Content-Security-Policy with restrictive directives
2. **X-Frame-Options: DENY** — Prevents clickjacking
3. **X-Content-Type-Options: nosniff** — Prevents MIME sniffing
4. **Referrer-Policy: strict-origin-when-cross-origin** — Good privacy setting
5. **Permissions-Policy** — Disables camera, microphone, geolocation
6. **X-Powered-By disabled** — Prevents framework fingerprinting
7. **Input validation on board array** — Proper validation of board elements (0-4 range)
8. **Input validation on move coordinates** — Validates [row, col] in 0-7 range
9. **Captures array validation** — Each capture coordinate is validated
10. **Epsilon validation** — Rejects NaN/Infinity values
11. **Whitelist for setParams keys** — Prevents arbitrary property injection
12. **Move queue serialization** — Per-socket promise chain prevents race conditions
13. **Engine health checks** — Detects and recovers from C++ engine crashes
14. **Atomic file writes** — State saves use temp→rename pattern

---

## Recommendations Priority

1. **Immediate (Critical):** Add WebSocket authentication
2. **Short-term (High):** Remove CONFIG broadcast, sanitize C++ errors, implement room-based WebSocket isolation
3. **Medium-term:** Add HSTS, improve CSP, reduce JSON limits, add C++ engine auth
4. **Long-term:** Implement proper session management, request tracing, audit logging
