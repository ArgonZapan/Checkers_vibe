# Frontend Checker — Cycle Report
**Date:** 2026-03-23  
**Scanner:** Jarvis Horner (hunter-sub-frontendupdater)  
**Scope:** Client-side code (`/opt/Checkers_vibe/client/`)  
**Previous report:** `hunter-frontchecker-2026-03-23.md` (covered FBUG-001 through FBUG-007)

---

## Summary

| Severity | Count |
|----------|-------|
| Krytyczny | 0 |
| Ważny | 4 |
| Kosmetyczny | 5 |

---

## New Bugs Found

### FBUG-008: Toast timer conflict — error handler vs showToast fight each other
- **Severity:** ważny
- **Plik:** `client/src/App.jsx` — `s.on('error', ...)` (line ~136) and `showToast` (line ~196)
- **Opis:** The `error` socket handler sets a toast and schedules `setTimeout(() => setToast(null), 5000)`. The `showToast` helper uses `setTimeout(() => setToast(null), 3000)`. Neither clears the other's timer. Scenario:
  1. Server sends error → toast appears (5s timer starts)
  2. User clicks "Zastosuj zmiany" → `showToast('✅ ...')` overwrites toast (3s timer starts)
  3. 3s later → `setToast(null)` clears the success toast (OK)
  4. But the original 5s timer is still pending → `setToast(null)` fires again (harmless but wasteful)
  
  Worse scenario:
  1. User clicks "Zastosuj zmiany" → success toast (3s timer)
  2. Server error arrives → error toast overwrites success (5s timer)
  3. 3s later → original timer fires `setToast(null)` → error toast disappears prematurely (only 3s shown instead of 5s)
- **Fix:** Use a single `toastTimerRef` that is cleared before setting a new timeout:
  ```js
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  }, []);
  ```

### FBUG-009: Animation path index out-of-bounds when path changes mid-animation
- **Severity:** ważny
- **Plik:** `client/src/components/Board.jsx` — `movingPieceInfo` calculation (line ~227)
- **Opis:** During multi-capture animation, `animStep` tracks which step of the `path` to display. If a new `path` arrives with fewer steps than the current `animStep`, `path[animStep]` returns `undefined`, causing `col` and `row` to be `undefined`. This feeds into SVG `cx`/`cy` calculations producing `NaN` values, which SVG silently renders as invisible/zero-positioned elements. Not a crash, but can produce ghost pieces or visual glitches.
  
  The `useEffect` for path changes does check `prevPathRef` to prevent re-triggering, but if the path value reference changes (different array instance with same content), or if a genuinely new shorter path arrives, `animStep` could exceed bounds.
- **Fix:** Clamp `animStep` or guard the calculation:
  ```js
  const safeStep = Math.min(animStep, path.length - 1);
  ```

### FBUG-010: PvAI mode — no state re-subscription after disconnect/reconnect
- **Severity:** ważny
- **Plik:** `client/src/App.jsx` — `s.on('reconnect', ...)` handler (line ~80)
- **Opis:** On reconnect, only `aivai` mode triggers re-subscription (`s.emit('startGame', ...)`). In `pvai` mode, after reconnect the client relies on the server sending a `state` event automatically. If the server doesn't push state on reconnect (only on moves), the client shows a stale board until the next AI move. The board, turn, and game state could be out of sync with the server.
- **Fix:** Also re-subscribe in pvai mode, or emit a `getState` request:
  ```js
  s.on('reconnect', () => {
    setConnected(true);
    setReconnectAttempts(0);
    if (modeRef.current === 'aivai' || modeRef.current === 'pvai') {
      s.emit('startGame', { mode: modeRef.current });
    }
  });
  ```

### FBUG-011: Dashboard canvas — HTML height attribute vs CSS height mismatch
- **Severity:** ważny
- **Plik:** `client/src/components/Dashboard.jsx` (line ~148) + `client/src/index.css` (`.loss-chart`)
- **Opis:** The `<canvas>` element has `height={100}` (HTML attribute, sets intrinsic canvas resolution to 100px), but CSS `.loss-chart { height: 80px }` forces display height to 80px. This causes vertical squishing of the chart — the drawn content is rendered at 100px resolution but displayed at 80px, distorting the loss curve proportions. The `canvas.width` is set dynamically to `container.clientWidth` in the effect, but `canvas.height` is never set dynamically.
- **Fix:** Either set `canvas.height` dynamically in the effect (matching CSS), or change the HTML attribute to 80, or remove the CSS height and let the attribute control it:
  ```js
  // In the useEffect:
  canvas.height = 100; // match HTML attribute or CSS
  ```

### FBUG-012: Missing sub-component ErrorBoundaries — Board/Dashboard/ParamsPanel crash kills entire app
- **Severity:** ważny
- **Plik:** `client/src/App.jsx` (render), `client/src/main.jsx`
- **Opis:** The only ErrorBoundary wraps the entire `<App />` in `main.jsx`. If `Board`, `Dashboard`, or `ParamsPanel` throws during render (e.g., null dereference on corrupted board state, canvas context error), the entire app shows the error screen instead of gracefully degrading. A corrupted board state from the server could crash Board.jsx and make the dashboard/params inaccessible too.
- **Fix:** Wrap each major section in its own ErrorBoundary:
  ```jsx
  <ErrorBoundary fallback={<div>Board unavailable</div>}>
    <Board ... />
  </ErrorBoundary>
  ```

---

## Cosmetic Issues

### FBUG-013: handleToggleSelfplay recreates callback on every selfPlayActive change
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx` — `handleToggleSelfplay` (line ~216)
- **Opis:** `useCallback` depends on `[selfPlayActive]`, which changes every time self-play starts/stops. This causes the `ParamsPanel` to receive a new `onToggleSelfplay` prop reference, triggering a re-render. Not a functional bug but an unnecessary re-render.
- **Fix:** Use ref pattern:
  ```js
  const selfPlayActiveRef = useRef(selfPlayActive);
  selfPlayActiveRef.current = selfPlayActive;
  const handleToggleSelfplay = useCallback(() => {
    if (selfPlayActiveRef.current) {
      socketRef.current?.emit('stopSelfPlay');
    } else {
      socketRef.current?.emit('startSelfPlay');
    }
  }, []);
  ```

### FBUG-014: Loss history slice uses slice(1) instead of slice(-1000)
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx` — `s.on('loss', ...)` handler (line ~122)
- **Opis:** When loss history reaches 1000 items, it uses `prev.slice(1)` which creates a new array by removing the first element. Functionally correct, but `prev.slice(-999)` or keeping a ring buffer would be more conventional. The current approach creates a new array copy on every loss event once the cap is hit.
- **Fix:** Minor — could use `prev.slice(-1000)` for consistency, or a more efficient ring buffer.

### FBUG-015: Board `useEffect` for ref sync runs on every render without dependency array
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/Board.jsx` — second `useEffect` (ref sync for animation detection)
- **Opis:** The effect that updates `prevBoardRef.current` and `animPrevBoardRef.current` runs on every render (no dependency array). This is intentional but could be narrowed to `[board]` since those refs only track board state changes.
- **Fix:** Add `[board]` dependency or keep as-is (intentional pattern).

### FBUG-016: modelParams shared between white and black SideTab — changes affect both
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx` + `client/src/components/ParamsPanel.jsx`
- **Opis:** Both white and black `SideTab` components receive the same `modelParams` object and the same `onModelParamsChange` callback. Changing learning rate in the white tab also changes it in the black tab (and vice versa). The tabs give the illusion of independent configuration but actually share state.
- **Fix:** This is a design decision (shared model architecture). If independent models are desired, split `modelParams` into `whiteModelParams` and `blackModelParams`.

### FBUG-017: Toast notification has no fade-out animation — abrupt disappearance
- **Severity:** kosmetyczny
- **Plik:** `client/src/index.css` — `.toast-notification`
- **Opis:** Toast has `animation: toast-in 0.3s ease-out` for appearing, but disappears abruptly when `setToast(null)` is called (React removes the DOM node instantly). No fade-out transition.
- **Fix:** Use CSS transition or `react-transition-group` for smooth exit, or add a `toast-out` class before clearing.

---

## Memory Leak Audit (Re-check)

| Mechanism | Cleanup | Status |
|-----------|---------|--------|
| `socket.io` | `s.disconnect()` on unmount ✅ | OK |
| `requestAnimationFrame` | `cancelAnimationFrame` in cleanup ✅ | OK |
| `setTimeout` (multi-capture) | `timersRef.forEach(clearTimeout)` ✅ | OK |
| `setInterval` (GameTimer) | `clearInterval` in cleanup ✅ | OK |
| Debounce timer (ParamsPanel) | `clearTimeout` in cleanup ✅ | OK (fixed in prior report) |
| `setTimeout` (showToast) | **NOT cleaned up** ⚠️ | FBUG-008 (see above) |
| `setTimeout` (error handler) | **NOT cleaned up** ⚠️ | FBUG-008 (see above) |

No new memory leaks found beyond those in the previous report.

---

## Verified Non-Issues

- **Socket listener cleanup on unmount:** `s.disconnect()` removes all listeners. No leak.
- **Board `React.memo` with `areEqual`:** Correct shallow comparison. No missed updates.
- **`prevBoardRef` deep copy in animation effect:** Properly deep-copies with `.map(row => row.map(cell => cell ? {...cell} : null))`.
- **`legalMoves` Set lookup:** O(1) `Set.has()` for valid move targets. Correct.
- **PvAI piece selection race condition:** Intentionally allows selecting white pieces regardless of turn. Design decision, not a bug.
- **GameTimer interval cleanup:** Properly clears on unmount and game over.
- **MoveHistory component:** Not imported/used in App.jsx (App builds its own move history inline). The `MoveHistory.jsx` component is dead code — not a bug but worth noting.

---

## Positive Observations (Additional)

- **Refs pattern** for stable callback access across socket events — well implemented
- **Multi-capture animation** with step-by-step timers — creative approach, properly cleaned up
- **Server-side error display** via toast — good UX for rejected moves/params
- **Reconnection config** — infinite attempts with exponential backoff (1s-10s)
- **Speed mode (⚡/🏃/🐢)** — well integrated across menu and controls
- **Canvas chart** — efficient redraw on data change, minimal DOM thrashing
