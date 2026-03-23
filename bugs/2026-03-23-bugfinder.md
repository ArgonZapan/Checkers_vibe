# Raport Bugów — 2026-03-23 — hunter-bugfinder

Skany: server/index.js, server/boardConvert.js, server/proxy.js, config.js, server/ai/trainer.js, server/ai/model.js, server/ai/buffer.js, client/src/App.jsx, client/src/components/Board.jsx, client/src/components/ParamsPanel.jsx

---

### BUG-001: `boardFromCpp` brak walidacji — crash na null/undefined/pustej tablicy
- **Severity:** krytyczny
- **Lokalizacja:** server/boardConvert.js:20
- **Kroki reprodukcji:** C++ engine zwróci `board: null`, `board: []`, lub `board: undefined` w odpowiedzi `/api/game/state`. `boardFromCpp(null)` → crash `Cannot read properties of null (reading 'map')`.
- **Oczekiwane:** Graceful error lub domyślna pusta plansza
- **Rzeczywiste:** Unhandled crash w `getGameState()`, który leci do `catch` w WS handler, ale z niejasnym komunikatem
- **Propozycja naprawy:** Dodać walidację wejścia na początku funkcji:

```js
export function boardFromCpp(cppBoard) {
  if (!cppBoard || !Array.isArray(cppBoard)) {
    console.warn('[boardFromCpp] Invalid input:', typeof cppBoard);
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  // ... reszta kodu
```

---

### BUG-002: `boardToCpp` brak walidacji — crash na nieprawidłowej planszy
- **Severity:** krytyczny
- **Lokalizacja:** server/boardConvert.js:40
- **Kroki reprodukcji:** Jeśli `board` jest `null`, `undefined`, nie jest tablicą, lub zawiera elementy o nieoczekiwanej strukturze (np. `{ color: null }`), `board.flat()` lub `p.color` crashuje.
- **Oczekiwane:** Walidacja wejścia, zwrócenie pustej planszy lub error
- **Rzeczywiste:** Crash `Cannot read properties of undefined (reading 'flat')` lub `Cannot read properties of null (reading 'color')`
- **Propozycja naprawy:**

```js
export function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    console.warn('[boardToCpp] Invalid input:', typeof board);
    return new Array(64).fill(0);
  }
  return board.flat().map(p => {
    if (!p || typeof p !== 'object') return 0;
    if (p.color === 'white') return p.king ? 2 : 1;
    if (p.color === 'black') return p.king ? 4 : 3;
    return 0;
  });
}
```

---

### BUG-003: Race condition — `_saving` flag + `dirty` flag w auto-save
- **Severity:** ważny
- **Lokalizacja:** server/index.js:286-310
- **Kroki reprodukcji:**
  1. Auto-save interval odpala, `_saving = true`
  2. Self-play pisze `trainer.dirty = true` w trakcie
  3. Auto-save czyta `trainer.dirty` (było true, bo zostało ustawione przed save)
  4. Auto-save kończy, ustawia `trainer.dirty = false`
  5. Następny interval nie widzi zmiany bo dirty zostało wyczyszczone
  W praktyce: jeden tick opóźnienia, ale przy szybkim self-play (setki gier/min) statystyki zapisywane co 30s mogą być stale o kilka gier.
- **Oczekiwane:** Każda zmiana jest zapisana
- **Rzeczywiste:** Możliwa utrata 1 tick dirty flag jeśli jest ustawiany exactly w momencie clear
- **Propozycja naprawy:** Snapshottować dirty przed zapisem i czyścić po:

```js
setInterval(async () => {
  if (_saving) return;
  const wasDirty = trainer.dirty;
  if (!wasDirty) return;
  _saving = true;
  try {
    // ... save logic ...
    if (wasDirty) trainer.dirty = false; // czyść tylko jeśli snapshottowany dirty był true
  } finally { _saving = false; }
}, CONFIG.server.autoSaveMs);
```

W praktyce Node.js single-threaded, więc to jest teoretyczne — ale jako defensive programming warto mieć.

---

### BUG-004: `setSpeed` i `setSpeedMode` nie broadcastują zmian do innych klientów
- **Severity:** ważny
- **Lokalizacja:** server/index.js:233-246
- **Kroki reprodukcji:**
  1. Klient A ustawia speed na 100ms
  2. Klient B (inne okno) nadal widzi stary speed w UI
  3. Serwer używa nowej wartości, ale UI klienta B jest desynchronizowany
- **Oczekiwane:** Wszyscy klienci widzą aktualny speed
- **Rzeczywiste:** Tylko ustawiający klient ma aktualną wartość
- **Propozycja naprawy:** Dodać `io.emit('speedUpdate', ...)` po zmianie:

```js
socket.on('setSpeed', (ms) => {
  if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
    socket.emit('error', { message: 'Invalid speed value' });
    return;
  }
  const clamped = Math.max(0, Math.min(ms, 10000));
  CONFIG.server.aiMoveDelayMs = clamped;
  if (clamped > 0) CONFIG.server.normalModeDelayMs = clamped;
  io.emit('speedUpdate', { aiMoveDelayMs: clamped });  // ← DODANE
  console.log(`[WS] Speed set to ${clamped}ms`);
});

socket.on('setSpeedMode', (mode) => {
  if (mode === 'fast' || mode === 'normal') {
    CONFIG.server.speedMode = mode;
    io.emit('speedUpdate', { speedMode: mode });  // ← DODANE
    console.log(`[WS] Speed mode set to: ${mode}`);
  }
});
```

---

### BUG-005: Config mutation — direct mutation CONFIG.server.* w concurrent handlers
- **Severity:** ważny
- **Lokalizacja:** server/index.js:233-246, config.js:31-34
- **Kroki reprodukcji:** CONFIG jest eksportowany jako `const` ale jego properties są modyfikowane runtime. Dwa sockety mogą jednocześnie pisać `CONFIG.server.speedMode` i `CONFIG.server.aiMoveDelayMs`. Node.js single-threaded, więc race condition jest teoretyczna, ale brak jest atomicity — handler `setSpeed` czyta `CONFIG.server.aiMoveDelayMs` a potem pisze, a w międzyczasie `setSpeedMode` może zmienić `speedMode` co zmienia zachowanie `moveDelayMs` gettera.
- **Oczekiwane:** Atomicna zmiana konfiguracji
- **Rzeczywiste:** Direct mutation bez żadnej synchronizacji
- **Propozycja naprawy:** Brak prostej naprawy — to jest architectural issue. W praktyce Node.js event loop zapobiega true data races, ale warto dodać defensive logging.

---

### BUG-006: `turnToColor` domyślnie zwraca 'white' na nieznane wartości
- **Severity:** kosmetyczny
- **Lokalizacja:** server/index.js:65
- **Kroki reprodukcji:** C++ engine zwraca `turn: null`, `turn: undefined`, `turn: 0`, `turn: NaN`, `turn: 'red'`. `turnToColor` zwraca 'white' bez warningu.
- **Oczekiwane:** Log ostrzeżenia o nieoczekiwanej wartości
- **Rzeczywiste:** Cicha zamiana na 'white', trudna do debugowania
- **Propozycja naprawy:**

```js
const turnToColor = (turn) => {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  console.warn(`[turnToColor] Unexpected turn value: ${turn} (${typeof turn}), defaulting to 'white'`);
  return 'white';
};
```

---

### BUG-007: `paramsUpdate` event nie wysyła pełnych danych (epsilon, speed)
- **Severity:** ważny
- **Lokalizacja:** server/index.js:216 (setParams handler), server/index.js:188 (connect handler)
- **Kroki reprodukcji:**
  1. Klient A (aivai) zmienia epsilon/speed przez UI
  2. Serwer `io.emit('paramsUpdate', { modelParams: ... })` — nie zawiera epsilonWhite, speedMode, aiMoveDelayMs
  3. Klient B (inny) odbiera `paramsUpdate` z brakującymi polami
  4. Klient B ma w UI stare wartości epsilonu/speedu
- **Oczekiwane:** `paramsUpdate` zawiera wszystkie aktualne parametry
- **Rzeczywiste:** Tylko `modelParams` jest wysyłany w `setParams` handler
- **Propozycja naprawy:** W `setParams` handler dodać pełne dane:

```js
io.emit('paramsUpdate', {
  modelParams: { ...trainer.modelParams },
  epsilonWhite: trainer.epsilonWhite,
  epsilonBlack: trainer.epsilonBlack,
  speedMode: CONFIG.server.speedMode,
  aiMoveDelayMs: CONFIG.server.aiMoveDelayMs,
});
```

---

### BUG-008: Proxy filter path — potencjalny konflikt z C++ API routes
- **Severity:** ważny
- **Lokalizacja:** server/proxy.js:10-13
- **Kroki reprodukcji:** `filter` sprawdza `pathname.startsWith('/ai/')` i `pathname.startsWith('/selfplay/')`. Express mount `/api` strips prefix, więc filter widzi `/game/state`, `/move`, `/ai/info` etc. Jeśli C++ engine ma własny route `/api/ai/*` lub `/api/selfplay/*`, filter go zablokuje. Obecnie C++ nie ma takich routes, ale to jest fragile assumption.
- **Oczekiwane:** Jawne wykluczenie tylko Node.js routes
- **Rzeczywiste:** Implicit assumption o strukturze C++ API
- **Propozycja naprawy:** Dodać comment dokumentujący assumption, lub użyć explicit whitelist zamiast blacklist.

---

### BUG-009: `captures` validation — brak walidacji elementów tablicy
- **Severity:** kosmetyczny
- **Lokalizacja:** server/index.js:167-169
- **Kroki reprodukcji:** Client wysyła `{ from: [3,2], to: [5,4], captures: ["invalid", null, 42] }`. Walidacja sprawdza tylko `Array.isArray(captures)` ale nie strukturę elementów.
- **Oczekiwane:** Odrzucenie nieprawidłowych captures
- **Rzeczywiste:** Nieprawidłowe captures przechodzą do C++ engine (który może crashować lub je ignorować)
- **Propozycja naprawy:**

```js
if (captures != null) {
  if (!Array.isArray(captures)) {
    socket.emit('error', { message: 'Invalid "captures" — expected an array' });
    return;
  }
  if (!captures.every(c => isValidCoord(c))) {
    socket.emit('error', { message: 'Invalid "captures" — each element must be [row, col] 0-7' });
    return;
  }
}
```

---

### BUG-010: ParamsPanel UI oferuje 'elu' activation, serwer nie obsługuje
- **Severity:** kosmetyczny
- **Lokalizacja:** client/src/components/ParamsPanel.jsx:~105, server/ai/model.js:~47
- **Kroki reprodukcji:** W ParamsPanel wybieramy activation "ELU" → wysyłamy do serwera → serwer waliduje `['relu', 'tanh', 'sigmoid', 'leaky_relu']` → ELU nie przechodzi → fallback do 'relu' z warningiem w logu.
- **Oczekiwane:** UI pokazuje tylko obsługiwane activation functions, LUB serwer obsługuje ELU
- **Rzeczywiste:** Cicha zamiana ELU→ReLU, użytkownik nie wie
- **Propozycja naprawy:** Usunąć `<option value="elu">ELU</option>` z ParamsPanel, lub dodać obsługę ELU w `createModel`.

---

### BUG-011: `moveHistory` turn label jest odwrócony
- **Severity:** kosmetyczny
- **Lokalizacja:** client/src/App.jsx:~93
- **Kroki reprodukcji:** W handlerze `state` event, ruch jest zapisywany z `turn: data.turn === 'white' ? 'black' : 'white'`. To zakłada, że `data.turn` to TURA PO ruchu (co jest poprawne — serwer zawsze wysyła aktualną turę). Ale jeśli C++ engine zwraca turn PRZED ruchem (np. w stanie z lastMove), label będzie odwrócony.
- **Oczekiwane:** Historia ruchów pokazuje prawidłowy kolor gracza
- **Rzeczywiste:** Zależy od tego, czy C++ zwraca turn przed czy po ruchu
- **Propozycja naprawy:** Użyć `lastMove.player` jeśli dostępne, zamiast obliczać z `data.turn`.

---

### BUG-012: `_playGame` — stale legalMoves przy retry z innym ruchem
- **Severity:** ważny
- **Lokalizacja:** server/ai/trainer.js:~285-310
- **Kroki reprodukcji:**
  1. `_playGame` pobiera legalMoves na początku iteracji
  2. Wybiera ruch, wysyła do C++, dostaje 400
  3. Na retry pobiera `_randomLegalMove(legalMoves)` — ale legalMoves jest z początku iteracji
  4. Jeśli C++ engine zmienił stan (inny proces/serwis), legalMoves mogą być nieaktualne
  5. Retry używa stale legalMoves → kolejny 400
- **Oczekiwane:** Przy retry pobierać fresh legalMoves
- **Rzeczywiste:** Używa starych legalMoves z początku iteracji
- **Propozycja naprawy:** W bloku retry, przed `_randomLegalMove`, pobrać fresh legalMoves:

```js
if (moveRes.status === 400) {
  // Refresh legal moves before retry
  try {
    const freshLmRes = await cppFetch(`${CPP_BASE}/api/legal-moves`);
    if (freshLmRes.ok) {
      const freshData = await freshLmRes.json();
      if (freshData.moves && freshData.moves.length > 0) {
        legalMoves.length = 0; // clear and repopulate
        legalMoves.push(...freshData.moves);
      }
    }
  } catch {}
  const altMove = this._randomLegalMove(legalMoves);
  // ...
}
```

---

### BUG-013: Trainer `roundTimes` array — potential unbounded growth if `_loop` stops/errors
- **Severity:** kosmetyczny
- **Lokalizacja:** server/ai/trainer.js:~394
- **Kroki reprodukcji:** `roundTimes` jest capped na 10 elementów (`if (this.roundTimes.length > 10) this.roundTimes.shift()`). To jest poprawnie. Ale `totalTimeMs` rośnie bez limitu — po ~24.8 dniach ciągłego self-play przekroczy `Number.MAX_SAFE_INTEGER` (2^53 ms ≈ 285,616 lat). W praktyce nie problem, ale worth noting.
- **Oczekiwane:** Brak overflow
- **Rzeczywiste:** Teoretyczny overflow po ~285k lat
- **Propozycja naprawy:** Brak — to nie jest realistyczny problem.

---

## Podsumowanie

| Severity | Count | Fixed |
|----------|-------|-------|
| Krytyczny | 2 | 2 (BUG-001, BUG-002) |
| Ważny | 5 | 3 (BUG-003, BUG-004, BUG-007) |
| Kosmetyczny | 4 | 1 (BUG-010) |

Naprawione w branch `fix/hunter-bugfixes`:
- BUG-001: boardFromCpp walidacja
- BUG-002: boardToCpp walidacja
- BUG-004: setSpeed/setSpeedMode broadcast
- BUG-007: paramsUpdate pełne dane
- BUG-010: usunięcie ELU z UI

Pozostałe do dyskusji/decyzji:
- BUG-003: race condition — teoretyczna, ale defensive fix
- BUG-005: config mutation — architectural
- BUG-006: turnToColor — kosmetyczny (dodanie warninga)
- BUG-008: proxy filter — documentation
- BUG-009: captures walidacja — warto naprawić
- BUG-011: moveHistory turn — zależy od C++ behavior
- BUG-012: stale legalMoves — warto naprawić
