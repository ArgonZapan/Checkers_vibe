# Hunter Data Leak Check — Checkers_vibe (Round 2)
**Data:** 2026-03-23
**Agent:** Hunter sub-dataleak
**Zakres:** boardFromCpp/boardToCpp, board state isolation, C++ engine memory, WebSocket data handling
**Kontekst:** Po refaktoryzacji boardFromCpp/boardToCpp (commit 00d36f9), walidacji kształtu 2D array (commit 40ad141), poprzednim audycie (commit 81e7233)

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| boardFromCpp/boardToCpp reference leaks | ✅ Czysto | 0 |
| Board state isolation (ruchy) | ✅ Czysto | 0 |
| C++ engine buffer/memory | ✅ Czysto | 0 |
| WebSocket input sanitization | ✅ Poprawione | 0 |
| Shallow copy issues | ⚠️ Latentne | 2 |
| ReplayBuffer direct references | ⚠️ Latentne | 1 |
| CONFIG globalna mutacja | ⚠️ Latentne | 1 |

**Ogólny werdykt:** Refaktoryzacja boardFromCpp/boardToCpp jest solidna — brak wycieków referencji. Poprzedni audyt naprawił większość problemów. Nowo znalezione problemy to latentne ryzyka, nie aktywne exploity.

---

## Szczegóły

### DL-001: boardToCpp mutuje wejście przez flat.length = 64
- **Severity:** kosmetyczny
- **Plik:** server/boardConvert.js:62-66
- **Opis:** `boardToCpp` robi `const flat = board.flat()` a potem `flat.length = 64` (truncacja). `Array.prototype.flat()` tworzy nową tablicę, więc mutacja `flat` nie wpływa na oryginał. ALE gdy wejście jest już flat (1D), `.flat()` zwraca referencję do oryginału — wtedy `flat.length = 64` mutuje wejście.
- **Aktualny stan:** Bezpieczne — `boardToCpp` zawsze dostaje 8x8 React board z `boardFromCpp` lub `getGameState()`. Żaden call site nie przekazuje 1D tablicy.
- **Fix:** Dodać `const flat = board.flat().slice(0, 64)` zamiast mutacji `.length`. Koszt minimalny, eliminuje latentne ryzyko.

### DL-002: ReplayBuffer zwraca bezpośrednie referencje do przechowywanych obiektów
- **Severity:** kosmetyczny
- **Plik:** server/ai/buffer.js:24-30 (metoda sample)
- **Opis:** `buffer.sample(n)` zwraca `result.push(this.buffer[...])` — bezpośredni referencje do obiektów w buforze. Kod treningowy (`train()`) czyta z tych obiektów ale nie modyfikuje ich. Gdyby jednak ktoś nadpisał `sample.board` lub `sample.chosenMove`, zmieniłby dane treningowe w buforze.
- **Aktualny stan:** Bezpieczne — `train()` tylko czyta sample, nie mutuje. `_playGame` tworzy nowe obiekty sample przed dodaniem.
- **Fix:** Zwrócić shallow copy: `result.push({...this.buffer[...]})`. Niski koszt, eliminuje ryzyko cross-contamination.

### DL-003: modelParams — shallow copy przez spread
- **Severity:** kosmetyczny
- **Plik:** server/index.js:165, server/ai/trainer.js (setParams, init)
- **Opis:** `createModel({...trainer.modelParams})` robi shallow copy. Wszystkie właściwości `modelParams` są prymitywami (number, string), więc shallow copy jest wystarczające. Ale jeśli ktoś dodałby zagnieżdżony obiekt do modelParams, zostałby współdzielony.
- **Aktualny stan:** Bezpieczne — modelParams zawiera tylko: layers, neurons, activation, lr, batchSize, dropout (wszystkie prymitywy).
- **Fix:** Brak (obecnie wystarczające). Gdyby struktura się zmieniła, użyć structuredClone lub JSON.parse(JSON.stringify()).

### DL-004: CONFIG globalna mutacja przez WebSocket — brak izolacji
- **Severity:** kosmetyczny
- **Plik:** server/index.js:484-498 (setSpeed, setSpeedMode), config.js
- **Opis:** `setSpeed` i `setSpeedMode` bezpośrednio mutują `CONFIG.server.aiMoveDelayMs` i `CONFIG.server.speedMode`. Każdy podłączony WebSocket client może zmienić te wartości. Zmiana jest globalna — wpływa na self-play, PvAI, wszystkich klientów.
- **Aktualny stan:** Walidacja typeof jest poprawiona (LEAK-006 z poprzedniego audytu). Wartości są clampowane (0-10000ms). Ale brak izolacji między sesjami — jeden gracz w PvP może spowolnić AI w innej sesji.
- **Fix:** Rozważyć per-socket lub per-game speed config zamiast globalnego. Niski priorytet — aplikacja to single-game dev tool.

### DL-005: boardFromCpp — brak kopiowania input array (referencja do C++ JSON)
- **Severity:** kosmetyczny
- **Plik:** server/boardConvert.js:27-47
- **Opis:** Gdy `cppBoard` jest już 2D, `boardFromCpp` ustawia `board2D = cppBoard` (referencja) a potem robi `board2D.map(row => row.map(...))`. `.map()` tworzy nowe tablice, więc oryginał nie jest mutowany. Ale `board2D` wskazuje na ten sam obiekt co `cppBoard` — gdyby kod między przypisaniem a mapowaniem modyfikował `board2D`, zmieniłby oryginał.
- **Aktualny stan:** Bezpieczne — między `board2D = cppBoard` a `.map()` jest tylko walidacja (odczyt), nie mutacja.
- **Fix:** Brak (obecnie bezpieczne). Dla jasności: `const board2D = [...cppBoard]` na początku.

### DL-006: C++ multiCapture — rollback per-direction, nie per-capture
- **Severity:** kosmetyczny (C++ engine)
- **Plik:** engine/src/movegen.cpp:118-200
- **Opis:** `multiCapture` mutuje board in-place i robi rollback per-direction (save/restore na początku/końcu każdej gałęzi rekurencji). Gdyby rekurencja rzuciła wyjątek (np. OOM), board zostałby w niespójnym stanie.
- **Aktualny stan:** Bezpieczne — C++ engine nie rzuca wyjątków (brak try/catch, brak allocacji w hot path poza vector::push_back). Serwer jest single-threaded z mutexem.
- **Fix:** Brak (teoretyczne ryzyko, praktycznie nieistotne).

---

## Weryfikacja poprzednich fixów (LEAK-001..011)

| ID | Problem | Status |
|----|---------|--------|
| LEAK-001 | Security headers | ✅ Naprawione — middleware na linii 28 |
| LEAK-002 | Rate limiting | ✅ Naprawione — in-memory Map + cleanup interval |
| LEAK-003 | Server bind 0.0.0.0 | ✅ Naprawione — `HOST = process.env.HOST \|\| '127.0.0.1'` |
| LEAK-005 | setParams type-check | ✅ Naprawione — `typeof !== 'object' \|\| Array.isArray` check |
| LEAK-006 | Config mutation | ✅ Częściowo — typeof check jest, ale globalna mutacja nadal istnieje (DL-004) |
| LEAK-007 | Batch validation | ✅ Naprawione — walidacja struktury każdego sample |
| LEAK-010 | Captures validation | ✅ Naprawione — `isValidCoord` na każdym elemencie |
| LEAK-011 | Prototype pollution | ✅ Naprawione — whitelist `ALLOWED_PARAMS` w setParams |

---

## Testy — Board State Isolation

| Check | Result |
|-------|--------|
| boardFromCpp tworzy nowe tablice (nie referencje) | ✅ `.map(row => row.map(...))` = nowe obiekty |
| boardToCpp nie mutuje wejścia (gdy 8x8 input) | ✅ `.flat()` tworzy nową tablicę |
| getGameState() zwraca fresh board | ✅ `boardFromCpp(state.board)` = nowy obiekt |
| handleMove() nie współdzieli state.board między klientami | ✅ `getGameState()` wywoływane per-event |
| C++ Board copy jest bezpieczny (bitboard, nie pointery) | ✅ Trivial copy, wartościowe typy |
| AI move nie mutuje legalMoves | ✅ `movesWithIndex` tworzy nowe obiekty |
| Próbkowanie z buffer nie mutuje stored samples | ✅ train() tylko czyta |

## Testy — WebSocket Data Flow

| Check | Result |
|-------|--------|
| move event: from/to validated 0-7 | ✅ `isValidCoord` check |
| captures elements validated | ✅ `isValidCoord` per element |
| setParams: whitelist + type validation | ✅ `ALLOWED_PARAMS` Set |
| setSpeed: typeof number + NaN check | ✅ |
| setSpeedMode: typeof string check | ✅ |
| getLegalMoves: from validated 0-7 | ✅ |
| C++ /api/board/set: board values 0-4 | ✅ |
| C++ /api/move: JSON parse error handling | ✅ try/catch |

## Testy — C++ Engine Memory

| Check | Result |
|-------|--------|
| Board class: no raw pointers, no dynamic alloc | ✅ Bitboard = uint64_t |
| Move class: fixed-size arrays (MAX_CAPTURES=12) | ✅ Stack allocated |
| multiCapture: bounded recursion (max 12 captures) | ✅ capturedMask limits depth |
| server.cpp: mutex protects shared Engine | ✅ lock_guard on all routes |
| json::parse error handling | ✅ try/catch on all POST routes |

---

## Commit / Diff

Nowe problemy znalezione: 6 (wszystkie kosmetyczne/latentne)
Aktywne exploity: 0
Krytyczne wycieki: 0

Refaktoryzacja boardFromCpp/boardToCpp (00d36f9) jest poprawna — brak regresji.
Walidacja 2D array shape (40ad141) skutecznie zapobiega crashom z malformed data.
