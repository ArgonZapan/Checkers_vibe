# Frontend Audit — Checkers_vibe/client
**Date:** 2026-03-23
**Auditor:** Jarvis Horner (subagent frontend-audit)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Krytyczny | 3 |
| 🟡 Ważny | 9 |
| 🟢 Kosmetyczny | 4 |

**Build:** ✅ `vite build` passes (66 modules, 215KB JS)
**Smoke tests:** ✅ 5/5 passed
**PvAI tests:** ✅ 5/5 passed

---

## Bugi

### [App.jsx] MoveHistory komponent istnieje ale nie jest używany
- **Severity:** 🟡 Ważny
- **Location:** `client/src/App.jsx` — import list (line 6+), inline move-history (line ~200)
- **Steps to reproduce:** Zobacz importy App.jsx — brak `import MoveHistory`. Sprawdź inline HTML `<div className="move-history">` — duplikuje logikę MoveHistory.jsx.
- **Expected:** Import i użycie `MoveHistory` komponentu
- **Actual:** MoveHistory.jsx jest orphaned — nieimportowany, inline HTML robi to samo ale z innym formatem danych (App buduje `{turn, from, to, capture}`, MoveHistory oczekuje `{color, from[0], from[1], to[0], to[1], captured, becameKing}`)

### [App.jsx] GameTimer nigdy nie jest renderowany
- **Severity:** 🟢 Kosmetyczny
- **Location:** `client/src/components/GameTimer.jsx` — plik istnieje
- **Steps to reproduce:** `grep -rn "GameTimer" client/src/App.jsx` — brak wyniku
- **Expected:** GameTimer wyświetlany podczas gry
- **Actual:** Dead code — komponent zaimportowany nigdzie

### [App.jsx] gameHistory (sidebar) nie resetuje się na nową grę
- **Severity:** 🟡 Ważny
- **Location:** `client/src/App.jsx` — `handleStartPvai`, `handleStartAivai`
- **Steps to reproduce:** Uruchom AI vs AI → zagraj kilka gier → zresetuj → uruchom PvAI → pojawiają się stare wyniki gier w sidebar
- **Expected:** `setGameHistory([])` wywoływane w handleStartPvai/handleStartAivai
- **Actual:** `gameHistory` jest kumulatywne — nigdy nie czyszczone przy starcie nowej gry

### [App.jsx] WebSocket reconnect ponownie emituje startGame
- **Severity:** 🟡 Ważny
- **Location:** `client/src/App.jsx` — `s.on('reconnect', ...)`
- **Steps to reproduce:** Graj PvAI → strata połączenia na chwilę → reconnect → serwer dostaje nowy `startGame` → gra resetuje się
- **Expected:** Reconnect jedynie odświeża stan, nie restartuje gry
- **Actual:** `s.emit('startGame', { mode: modeRef.current })` na reconnect — niebezpieczne

### [App.jsx] Speed nie jest zapisywany w localStorage
- **Severity:** 🟢 Kosmetyczny
- **Location:** `client/src/App.jsx` — `speed` state
- **Steps to reproduce:** Ustaw speed na "Wolno" → odśwież stronę → speed wraca do 0
- **Expected:** Speed zapamiętywany między sesjami
- **Actual:** `speed` jest tylko w useState, bez persistence

### [Board.jsx] Game-over overlay nie filtruje selfPlay source
- **Severity:** 🔴 Krytyczny
- **Location:** `client/src/components/Board.jsx` — overlay render (~line 295)
- **Steps to reproduce:** Uruchom PvAI + włącz self-play w tle → self-play game kończy się → gameOver stan ustawiony → overlay pojawia się na planszy gracza
- **Expected:** Overlay pojawia się TYLKO gdy gra gracza się kończy (filtr `source !== 'selfPlay'`)
- **Actual:** `gameOver` i `winner` stan są współdzielone — gameOver event z self-play w App.jsx jest filtrowany, ale state event nie jest (App.jsx filtruje `data.source === 'selfPlay'` na state, ale gameOver handler filtruje — jednak Board renderuje na podstawie gameOver prop bez filtra source)

### [Board.jsx] Brak obsługi klawiszy strzałek (arrow keys)
- **Severity:** 🟡 Ważny
- **Location:** `client/src/components/Board.jsx` — `onKeyDown` handlers (~line 230)
- **Steps to reproduce:** Użyj Tab aby fokusować planszę → naciśnij strzałki → brak reakcji
- **Expected:** Strzałki poruszają fokus między polami planszy (nawigacja klawiaturą)
- **Actual:** Tylko Enter/Space obsługiwane. Brak arrow key navigation.

### [ParamsPanel.jsx] Tab switching — białe/czarne współdzielą te same modelParams
- **Severity:** 🔴 Krytyczny
- **Location:** `client/src/components/ParamsPanel.jsx` — SideTab props (~line 115-135)
- **Steps to reproduce:** Tab Białe → zmień LR na 0.01 → przełącz na Czarne → LR też jest 0.01 → zmień Czarne LR na 0.0001 → wróć na Białe → LR jest 0.0001
- **Expected:** Każda strona ma osobne modelParams (layers, neurons, lr, batchSize)
- **Actual:** `modelParams={mp}` jest ten sam obiekt dla obu tabów — zmiana na jednej stronie zmienia drugą. Network size jest osobny (`whiteNetworkSize`/`blackNetworkSize`) ale reszta parametrów jest współdzielona.

### [ParamsPanel.jsx] Batch size slider — indexOf zwraca -1 dla nieznanych wartości
- **Severity:** 🟡 Ważny
- **Location:** `client/src/components/ParamsPanel.jsx` — batch size slider (~line 170)
- **Steps to reproduce:** Serwer wyśle `batchSize: 100` (nie ma w `BATCH_SIZES = [8, 16, 32, 64, 128, 256]`) → `BATCH_SIZES.indexOf(100)` = -1 → slider nie pokazuje poprawnej wartości
- **Expected:** Fallback do najbliższej wartości lub clamp do zakresu
- **Actual:** `-1` jako value powoduje niewidoczny slider

### [ParamsPanel.jsx] LR slider — NaN przy lr=0
- **Severity:** 🟡 Ważny
- **Location:** `client/src/components/ParamsPanel.jsx` — LR slider (~line 165)
- **Steps to reproduce:** Ustaw lr na 0 → `lrToSlider(0)` → `Math.log10(0)` = `-Infinity` → `(-Infinity - LR_MIN_LOG) / ...` = `-Infinity` → slider value = `-Infinity`
- **Expected:** Clamp lr do minimum (0.0001) lub walidacja
- **Actual:** Slider value jest NaN/-Infinity, UI się psuje

### [ParamsPanel.jsx] Arrow key navigation w tab list — brak tabu "general" na końcu
- **Severity:** 🟢 Kosmetyczny
- **Location:** `client/src/components/ParamsPanel.jsx` — tab buttons
- **Steps to reproduce:** Tab Białe → ArrowRight → Czarne → ArrowRight → General. Ale z General: ArrowRight → Białe (ok), ArrowLeft → Czarne. Natomiast z Białe: ArrowLeft → brak akcji (powinno iść do General)
- **Expected:** Cykliczna nawigacja: Białe ↔ Czarne ↔ General ↔ Białe
- **Actual:** Białe: ArrowLeft nic nie robi. Brak cykliczności.

### [GameControls.jsx] Brak obsługi trybu PvP
- **Severity:** 🟡 Ważny
- **Location:** `client/src/components/GameControls.jsx` i `client/src/App.jsx`
- **Steps to reproduce:** Sprawdź kod — nie ma `handleStartPvp` ani przycisku PvP. Mode `pvp` jest referencjonowany w filtrach (`modeRef.current === 'pvp'`) ale nie ma możliwości go uruchomić.
- **Expected:** Przycisk "Gracz vs Gracz" w menu lub usunięcie dead code filtrów pvp
- **Actual:** Martwe filtry `modeRef.current === 'pvp'` w App.jsx (state handler, gameOver handler)

### [CSS] Brak responsywności dla ekranów < 768px
- **Severity:** 🟡 Ważny
- **Location:** `client/src/index.css` — tylko jeden @media query (max-width: 768px)
- **Steps to reproduce:** Otwórz na ekranie 320px → plansza 480px wychodzi poza ekran → brak scroll-x
- **Expected:** @media queries dla 320px, 480px, etc. Plansza powinna skalować się proporcjonalnie
- **Actual:** Tylko `flex-direction: column` na 768px. Brak @media dla 320px. Plansza SVG ma `max-width: 480px` ale na 320px to jest za szerokie.

### [CSS] Toast notification — fixed positioning nie działa dobrze na mobilnych
- **Severity:** 🟢 Kosmetyczny
- **Location:** `client/src/index.css` — `.toast-notification` (~line 375)
- **Steps to reproduce:** Wyświetl toast na mobilnym ekranie → toast przykrywa przyciski
- **Expected:** Toast przesunięty lub z timeoutem
- **Actual:** `position: fixed; bottom: 20px; z-index: 9999` — przykrywa dolne elementy na małych ekranach

### [CSS] Scrollbar styles — brak Firefox support
- **Severity:** 🟢 Kosmetyczny
- **Location:** `client/src/index.css` — scrollbar styles (~line 435)
- **Steps to reproduce:** Otwórz w Firefox → scrollbar nie jest stylizowany
- **Expected:** `scrollbar-width: thin; scrollbar-color: ...` dla Firefox
- **Actual:** Tylko `::-webkit-scrollbar` (Chrome/Safari only)

### [Board.jsx] captures prop nie jest używany w logice renderowania
- **Severity:** 🟡 Ważny
- **Location:** `client/src/components/Board.jsx` — props destructure (~line 35)
- **Steps to reproduce:** Sprawdź kod — `captures` jest destrukturyzowany z props ale nigdy używany w useMemo ani w JSX
- **Expected:** Captured pieces powinny być wizualnie oznaczone lub prop usunięty
- **Actual:** `captures` jest pass-through, nie ma efektu wizualnego

---

## Poprawki wprowadzone

Brak — audyt dokumentacyjny. Wszystkie bugi wymagają decyzji Argona przed naprawą.

---

## Rekomendacje priorytetowe

1. **[krytyczny]** ParamsPanel: rozdzielić modelParams na `whiteModelParams` / `blackModelParams` — obecnie zmiana parametrów jednej strony wpływa na drugą
2. **[krytyczny]** Board overlay: dodać filtr `source` lub dedykowany stan `playerGameOver`
3. **[krytyczny]** LR/NaN: dodać clamp `Math.max(lr, 0.0001)` w `lrToSlider`
4. **[ważny]** Usunąć dead code: GameTimer, MoveHistory (lub zintegrować), filtry pvp
5. **[ważny]** WebSocket reconnect: nie re-emitować startGame, tylko subskrybować stan
6. **[ważny]** Responsywność: dodać @media queries dla < 768px

---

*Audit zakończony. Vite build ✅, Smoke tests ✅ 5/5, PvAI tests ✅ 5/5*
