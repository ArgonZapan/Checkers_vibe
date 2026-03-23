# Dynamic Bug Audit — hunter-alpha-dynbug-2026-03-23

**Project:** Checkers_vibe  
**Tests:** ✅ 1696/1696 passed  
**Scope:** server/index.js, server/proxy.js, client/src/App.jsx, client/src/components/*.jsx  

## Summary

Codebase is solid with excellent test coverage. Found 4 genuine issues (2 low-severity, 2 medium-severity), all security/architecture related. No race conditions, no unhandled promise rejections, no stale closure bugs with real impact. The code shows evidence of prior security hardening (LEAK-001 through LEAK-012).

---

## BUG-DYN-001: CSP `connect-src` allows bare `ws:` — exfiltration vector
- **Severity:** Medium (production) / Low (documented dev limitation)
- **Location:** `server/index.js` — security headers middleware
- **Impact:** `connect-src 'self' ws: wss:` allows `ws://evil.com/steal` — attacker page can exfiltrate data via WebSocket to arbitrary origins
- **Evidence:** Test `__tests__/hunter-security-fixes.test.js` explicitly flags: "bare ws: enables exfiltration: ws://evil.com/steal passes CSP"
- **Status:** Documented as intentional for local dev — not fixed
- **Recommendation:** For production, change to `connect-src 'self' wss:` (drop bare `ws:`)

## BUG-DYN-002: setInterval leaks prevent clean process shutdown
- **Severity:** Low
- **Location:** `server/index.js` — rate limiter cleanup (line ~53) and auto-save timer (line ~490)
- **Impact:** Two `setInterval()` calls with no stored handle for `clearInterval()`. Node.js process cannot exit cleanly — the intervals keep the event loop alive. Not an issue in normal server operation, but prevents graceful shutdown and can cause test runner hangs.
- **Evidence:** No return value captured from either `setInterval()`, no shutdown handler exists.

## BUG-DYN-003: Trainer `cppFetch` missing `res.ok` check and error context
- **Severity:** Medium
- **Location:** `server/ai/trainer.js:172-180` — local `cppFetch` function
- **Impact:** Trainer's cppFetch returns raw `Response` without checking `res.ok`. If C++ engine returns 404/500, the caller tries `res.json()` on error HTML → confusing JSON parse error. Compare with server's `cppFetch` (index.js) which checks `res.ok`, reads error body, and wraps errors with contextual messages.
- **Difference:**
  - Server: `if (!res.ok) { const body = await res.text(); throw new Error(\`C++ ${path} → ${res.status}\`); }`
  - Trainer: just `return res;` — callers must check `.ok` themselves

## BUG-DYN-004: `EMPTY_BOARD()` creates new reference — Board memo bypassed
- **Severity:** Low (performance, not correctness)
- **Location:** `client/src/App.jsx:8` — `EMPTY_BOARD` function definition
- **Impact:** `EMPTY_BOARD()` returns a new array reference on every call. Every `setBoard(EMPTY_BOARD())` in `handleStartPvai`, `handleStartAivai`, `handleReset` triggers Board re-render even though the memo `areEqual` could skip it if a stable reference were used. Board's `areEqual` compares `prevProps.board !== nextProps.board` — always `true` with fresh references.
- **Fix:** Memoize with `useRef` or `useMemo`:
  ```jsx
  const EMPTY_BOARD = useMemo(() => createEmptyBoard(), []);
  ```

---

## Non-Issues (verified clean)

- **Race conditions (selfPlay vs player):** `paramsVersion` guard (#133) and `socket._moveQueue` serialization work correctly. No races found.
- **Unhandled promise rejections:** All async handlers have try/catch. `main().catch()` at process level. Socket move queue resets to `Promise.resolve()` after error.
- **Stale closures:** Board state accessed via refs (`boardRef`, `turnRef`, etc.) — no stale closure bugs.
- **Missing cleanup:** Socket disconnect calls `s.disconnect()`. Toast timer cleared on unmount. Animation RAF cancelled on cleanup. GameTimer clears interval.
- **Rate limiter edge cases:** Window reset, hard cap eviction, per-IP isolation all correct. `trust proxy: false` prevents X-Forwarded-For spoofing.
- **Proxy error handling:** Error handler checks `headersSent` before writing 502. Body re-serialization uses `Buffer.byteLength` for Content-Length. Filter correctly excludes `/ai/` and `/selfplay/` paths.
- **Component props:** Board, Dashboard, GameControls, ParamsPanel all receive expected props. Board uses `React.memo` with custom `areEqual`. Accessibility labels present on interactive elements.
- **TODO/FIXME/HACK:** Only found in test files (C++ engine TODOs for draw detection). No source code TODOs.
