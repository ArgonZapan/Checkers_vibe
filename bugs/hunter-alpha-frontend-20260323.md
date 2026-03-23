# Frontend Audit — Checkers_vibe/client

**Date:** 2026-03-23
**Auditor:** Jarvis Horner (hunter-sub-frontend)
**Scope:** `client/index.html`, `client/src/**`, `client/src/index.css`, `client/boardConfig.js`

---

## 1. Accessibility Issues

### BUG-F001: SVG board lacks grid keyboard navigation
- **Severity:** HIGH
- **Location:** `Board.jsx` lines 398–400 (`<svg role="img" ...>`)
- **Description:** The SVG uses `role="img"` which makes all children inaccessible to keyboard users as a navigable grid. Individual cells have `tabIndex={0}` and `role="button"`, but there's no 2D keyboard navigation (arrow keys to move between cells). A keyboard user must Tab through all 64 cells sequentially. WAI-ARIA recommends `role="grid"` with arrow-key navigation for board games.
- **Fix:** Change `role="img"` to `role="grid"`, add `role="row"` grouping, and implement arrow-key navigation between cells using `onKeyDown` at the SVG/grid level. Track focused cell with state, move focus on arrow keys.

### BUG-F002: Both cell rect and piece `<g>` have click handlers — duplicate event firing
- **Severity:** MEDIUM
- **Location:** `Board.jsx` lines 275–279 (cell `onClick`), line 329 (piece `<g onClick>`)
- **Description:** When a piece exists on a dark square, clicking the piece triggers both the `<g>` `onClick` AND the `<rect>` `onClick` (via event bubbling). This causes `onCellClick(row, col)` to fire twice. The handlers are idempotent (same coordinates), so no crash, but it's wasteful and could cause issues if the handler side-effects change.
- **Fix:** Either remove `onClick` from the piece `<g>` (since the cell rect already handles it), or add `e.stopPropagation()` on the piece `<g>` click handler.

### BUG-F003: Tab panel ARIA attributes are incomplete
- **Severity:** MEDIUM
- **Location:** `ParamsPanel.jsx` lines 218–250
- **Description:** Tabs set `aria-controls="panel-white"`, `aria-controls="panel-black"`, `aria-controls="panel-general"`, but the corresponding tab content divs (lines 253–295) have no `id` attributes and no `role="tabpanel"`. Screen readers cannot associate tabs with their content panels.
- **Fix:** Add `id="panel-white"`, `id="panel-black"`, `id="panel-general"` and `role="tabpanel"` to the respective content divs inside `.params-tab-content`.

### BUG-F004: No Escape key handling on game-over overlay
- **Severity:** MEDIUM
- **Location:** `Board.jsx` lines 383–404 (`.game-over-overlay`)
- **Description:** The overlay has `role="dialog"` and `aria-modal="true"` with Tab trapping, but pressing Escape does nothing. The user must click "Nowa gra" to dismiss it.
- **Fix:** Add `onKeyDown={(e) => { if (e.key === 'Escape') onReset(); }}` to the overlay.

### BUG-F005: Mixed Polish/English in ARIA labels
- **Severity:** LOW
- **Location:** `Board.jsx` lines 272, 329; `App.jsx` line 259
- **Description:** Some ARIA labels are in English ("White king at d3", "Checkers board, white's turn"), others in Polish ("biały król", "zbicie"). The HTML `lang="pl"` implies Polish content, but screen readers will mispronounce English labels.
- **Fix:** Use consistent language matching `html lang="pl"`, or use `lang="en"` on English labels as `aria-label` override.

### BUG-F006: Game-over overlay missing `aria-labelledby`
- **Severity:** LOW
- **Location:** `Board.jsx` line 385
- **Description:** `aria-label="Game over"` is generic. The `<h2>` inside contains the actual result text. Best practice is `aria-labelledby` pointing to the heading.
- **Fix:** Add `id="game-over-heading"` to the `<h2>`, change overlay to `aria-labelledby="game-over-heading"`.

---

## 2. Memory Leaks

### BUG-F007: Dashboard resize listener not fully cleaned up
- **Severity:** MEDIUM
- **Location:** `Dashboard.jsx` lines 57–64
- **Description:** The `useEffect` adds a `resize` listener and returns a cleanup that calls `clearTimeout(resizeTimer)` and `removeEventListener`. However, if the component unmounts while a debounced `setTimeout` is pending, that timeout fires and calls `drawLossChart(canvasRef.current, ...)` on a stale ref. The cleanup clears the timer correctly — this is actually fine. BUT: if `canvasRef.current` becomes null between the timer scheduling and firing, `drawLossChart` returns early (line 12 check), so no crash. **Verdict: minor risk, not a hard leak, but the cleanup is correct.**

### BUG-F008: `lossHistory` unbounded growth after 1000 items
- **Severity:** LOW
- **Location:** `App.jsx` lines 175–180
- **Description:** `lossHistory` is capped at 1000 items but never reduces below that. After 1000 entries, it becomes a sliding window of 1000 — this is fine. But the `loss` event listener (line 174) fires frequently during self-play, and each call creates a new array via spread + slice. In a long self-play session, this churns memory.
- **Fix:** Consider using a circular buffer or `useRef` for the raw data, only keeping derived state for rendering.

### BUG-F009: Dashboard chart redraws on every `lossHistory` change
- **Severity:** LOW
- **Location:** `Dashboard.jsx` lines 67–69
- **Description:** The second `useEffect` redraws the chart whenever `lossHistory` changes. During self-play, `loss` events arrive rapidly, each triggering a full canvas redraw. Not a memory leak but performance waste.
- **Fix:** Throttle/redraw on a timer (e.g., every 500ms) instead of every state update.

---

## 3. Mobile / Responsive Issues

### BUG-F010: No minimum board width on small screens
- **Severity:** MEDIUM
- **Location:** `index.css` lines 89–94 (`.board-svg`)
- **Description:** `max-width: 480px` with `width: 100%`. On a 320px screen, the board renders at 320px wide — cells are ~40px, making pieces ~15px radius. Touch targets become too small for accurate tapping (WCAG minimum: 44×44px).
- **Fix:** Add `min-width: 280px` (or similar) with horizontal scroll on very small screens, or use a different layout breakpoint.

### BUG-F011: Click events used instead of touch events — 300ms delay on mobile
- **Severity:** MEDIUM
- **Location:** `Board.jsx` lines 275–279, 329
- **Description:** All piece/board interaction uses `onClick`. On mobile browsers without `touch-action: manipulation`, this introduces a ~300ms delay between tap and action.
- **Fix:** The CSS has no `touch-action: manipulation` on the board container or body. Add `touch-action: manipulation` to `.board-container` or globally to eliminate the delay.

### BUG-F012: Params tab content overflow on mobile
- **Severity:** LOW
- **Location:** `index.css` line 242 (`.params-tab-content { max-height: 420px; overflow-y: auto }`)
- **Description:** On mobile (480px), the sidebar takes full width but `max-height: 420px` may cut off content when the keyboard is open or on short viewports. Combined with `.side-tab` having no explicit height management, users may scroll inside a scrollable panel within a scrollable page (nested scroll trap).
- **Fix:** Use `max-height: calc(100vh - 300px)` or similar dynamic calculation.

---

## 4. WebSocket Reconnection Logic

### BUG-F013: No user-facing reconnection progress indicator
- **Severity:** MEDIUM
- **Location:** `App.jsx` lines 93–103 (WebSocket setup)
- **Description:** `reconnectAttempts` state is updated on `reconnect_attempt` but never displayed in the UI. The header shows "🔴 Offline — reconnecting..." but doesn't indicate attempt count, delay, or give the user a "try now" option. Socket.io's default backoff (1s–10s) means up to 10s between attempts with no feedback.
- **Fix:** Display reconnect attempt count or a spinner, e.g., `🔴 Offline — retrying (${reconnectAttempts})...`

### BUG-F014: No timeout on socket connection
- **Severity:** LOW
- **Location:** `App.jsx` lines 63–68
- **Description:** The socket has `reconnection: true` but no `timeout` option. If the server accepts the TCP connection but never sends a handshake response, the client hangs indefinitely.
- **Fix:** Add `timeout: 5000` to the socket options.

### BUG-F015: Self-play state leaks on mode switch
- **Severity:** MEDIUM
- **Location:** `App.jsx` lines 86–89, 139–141
- **Description:** When switching from aivai to pvai mode, `handleStartPvai` sets `selfPlayActive(false)`, but the server may still emit `selfPlayStatus` events. The `selfPlayStatus` handler (line 165) doesn't filter by mode, so it overwrites stats/loss data even in pvai mode. Similarly, `loss` events (line 174) keep arriving and growing the array.
- **Fix:** Add mode check in `selfPlayStatus` and `loss` handlers, same as done for `state` (line 85) and `gameOver` (line 139).

---

## 5. Canvas Rendering

### BUG-F016: Dashboard canvas DPR scaling is correct ✅
- **Location:** `Dashboard.jsx` lines 14–19
- **Status:** PASS. `canvas.width = w * dpr`, `canvas.height = h * dpr`, `canvas.style.width = w`, `ctx.scale(dpr, dpr)` — this correctly handles retina/HiDPI displays.

### BUG-F017: SVG board coordinate system is correct ✅
- **Location:** `Board.jsx` lines 398–400
- **Status:** PASS. `width={BOARD_SIZE}`, `height={BOARD_SIZE}`, `viewBox="0 0 BOARD_SIZE BOARD_SIZE"` — coordinate system is consistent, no DPI scaling needed for SVG.

### BUG-F018: Animation RAF may leak on rapid board updates
- **Severity:** LOW
- **Location:** `Board.jsx` lines 136–169
- **Description:** The animation effect has proper cleanup (`cancelAnimationFrame` in return function). BUT: if board updates arrive faster than `STEP_DURATION_MS` (200ms), the `animFlagRef.current` check (line 143) skips animation and updates `prevBoardRef` silently. This is correct behavior, not a leak.

---

## 6. Error States

### BUG-F019: No offline/disconnected game start prevention
- **Severity:** HIGH
- **Location:** `App.jsx` lines 230–259 (menu rendering)
- **Description:** When disconnected, the menu shows "🔴 Brak połączenia" but the "Gracz vs AI" and "AI vs AI" buttons remain fully clickable. Clicking them switches mode, resets board, and emits `startGame` to a disconnected socket. The user sees an empty board with no error feedback.
- **Fix:** Disable the game-start buttons when `!connected`, or show a toast "Brak połączenia z serwerem" and prevent mode switch.

### BUG-F020: Error toast uses `role="alert"` but may overlap content
- **Severity:** LOW
- **Location:** `App.jsx` line 333 (toast), `index.css` lines 261–275
- **Description:** The toast is `position: fixed; bottom: 20px` with `z-index: 9999`. On mobile, it can overlap the game controls. Also, `role="alert"` with `aria-live="assertive"` is appropriate for errors but aggressive — it interrupts screen reader users on every server error.
- **Fix:** Use `role="status"` with `aria-live="polite"` for non-critical messages, reserve `role="alert"` for critical errors only.

### BUG-F021: No loading/connecting state on initial page load
- **Severity:** MEDIUM
- **Location:** `App.jsx` lines 225–260
- **Description:** On first render, `connected` is `false` and mode is `menu`. The menu shows "🔴 Brak połączenia" which may flash briefly before the socket connects. There's no "Connecting..." state — it immediately shows "disconnected" even during the initial handshake.
- **Fix:** Add a `connecting` state that's `true` on mount, set to `false` on first `connect` or after a timeout. Show "⏳ Łączenie..." during this phase.

---

## 7. Input Validation

### BUG-F022: Model params sent to server without client-side validation
- **Severity:** MEDIUM
- **Location:** `App.jsx` line 208 (`handleApplyModelParams`)
- **Description:** `handleApplyModelParams` sends raw `modelParams` to the server via `socketRef.current?.emit('setParams', { ...modelParams })`. If a user manually sets `layers: -5` or `lr: 99999` via browser dev tools, no client-side validation prevents it. The server should validate too, but defense in depth is better.
- **Fix:** Add bounds checks before emitting: `layers` must be 1–5, `neurons` 32–512, `lr` 0.0001–0.1, etc.

### BUG-F023: Speed slider accepts any numeric value
- **Severity:** LOW
- **Location:** `App.jsx` line 31 (`handleSpeed`)
- **Description:** `handleSpeed(ms)` accepts any number and emits it via socket. The speed buttons only offer 0, 100, 350, but nothing prevents setting `speed: -1000` via dev tools.
- **Fix:** Clamp to `Math.max(0, Math.min(ms, 10000))`.

---

## 8. Missing Features / Dead Code

### BUG-F024: `MoveHistory.jsx` component never imported — dead code
- **Severity:** LOW
- **Location:** `client/src/components/MoveHistory.jsx` (entire file)
- **Description:** The `MoveHistory` component is fully implemented but never imported in `App.jsx`. The app builds its own inline move history UI (lines 308–320). This is dead code that increases bundle size and maintenance burden.
- **Fix:** Either import and use `MoveHistory` in `App.jsx`, or delete the file.

### BUG-F025: `GameTimer.jsx` component never imported — dead code
- **Severity:** LOW
- **Location:** `client/src/components/GameTimer.jsx` (entire file)
- **Description:** The `GameTimer` component is implemented but never used. The app has no visible game timer.
- **Fix:** Either integrate `GameTimer` into the game controls, or delete the file.

### BUG-F026: No `<title>` updates for game state
- **Severity:** LOW
- **Location:** `index.html` line 5, `App.jsx`
- **Description:** The page title is static "Checkers AI". When it's the player's turn or the game ends, updating the title (e.g., "♟ Your turn — Checkers AI") would help users with multiple tabs.
- **Fix:** Add a `useEffect` in `App.jsx` that updates `document.title` based on `turn`, `gameOver`, `mode`.

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH     | 2     | F001, F019 |
| MEDIUM   | 9     | F002, F003, F004, F007, F010, F011, F013, F015, F021 |
| LOW      | 12    | F005, F006, F008, F009, F012, F014, F017, F018, F020, F022, F024, F025 |
| PASS     | 3     | F016, F017, F018 |

**Total issues: 23** (including 2 PASS items)

**Top priorities:**
1. **F001** — Grid keyboard navigation (WCAG critical)
2. **F019** — Offline game start causes dead UI (user can't play, gets no error)
3. **F015** — Self-play state leaks into player modes
4. **F021** — No loading/connecting state (bad first impression)
