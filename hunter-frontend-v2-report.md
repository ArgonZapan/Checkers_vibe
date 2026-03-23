# Frontend Audit Report v2 — Checkers_vibe
**Date:** 2026-03-23 | **Hunter:** hunter-sub-003 (frontend-updater)

## Summary
- **Critical:** 0
- **Important:** 2
- **Cosmetic:** 4
- **Total issues:** 6

---

### FE-BUG-001: MoveHistory komponent istnieje ale nie jest używany
- **Severity:** kosmetyczny
- **Lokalizacja:** `client/src/App.jsx` linie ~246-258 vs `client/src/components/MoveHistory.jsx`
- **Kroki reprodukcji:** Otwórz App.jsx, zobacz inline render historii ruchów. Sprawdź czy MoveHistory.jsx jest importowany — nie jest.
- **Opis:** App.jsx ręcznie renderuje historię ruchów zamiast używać istniejącego komponentu MoveHistory. MoveHistory.jsx jest kompletny (z `posLabel`, emoji, `move-last` highlight) ale nieużywany.
- **Sugerowana naprawa:** Użyj `<MoveHistory moves={moveHistory} />` zamiast inline JSX. Dostosuj MoveHistory do formatu danych z App.jsx lub odwrotnie.

### FE-BUG-002: GameTimer komponent — nigdzie nie importowany ani nie renderowany
- **Severity:** kosmetyczny
- **Lokalizacja:** `client/src/components/GameTimer.jsx`
- **Kroki reprodukcji:** Szukaj `GameTimer` w App.jsx, GameControls.jsx — brak importu.
- **Opis:** Komponent GameTimer z pełną logiką (interwał, cleanup, format MM:SS) istnieje ale nigdzie nie jest używany.
- **Sugerowana naprawa:** Zintegruj z GameControls lub usuń plik.

### FE-BUG-003: Dashboard — canvas rysuje się w dwóch useEffect (duplikacja)
- **Severity:** kosmetyczny
- **Lokalizacja:** `client/src/components/Dashboard.jsx` — dwa useEffect rysujące identyczny wykres
- **Kroki reprodukcji:** Otwórz Dashboard.jsx, porównaj pierwszy useEffect (linie ~14-55) z drugim (linie ~63-103). Identyczny kod rysowania.
- **Opis:** Pierwszy useEffect rysuje na mount + resize (używając lossRef). Drugi useEffect rysuje przy każdej zmianie lossHistory. Kod jest zduplikowany — powinien być wspólna funkcja `drawChart()`.
- **Sugerowana naprawa:** Wyciągnij logikę rysowania do `drawChart(ctx, data, w, h)`, wywołuj z obu effectów.

### FE-BUG-004: Brak cleanup selekcji po odrzuceniu ruchu przez serwer
- **Severity:** ważny
- **Lokalizacja:** `client/src/App.jsx` — handler `s.on('error', ...)` linie ~183-188
- **Kroki reprodukcji:**
  1. Gracz vs AI — zaznacz pionek (emisja getLegalMoves)
  2. Serwer odrzuci ruch (np. ruch nielegalny, timeout engine)
  3. Serwer emituje `error` → toast pojawia się
  4. Ale: `selected` i `legalMoves` NIE są czyszczone
- **Opis:** Po odrzuceniu ruchu przez serwer, pionek pozostaje zaznaczony z zielonymi kropkami valid moves. Użytkownik może kliknąć na "legalny" target który serwer odrzuci. To dezorientuje — UX sugeruje że ruch jest dozwolony mimo komunikatu błędu.
- **Sugerowana naprawa:** W `s.on('error')` dodaj `setSelected(null)` i `setLegalMoves([])`.

### FE-BUG-005: lastRoundTime nie jest resetowany przy nowej sesji self-play
- **Severity:** ważny
- **Lokalizacja:** `client/src/App.jsx` — `handleStartAivai` i handler `selfPlayStatus`
- **Kroki reprodukcji:**
  1. Uruchom AI vs AI, poczekaj na kilka rund
  2. lastRoundTime pokazuje np. 2.3s
  3. Kliknij Reset → Menu → AI vs AI ponownie
  4. Dashboard pokazuje stary lastRoundTime (2.3s) dopóki nie spłynie nowy event
- **Opis:** `lastRoundTime` nie jest resetowany w `handleStartAivai()` ani `handleReset()`. Stare dane mogą mylić użytkownika na początku nowej sesji.
- **Sugerowana naprawa:** Dodaj `setLastRoundTime(0)` do `handleStartAivai()`, `handleStartPvai()` i `handleReset()`.

### FE-BUG-006: ~~Brak aria-label na przyciskach restart i self-play w ParamsPanel~~ ✅ NAPRAWIONY
- **Severity:** kosmetyczny
- **Status:** Już naprawiony — aria-label obecne na wszystkich przyciskach restart i self-play toggle.

---

## Issue #136 — generateKingMoves path/numPath — Impact on Frontend
**Status:** ✅ Już naprawiony (commit `bb86f51`)

King moves (non-capture) teraz zawierają `path[0]` (from) i `path[1]` (to) z `numPath = 2`. Frontend Board.jsx otrzymuje poprawne dane path i animuje ruchy damki poprawnie. Multi-capture path jest też przekazywany z C++ engine przez `server.cpp` (linie 221-223). Frontend obsługuje oba przypadki:
- `path.length > 2` → animacja wielokrotnego bicia (step by step)
- `path.length <= 2` → normalna animacja (prevBoardRef diff)

**Brak dalszych problemów frontendowych z #136.**
