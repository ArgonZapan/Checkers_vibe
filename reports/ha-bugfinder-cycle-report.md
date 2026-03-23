## Bug Finder Report — Hunter Alpha Cycle

**Data:** 2026-03-23 16:54 UTC  
**Zakres:** server/index.js, server/proxy.js, server/boardConvert.js, server/ai/trainer.js, server/ai/model.js, engine/src/*.cpp, client/src/**/*.jsx, config.js  
**Status poprzednich fixów:** boardFromCpp/boardToCpp walidacja ✅, CSP font-src ✅, rate limiting ✅, dirty flag auto-save ✅, paramsVersion guard ✅

---

### BUG-001: C++ `boardToArray` nie wykrywa nachodzących bitboardów — nielegalny stan planszy transmitowany bez ostrzeżenia
- **Severity:** krytyczny
- **Lokalizacja:** engine/src/server.cpp, funkcja `boardToArray` (linie ~24-40)
- **Opis:** Funkcja iteruje po 4 bitboardach (`whitePieces`, `whiteKings`, `blackPieces`, `blackKings`) i nadpisuje `grid[][]` sekwencyjnie. Jeśli bity się nakładają (np. bug w movegen powoduje, że to samo pole ma białego pionka i czarną damkę), ostatni przypisany kolor „wygrywa". Nielegalny stan planszy jest transmitowany do klienta i modelu AI bez ostrzeżenia. Model AI trenuje na nielegalnych stanach, co może zepsuć wagi.
- **Sugerowana naprawa:** Przed generowaniem JSON sprawdzać overlap: `if ((whitePieces & blackPieces) || (whiteKings & blackKings) || ...)` i logować błąd. Można też dodać asercję w debug build.

### BUG-002: Nieużywana zmienna `result` w `_playGame` — potencjalny confusion w przyszłych zmianach
- **Severity:** kosmetyczny
- **Lokalizacja:** server/ai/trainer.js, metoda `_playGame`, linia ~296 (`let result = 0;`)
- **Opis:** W bloku `if (moveCount >= MAX_MOVES)` i w sekcji obsługi braku legalnych moves, zmienna `result` jest deklarowana (`let result = 0`) ale nigdy nieczytana. Przyszły deweloper może mylnie sądzić, że `result` jest używane do czegoś — to dead code.
- **Sugerowana naprawa:** Usunąć `let result = 0;` z obu miejsc (lub wykorzystać do logowania).

### BUG-003: `lossHistory` w App.jsx nieograniczone — potencjalny memory leak przy długich sesjach
- **Severity:** ważny
- **Lokalizacja:** client/src/App.jsx, handler `s.on('loss', ...)` ~linia 140
- **Opis:** Loss history jest ograniczone do 1000 elementów (`if (prev.length >= 1000) return [...prev.slice(1), data.loss]`). To OK. Ale `gameHistory` w handlerze `gameOver` jest ograniczone do 10. Natomiast `moveHistory` jest ograniczone do 40. Problem: brak jest limitu na `roundTimes` w trainer.js — `this.roundTimes` jest ograniczone do 10, ale `selfPlayStatus` emituje `[...this.roundTimes]` co grę. To nie jest leak, ale niepotrzebne kopiowanie. Prawdziwy problem: `moveHistory` tworzy nową tablicę przy KAŻDYM ruchu (set state callback), co przy szybkim self-play (1000+ ruchów/min) generuje duży GC pressure.
- **Sugerowana naprawa:** W trybie self-play nie budować historii ruchów po stronie klienta (lub throttleować aktualizacje).

### BUG-004: Client PvAI — `handleCellClick` pozwala zaznaczać białe pionki niezależnie od tury
- **Severity:** ważny (ale uzasadniony — komentarz wyjaśnia)
- **Lokalizacja:** client/src/App.jsx, funkcja `handleCellClick` ~linia 195
- **Opis:** Kod komentuje: `// In PvAI, human controls white pieces — allow selecting white pieces regardless of current turn (to handle race conditions with AI)`. To jest celowe, ale tworzy problem: użytkownik może zaznaczyć biały pionek i wysłać ruch, gdy jest tura AI. C++ engine odrzuci ruch (400), ale klient już wyczyścił `selected` i `legalMoves`. Użytkownik widzi error toast i musi ponownie zaznaczyć pionek. To UX regression — poprzednie fixy race condition stworzyły ten side effect.
- **Sugerowana naprawa:** Zamiast pozwalać na selekcję niezależnie od tury, dodać optimistic queuing po stronie klienta — zapisz ruch, poczekaj na ture, wtedy wyślij. Lub: nie czyścić selection na error.

### BUG-005: Self-play `_playGame` — równoległe pobieranie state i legal-moves może zwrócić niespójne dane
- **Severity:** ważny
- **Lokalizacja:** server/ai/trainer.js, metoda `_playGame` ~linia 325
- **Opis:** `const [stateRes, lmResInit] = await Promise.all([cppFetch('/api/game/state'), cppFetch('/api/legal-moves')])` — oba requesty są wysyłane równolegle. C++ engine ma mutex, więc każde zapytanie jest atomic, ale kolejność nie jest gwarantowana. Jeśli między odczytem state a legal-moves inny wątek (np. handler HTTP /api/move) zmieni stan planszy, `stateData.board` i `legalMoves` będą z różnych stanów gry. Model AI może wykonać ruch legalny dla starego stanu ale nielegalny dla nowego → 400 → retry → niespójny sample w buforze.
- **Sugerowana naprawa:** Pobrać state, potem legal-moves sekwencyjnie (minimalny overhead, gwarantowana spójność). Lub dodać endpoint atomowy `/api/game/fullstate` który zwraca board + legal-moves pod jednym lockiem.

### BUG-006: Brak `base-uri` w CSP — możliwa injection przez `<base>` tag
- **Severity:** ważny
- **Lokalizacja:** server/index.js, middleware security headers ~linia 28
- **Opis:** CSP nie zawiera dyrektywy `base-uri`. Atakujący z możliwością wstrzyknięcia HTML (np. przez XSS w innej części aplikacji) może dodać `<base href="https://evil.com/">`, co przekieruje wszystkie względne URL-e (skrypty, style, obrazy) na złośliwy serwer. `default-src 'self'` nie chroni przed tym — `base-uri` jest osobną dyrektywą.
- **Sugerowana naprawa:** Dodać `base-uri 'self'` do CSP string.

### BUG-007: Proxy `proxyReq` handler — brak guard na `req.body` being a Buffer
- **Severity:** ważny
- **Lokalizacja:** server/proxy.js, handler `proxyReq` ~linia 30
- **Opis:** `express.json()` parsuje JSON body do obiektu. Proxy re-serializuje go: `JSON.stringify(req.body)`. Ale jeśli request przyjdzie z Content-Type `application/json` ale z ciałem już jako Buffer (np. z innego middleware, lub jeśli `express.json()` z jakiegoś powodu nie przetworzył body), `req.body` będzie Buffer. `JSON.stringify(buffer)` zwraca `{"type":"Buffer","data":[...]}` — C++ engine dostanie nieprawidłowe JSON i zwróci 400.
- **Sugerowana naprawa:** Dodać guard: `if (Buffer.isBuffer(req.body)) return;` — nie re-serializować, pozwolić proxy przesłać oryginalny body.

### BUG-008: `setSpeedMode` nie odrzuca pustego stringa — cichy noop
- **Severity:** kosmetyczny
- **Lokalizacja:** server/index.js, handler `setSpeedMode` ~linia 420
- **Opis:** Handler sprawdza `typeof mode !== 'string'`, ale nie sprawdza czy `mode === ''`. Pusty string nie pasuje do `'fast'` ani `'normal'`, więc `if (mode === 'fast' || mode === 'normal')` jest false — nic się nie dzieje. Cichy noop zamiast jawnej informacji o błędzie.
- **Sugerowana naprawa:** Dodać walidację: `if (mode === '' || !['fast', 'normal'].includes(mode)) { socket.emit('error', ...); return; }`

### BUG-009: `_playGame` — brak walidacji `path` z C++ przed wysłaniem do klienta
- **Severity:** ważny
- **Lokalizacja:** server/ai/trainer.js, metoda `_playGame` — self-play state emit; server/index.js, handleMove
- **Opis:** C++ engine zwraca `path` (ścieżkę ruchu) w odpowiedzi `/api/move`. Zarówno self-play jak i handleMove przesyłają `path` bezpośrednio do klienta bez walidacji. Jeśli C++ zwróci path z współrzędnymi poza zakresem 0-7, animacja SVG spróbuje rysować poza planszą (bez crasha, ale z artefaktami wizualnymi). Co gorsza, złośliwy klient mógłby wysłać crafted path do innego klienta przez PvP broadcast.
- **Sugerowana naprawa:** Zwalidować każdy punkt path przed wysłaniem: `Array.isArray(p) && p.length === 2 && p[0]>=0 && p[0]<=7 && p[1]>=0 && p[1]<=7`.

### BUG-010: `boardToCpp` nie sprawdza `flat.length < 64` — niekompletna plansza generuje ciche błędy
- **Severity:** ważny
- **Lokalizacja:** server/boardConvert.js, funkcja `boardToCpp` ~linia 68
- **Opis:** `boardToCpp` sprawdza `flat.length > 64` (obrona przed DoS), ale nie sprawdza `flat.length < 64`. Jeśli plansza jest niekompletna (np. 7 wierszy zamiast 8, lub puste rzędy są pomijane przez `flat()` na ragged array), zwróci tablicę krótszą niż 64. `buildInputArray` w model.js zakłada dokładnie 64 elementy — crash nastąpi dopiero w trakcie predykcji, trudny do debugowania.
- **Sugerowana naprawa:** Dodać `if (flat.length < 64) { console.warn('[boardToCpp] Board too short:', flat.length); return new Array(64).fill(0); }`

---

## Podsumowanie

| Kategoria | Nowe | Poprzednio znalezione (nierozwiązane) |
|-----------|------|---------------------------------------|
| Krytyczny | 1    | 3 (BUG-001/002/003 z hunter-alpha: reward shaping, gamma, ignored params) |
| Ważny     | 6    | 3 (BUG-004/005/006 z hunter-alpha: auth WS, race HTTP/WS, moveQueue chain) |
| Kosmetyczny | 2  | 0 |
| **Razem** | **9** | **6** |

### Status poprzednich fixów — regression check

| Fix | Status | Uwagi |
|-----|--------|-------|
| boardFromCpp walidacja (BUG-001 v1) | ✅ OK | Poprawnie obsługuje null/undefined/empty |
| boardToCpp walidacja (BUG-002 v1) | ✅ OK | Sprawdza >64 elements, null pieces |
| CSP font-src (BUG-006-01) | ✅ OK | `font-src 'self'` obecny |
| Rate limiting cleanup (BUG-014) | ✅ OK | Periodic cleanup + hard cap 10k |
| Dirty flag auto-save (BUG-003 cycle) | ✅ OK | Snapshot before async, correct |
| paramsVersion guard (BUG-0133) | ✅ OK | Chroni _playGame przed mid-game param changes |
| Test range alignment (BUG-006-02) | ✅ OK | layers 1-5, neurons 32-512 |

### Najważniejsze nowe znalezisko

**BUG-005 (race condition state vs legal-moves w self-play):** `Promise.all` na dwóch requestach do C++ engine bez gwarancji spójności. Przy dużym obciążeniu (szybki self-play + HTTP predict endpoint) może generować niespójne sample w replay bufferze, co zniekształca trening modelu. Fix jest trywialny (sekwencyjne zamiast równoległe) z minimalnym kosztem wydajnościowym.

---

*Skany przeprowadzone przez dynamic-bug-finder (Jarvis Horner). Raport zawiera tylko dokumentację — bez propozycji napraw kodu.*
