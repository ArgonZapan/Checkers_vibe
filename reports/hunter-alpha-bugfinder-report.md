# 🔍 Hunter-Alpha Bug Finder — Raport Skanu Kodu

**Projekt:** /opt/Checkers_vibe  
**Data:** 2026-03-23  
**Zakres:** server/index.js, server/boardConvert.js, server/proxy.js, server/ai/*.js, client/src/**/*.jsx, engine/src/*.cpp

---

## Krytyczne (Critical)

### BUG-001: Parametry nagród (reward shaping) są ignorowane przez silnik treningowy
- **Severity:** critical
- **File:** server/ai/trainer.js, linie 149-163 (funkcja `calculateReward`)
- **Description:** UI (ParamsPanel) pozwala użytkownikowi zmieniać parametry `rewardCapture`, `rewardLosePiece`, `rewardPromotion`, `rewardWin`, `rewardLose`. Są one zapisywane w `trainer.modelParams` i przechodzą whitelistę w `setParams`. Jednak funkcja `calculateReward()` w trainer.js używa **hardcoded** wag: materiał 0.47, pozycja 0.29, zagrożenie 0.12, tempo 0.12. Żaden z konfigurowalnych parametrów nagród nie jest czytany z `modelParams`. Użytkownik zmienia slidery, widzi wartość się zmieniającą, ale trening AI zachowuje się identycznie.
- **Suggestion:** Zmienić `calculateReward` na funkcję klasy `SelfPlay` (lub przekazać parametry jako argument), która czyta wagi z `this.modelParams.rewardCapture` itd. zamiast hardcoded wartości.

### BUG-002: Parametr `gamma` (discount factor) jest ładowany raz przy imporcie modułu i nie reaguje na zmiany z UI
- **Severity:** critical
- **File:** server/ai/model.js, linia ~142; config.js, linia 55
- **Description:** `const GAMMA = CONFIG.ai.gamma` jest wykonywane raz przy załadowaniu modułu. Nawet jeśli UI zmieni `gamma` przez slider (zapisywane do `trainer.modelParams.gamma`), stała `GAMMA` w model.js pozostaje niezmieniona. Nowy model jest tworzony przez `createModel()`, ale `train()` wciąż używa starej wartości `GAMMA` z zakresu modułu.
- **Suggestion:** Przekazywać `gamma` jako parametr do funkcji `train()`, np. `train(model, batch, epochs, gamma)`, lub odczytywać ją z `CONFIG.ai.gamma` (i aktualizować CONFIG przy zmianie, jak to robisz dla `speedMode`).

### BUG-003: Parametry `minEpsilon`, `epsilonDecay`, `bufferSize`, `epochs` z UI nie wpływają na trening
- **Severity:** critical
- **File:** server/index.js (handler `setParams`); server/ai/trainer.js
- **Description:** Te 4 parametry przechodzą whitelistę i są zapisywane w `trainer.modelParams`, ale:
  - `minEpsilon` i `epsilonDecay`: kod decayu w `_playGame()` czyta z `CONFIG.ai.minEpsilon` i `CONFIG.ai.epsilonDecay`, nie z `trainer.modelParams`.
  - `bufferSize`: `ReplayBuffer` jest tworzony raz z `CONFIG.ai.bufferSize` w konstruktorze `SelfPlay`. Zmiana `modelParams.bufferSize` nie zmienia rozmiaru bufora.
  - `epochs`: `train()` w `_playGame()` wywoływane jest z hardcoded `1` (jedna epoka na rundę). Wartość z UI jest ignorowana.
- **Suggestion:** Dla każdego parametru: albo aktualizować `CONFIG.ai.*` przy zmianie (jak dla `speedMode`), albo czytać wartości z `this.modelParams.*` w miejscu użycia. Dla `bufferSize` — albo odtwarzać bufor, albo dynamicznie zmieniać `maxSize`.

---

## Ważne (Important)

### BUG-004: Brak autentykacji WebSocket — każdy klient może kontrolować grę i zmieniać parametry AI
- **Severity:** important
- **File:** server/index.js, linia ~201 (handler `io.on('connection', ...)`)
- **Description:** Każdy klient z dostępem do serwera WebSocket może:
  - Startować/stopować self-play (`startSelfPlay`, `stopSelfPlay`)
  - Zmieniać parametry modelu (`setParams`) — w tym tworzyć nowe modele i czyścić bufor
  - Resetować całą grę (`reset`)
  - Wykonywać ruchy w trybie PvP za innego gracza
  
  Nie ma żadnego mechanizmu uwierzytelniania (token, session, hasło).
- **Suggestion:** Dodać mechanizm auth — np. token w handshake (`socket.handshake.auth.token`), który jest weryfikowany przy połączeniu. Alternatywnie: rozdzielić uprawnienia na "admin" (zmiana parametrów) i "player" (tylko ruchy).

### BUG-005: Race condition w handlerach HTTP `/api/ai/predict` i `/api/ai/train` vs `setParams` (model recreation)
- **Severity:** important
- **File:** server/index.js, linie ~87-103 (predict), ~105-130 (train), ~530-560 (setParams WS)
- **Description:** Gdy klient HTTP wywołuje `/api/ai/predict` lub `/api/ai/train` (używając `trainer.modelWhite`/`trainer.modelBlack`), a jednocześnie inny klient wysyła `setParams` przez WebSocket, następuje nadpisanie referencji modelu. Stary model może zostać poddany garbage collection podczas gdy `predict()` wciąż na nim operuje, co może prowadzić do crasha TensorFlow.js (używanie disposed tensora). Guard `paramsVersion` chroni tylko `_playGame()`, nie chroni endpointów HTTP.
- **Suggestion:** Dodać mutex/lock dla operacji na modelu, lub użyć wersjonowania modelu jak w `_playGame` (snapshot wersji przed predict, sprawdzenie po). Alternatywnie: nie dispose'ować starego modelu natychmiast, tylko po zakończeniu aktywnych operacji.

### BUG-006: Socket `moveQueue` — łańcuch Promise może się trwale zepsuć
- **Severity:** important
- **File:** server/index.js, linia ~310
- **Description:** `socket._moveQueue` tworzy łańcuch promise'ów: `.then(() => handleMove(...)).catch(...)`. Jeśli `handleMove` zwróci rejected promise (np. z powodu timeoutu cppFetch), catch handler go obsługuje. Ale jeśli catch handler SAM rzuci błędem (np. `socket.emit` rzuci — mało prawdopodobne, ale możliwe przy disconnect), łańcuch jest nieodwracalnie zepsuty. Kolejne `.then()` na zepsutym promise będą zwracać rejected promise, a catch nigdy się nie wykona dla następnych ruchów. Skutek: gracz traci możliwość wykonywania ruchów bez reconnect.
- **Suggestion:** W catch handlerze zresetować `socket._moveQueue` do resolved promise: `socket._moveQueue = Promise.resolve()`. Lub użyć bardziej odpornej kolejki (np. array + dequeue loop).

### BUG-007: C++ engine `boardToArray` — brak walidacji integralności planszy
- **Severity:** important
- **File:** engine/src/server.cpp, funkcja `boardToArray` (linie ~24-40)
- **Description:** Funkcja iteruje po 4 bitboardach (`whitePieces`, `whiteKings`, `blackPieces`, `blackKings`) i nadpisuje `grid[][]`. Jeśli bity się nakładają (np. pole ma jednocześnie białego pionka i czarną damkę — co jest stanem nielegalnym wynikłym z bugu), ostatni przypisany kolor wygrywa, a nielegalny stan planszy jest przesyłany do klienta bez ostrzeżenia.
- **Suggestion:** Przed generowaniem JSON sprawdzać, czy `whitePieces | whiteKings | blackPieces | blackKings` ma dokładnie tyle bitów ile suma poszczególnych masek (brak overlapu). Jeśli nie, logować ostrzeżenie i/lub zwracać błąd.

### BUG-008: Brak walidacji wymiarów planszy w `boardToCpp` — potencjalny crash na nieprawidłowych danych
- **Severity:** important
- **File:** server/boardConvert.js, funkcja `boardToCpp` (linie ~68-88)
- **Description:** `boardToCpp` robi `board.flat()` i sprawdza czy `flat.length > 64`, ale nie sprawdza czy `flat.length < 64`. Jeśli plansza jest niekompletna (np. 7 wierszy zamiast 8), funkcja zwróci tablicę krótszą niż 64 elementów. `buildInputArray` w model.js zakłada dokładnie 64 elementy i wyrzuci błąd, ale dopiero w trakcie predykcji — trudny do debugowania.
- **Sprawdzić:** Dodatkowa walidacja `flat.length !== 64` z ostrzeżeniem i zwróceniem tablicy wypełnionej zerami.

---

## Pomniejsze (Minor)

### BUG-009: Wskaźnik `legalMoves` w Board.jsx — memoization nie działa
- **Severity:** minor
- **File:** client/src/components/Board.jsx, funkcja `areEqual` (linie ~390-400)
- **Description:** `areEqual` porównuje `prevProps.legalMoves !== nextProps.legalMoves` (referencja). Tablica `legalMoves` w App.jsx jest tworzona na nowo przy każdym renderze (nawet jeśli zawartość się nie zmieniła), więc `!==` zawsze zwraca `true` (różne referencje), co powoduje re-render Board mimo braku zmian. Optymalizacja `React.memo` nie działa jak zamierzono.
- **Suggestion:** Albo memoizować `legalMoves` w App.jsx (`useMemo`), albo zmienić `areEqual` na porównanie zawartości (deep compare lub porównanie po kluczach `from`/`to`).

### BUG-010: Proxy filter niepoprawnie routuje `/api/ai` (bez trailing slash)
- **Severity:** minor
- **File:** server/proxy.js, linia ~15 (filter function)
- **Description:** Filter sprawdza `!pathname.startsWith('/ai/')`. Gdy Express mountuje proxy na `/api`, `pathname` to ścieżka po `/api`. Dla `/api/ai` (dokładnie, bez dalszej ścieżki), `pathname` = `/ai`, które NIE zaczyna się od `/ai/` (brak trailing slash). Proxy przekaże to do C++ engine jako `/api/ai`, który zwróci 404. W praktyce to mało prawdopodobne (Express route `/api/ai/predict` przechwytuje zanim dotrze do proxy), ale edge case istnieje.
- **Suggestion:** Zmienić filter na `!pathname.startsWith('/ai/') && pathname !== '/ai'` lub `!pathname.startsWith('/ai')`.

### BUG-011: `predict()` — fallback do `legalMoves[0]` gdy policy index nie pasuje do żadnego ruchu
- **Severity:** minor
- **File:** server/ai/model.js, funkcja `predict` (linia ~240)
- **Description:** `legalMoves.find(m => ...)` może zwrócić `undefined` jeśli `bestIdx` (policy index 0-127) nie pasuje do żadnego ruchu w liście. Wtedy fallback to `legalMoves[0]` — zawsze ten sam ruch, niezależnie od sytuacji na planszy. To może powodować przewidywalne, suboptymalne zachowanie AI.
- **Suggestion:** Zamiast `legalMoves[0]`, wybrać ruch z najwyższym prawdopodobieństwem z `normalizedProbs` (argmax), lub losowy ruch.

### BUG-012: C++ engine — `__builtin_ctzll` jest GCC/Clang-specific, nie przenośne
- **Severity:** minor
- **File:** engine/src/server.cpp, engine/src/movegen.cpp (wiele miejsc)
- **Description:** `__builtin_ctzll` to intrinsics GCC/Clang. Na MSVC nie skompiluje się. To nie jest bug per se, ale ograniczenie przenośności.
- **Suggestion:** Dodać `#ifdef _MSCVP` fallback z `_BitScanForward64`, lub użyć `std::countr_zero` z C++20 `<bit>`.

### BUG-013: Brak walidacji pola `path` w ruchach C++ → klient
- **Severity:** minor
- **File:** server/index.js, funkcja `handleMove` (linia ~245)
- **Description:** `moveResult.path` z C++ engine jest używane bezpośrednio do animacji bez walidacji. Jeśli C++ zwróci `path` z nieprawidłowymi współrzędnymi (poza 0-7), animacja może próbować rysować poza planszą SVG.
- **Suggestion:** Zwalidować każdy punkt `path`: `Array.isArray(p) && p.length === 2 && p[0]>=0 && p[0]<=7 && p[1]>=0 && p[1]<=7`.

### BUG-014: `setInterval` rate-limit cleanup nigdy nie jest czyszczony
- **Severity:** minor
- **File:** server/index.js, linie ~37-55
- **Description:** `setInterval` do czyszczenia `_rateLimitMap` jest tworzony globalnie i nigdy nie jest czyszczony (`clearInterval`). Dla procesu serwerowego to normalne (proces żyje cały czas), ale utrudnia testy i graceful shutdown.
- **Suggestion:** Zapisać referencję do intervalu i czyścić go w handlerze `process.on('SIGTERM', ...)` lub `process.on('beforeExit', ...)`.

### BUG-015: Brak walidacji typów w WebSocket handlerach `setSpeed` / `setSpeedMode`
- **Severity:** minor
- **File:** server/index.js, linie ~386, ~416
- **Description:** Oba handlery sprawdzają typ (`typeof ms !== 'number'`, `typeof mode !== 'string'`), ale nie sprawdzają czy `ms` jest `NaN` jawnie — `Number.isNaN(ms)` jest w `setSpeed`, ale co z `Infinity`? `Math.max(0, Math.min(Infinity, 10000))` = 10000, więc to akceptowalne. Natomiast `setSpeedMode` sprawdza tylko `typeof mode !== 'string'`, nie sprawdza czy to pusty string `""` — `"" === 'fast'` to `false`, `"" === 'normal'` to `false`, więc nic się nie dzieje (cichy noop). Niskie ryzyko, ale lepiej mieć jawne odrzucenie.
- **Suggestion:** Dodać walidację `mode === ''` → odrzucić z komunikatem błędu.

---

## Podsumowanie

| Kategoria | Liczba |
|-----------|--------|
| Critical  | 3      |
| Important | 5      |
| Minor     | 7      |
| **Razem** | **15** |

### Najważniejsze znaleziska:

1. **Konfigurowalne parametry AI są martwe** (BUG-001, 002, 003): 6 parametrów z UI (reward weights, gamma, minEpsilon, epsilonDecay, bufferSize, epochs) jest zapisywanych ale nigdy odczytywanych w miejscu użycia. Użytkownik zmienia slidery, ale trening zachowuje się identycznie.

2. **Brak autentykacji WS** (BUG-004): Każdy kto ma dostęp do portu serwera może kontrolować grę, resetować model, startować/stopować self-play. W środowisku produkcyjnym to poważna luka.

3. **Race condition HTTP predict/train vs WS setParams** (BUG-005): Jednoczesne wywołanie HTTP predict i WS setParams może prowadzić do crasha TensorFlow.js (używanie disposed modelu).

---

*Skany przeprowadzone przez dynamic-bug-finder. Raport nie zawiera propozycji napraw — tylko dokumentację znalezionych problemów.*
