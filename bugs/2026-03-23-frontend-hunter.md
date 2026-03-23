# Frontend Bug Report — 2026-03-23 (hunter-sub-frontend)

## Scan Summary
Scanned: `client/index.html`, `client/src/` (App.jsx, Board.jsx, GameControls.jsx, Dashboard.jsx, ParamsPanel.jsx, ErrorBoundary.jsx, GameTimer.jsx, MoveHistory.jsx), `client/dist/index.html`, CSS.

## Findings

### BUG-F001: Game-over overlay lacks keyboard focus trap
- **Severity:** Important (Accessibility)
- **Location:** `src/components/Board.jsx` — game-over overlay
- **Problem:** When game-over overlay appears, keyboard users can Tab behind it into hidden board cells. The overlay has `role="dialog"` and `aria-modal="true"` but no focus trap implementation.
- **Fix:** Add focus trap `onKeyDown` handler to overlay that cycles Tab between overlay's focusable elements.

### BUG-F002: No connection status indicator during gameplay
- **Severity:** Moderate (UX)
- **Location:** `src/App.jsx` — game view
- **Problem:** The menu view shows "🟢 Połączono z serwerem" / "🔴 Brak połączenia", but the game view has zero feedback when WebSocket disconnects. Player can lose connection and not know why moves aren't registering.
- **Fix:** Add connection status indicator in the game header.

### BUG-F003: `useEffect` for ref sync missing dependency array
- **Severity:** Minor (React best practice)
- **Location:** `src/App.jsx` line ~97
- **Problem:** `useEffect(() => { boardRef.current = board; ... })` has no dependency array — runs on every render. Should be `useLayoutEffect` or have explicit deps. Functionally works but is technically incorrect.
- **Fix:** Change to `useEffect` with explicit dependency array `[board, turn, selected, legalMoves, mode, gameOver]`.

### BUG-F004: `areEqual` in Board.jsx has redundant check
- **Severity:** Minor (code quality)
- **Location:** `src/components/Board.jsx` — `areEqual` function
- **Problem:** Checks both `prevProps.legalMoves !== nextProps.legalMoves` AND `prevProps.legalMoves?.length !== nextProps.legalMoves?.length`. The length check is redundant when reference equality already failed.
- **Fix:** Remove redundant length check.

### BUG-F005: MoveHistory.jsx is dead code
- **Severity:** Minor (dead code)
- **Location:** `src/components/MoveHistory.jsx`
- **Problem:** Component is never imported. App.jsx builds inline move history instead. This is orphaned code that could cause confusion.
- **Fix:** Not actionable (removing would change file structure). Documented for awareness.

### BUG-F006: Loss chart canvas doesn't handle high-DPI displays
- **Severity:** Minor (visual quality)
- **Location:** `src/components/Dashboard.jsx` — `drawLossChart`
- **Problem:** Canvas is set to container width but not scaled for devicePixelRatio. On Retina displays, the chart will appear blurry.
- **Fix:** Scale canvas by `window.devicePixelRatio` and adjust context scale.

## dist/index.html Sync Check
✅ **In sync.** `client/dist/index.html` correctly has the Vite-built `<script>` and `<link>` tags replacing the dev `<script type="module" src="/src/main.jsx">`. All metadata, noscript block, and structure match.
