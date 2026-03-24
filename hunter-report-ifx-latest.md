# Hunter Report — Issue Fixer (hunter-sub-ifx)
**Date:** 2026-03-24
**Repo:** /opt/Checkers_vibe
**Commit:** `0f99dc7`

---

## BUG 1: WebSocket WS endpoints brak auth (SEC #157)

**Problem:** HTTP endpoints (`/api/ai/reset`, `/api/ai/restart`, `/api/selfplay/*`) miały `requireApiToken` middleware, ale WS handlers nie weryfikowały tokena. Każdy klient mógł emitować `reset`, `restart`, `setParams`, `startSelfPlay`, `stopSelfPlay`, `setSpeed`, `setSpeedMode` bez autoryzacji.

**Fix:** Dodano `wsAuth(socket)` helper przy `requireApiToken` (~line 120). Helper sprawdza `socket.handshake.auth?.token` i `socket.handshake.headers?.authorization`. Jeśli `API_TOKEN` nie jest ustawiony → dev mode, brak auth (backward compatible).

Dodano `if (!wsAuth(socket))` check do 7 handlerów:
- `startSelfPlay` (~line 640)
- `stopSelfPlay` (~line 654)
- `setParams` (~line 665)
- `setSpeed` (~line 822)
- `setSpeedMode` (~line 846)
- `reset` (~line 872)
- `restart` (~line 902)

**Impact:** Ochrona przed nieautoryzowanymi operacjami na modelu AI i grze. Bez zmian w dev mode (gdy brak `API_TOKEN`).

---

## BUG 2: WebSocket startSelfPlay optimistic toggle desync (client/src/App.jsx)

**Problem:** `handleToggleSelfplay` optymistycznie ustawiał `selfPlayActiveRef.current = true` i `setSelfPlayActive(true)` PRZED potwierdzeniem serwera. Jeśli serwer rzucił błąd (engine down, model niezainicjalizowany), klient dostawał event `error` z toastem, ale NIE revertował stanu toggle. Klient permanentnie pokazywał "Self-Play: Active" mimo że serwer był inactive.

**Fix:** W handlerze `s.on('error', ...)` (~line 259) dodano check:
```js
const msg = (data?.message || '').toLowerCase();
if (msg.includes('self-play') || msg.includes('selfplay')) {
  selfPlayActiveRef.current = false;
  setSelfPlayActive(false);
}
```
Kiedy serwer odrzuca start self-play, klient automatycznie revertuje toggle do `false`.

**Impact:** UI zawsze odzwierciedla rzeczywisty stan self-play serwera. Brak zmian w innych flow.

---

## Test Results

**Pre-fix:** 3413 tests, 3408 passed, 5 failed (pre-existing)
**Post-fix:** 3413 tests, 3408 passed, 5 failed (same pre-existing — no regression)

Pre-existing failures (niezwiązane z fixami):
- king multi-capture: blocked by own piece
- pawn multi-capture: white pawn double jump
- applyMove: multi-capture removes all captured pieces
- rate limit: request exactly at MAX
- rate limit: entry at window boundary

---

## Files Changed

| File | Changes |
|------|---------|
| `server/index.js` | +14 — wsAuth helper + 7 auth checks |
| `client/src/App.jsx` | +6 — self-play toggle revert in error handler |
