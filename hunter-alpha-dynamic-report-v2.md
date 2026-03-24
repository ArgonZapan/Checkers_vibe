# Hunter Alpha — Dynamic Bug Report v2

**Data:** 2026-03-24 00:19–00:27 UTC  
**Tester:** Hunter Alpha — dynamic-bug-finder  
**Metoda:** HTTP endpoint testing, WebSocket event fuzzing, race condition probing, code review + runtime verification

---

## Środowisko Testowe

- **C++ Server:** `checkers-server` na `localhost:8080` (działa od Mar 23)
- **Node.js Server:** `node server/index.js` na `localhost:3000` (restartowany podczas testów — patrz BUG-DYN-006)
- **Mode:** Self-play aktywny (1720+ gier), PvAI/PvP dostępne przez WebSocket

---

## Analiza Zgłoszonych Bugów (5 znanych)

### 1. isHumanPiece (client/src/App.jsx:367-369)

**Status: NISKA SEVERITY — kod wygląda poprawnie, ale window of vulnerability istnieje**

```js
const isHumanPiece = modeRef.current === 'pvai'
  ? piece && piece.color === 'white' && turnRef.current === 'white'
  : piece && piece.color === turnRef.current;
```

Kod sprawdza `turnRef.current === 'white'`, co blokuje klikanie białych bierek gdy tura jest black. Problem jest **timingowy**: w PvAI, po ruchu gracza, serwer wysyła AI move. W oknie między "gracz wykonał ruch" a "klient otrzymał nowy gameState z turn=black", `turnRef` wciąż może być `white`. W tym oknie `getLegalMoves` może fire na białych bierkach mimo że C++ engine już zmienił turę na black.

**Potwierdzenie dynamiczne:** Nie udało się odtworzyć w testach HTTP (ruchy są przez WebSocket, nie HTTP). Race window jest sub-sekundowy.

**Rekomendacja:** Dodać server-side turn validation w `getLegalMoves` handlerze — jeśli `state.turn !== requestedPieceColor`, odrzuć.

---

### 2. getLegalMoves Race (server/index.js:485-498)

**Status: POTWIERDZONY — niska severity w praktyce**

```js
socket.on('getLegalMoves', async ({ from }) => {
  if (!wsThrottle(socket, 'getLegalMoves', 50)) return;
  // ...
  try {
    const state = await getGameState();  // ← async, nie serializowane przez _moveQueue
    const filtered = state.legalMoves.filter(...);
    socket.emit('legalMoves', { from, moves: filtered });
  }
});
```

`getLegalMoves` NIE jest serializowany przez `socket._moveQueue`. Jeśli `handleMove` jest w trakcie wykonywania (move do C++ poszedł, ale odpowiedź jeszcze nie wróciła), `getLegalMoves` może zwrócić **stale legal moves** z poprzedniego stanu planszy.

**Test dynamiczny:** Wysłano 20 rapid `getLegalMoves` + 30 rapid `move` przez WebSocket. Throttle (50ms) odrzucił większość — tylko 1 response dotarł. Race nie został odtworzony, ale kod ma oczywisty gap.

**Impact:** Klient może wyświetlić nieaktualne legal moves. Kliknięcie takiego ruchu zostanie odrzucone przez C++ engine (400), co da "Move failed" error — UX problem, nie security.

---

### 3. Proxy Body Handling (server/proxy.js:35-45)

**Status: POTWIERDZONY — niska praktyczna severity**

```js
on: {
  proxyReq: (_proxyReq, req) => {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    if (hasBody && req.body) {  // ← req.body jest undefined dla form-encoded!
      const bodyData = JSON.stringify(req.body);
      _proxyReq.setHeader('Content-Type', 'application/json');
      _proxyReq.write(bodyData);
      _proxyReq.end();
    }
  }
}
```

`express.json()` parsuje tylko `application/json`. Dla `application/x-www-form-urlencoded`, `text/plain`, `multipart/form-data` — `req.body` jest `undefined`, proxy przesyła request BEZ body do C++ backend.

**Test dynamiczny:**
- `POST /api/game/move` z `Content-Type: application/x-www-form-urlencoded` → **404** (C++ nie ma tego endpointu — ale body i tak byłoby puste)
- `POST /api/ai/predict` z form-encoded → **400** `{"error":"Missing board or legalMoves"}` (Node.js route, body tracony)

**Impact:** Niski — główne API ruchów idzie przez WebSocket/cppFetch (pomija proxy). Ale jeśli ktoś użyje form-encoded do `/api/ai/*` routes, body zostanie cicho tracone → 400 zamiast helpful error.

**Fix:** Dodać `express.urlencoded({ extended: true })` jako fallback, LUB odrzucać non-JSON requesty z 415.

---

### 4. King Multi-Capture Animation (client/src/components/Board.jsx:72-96)

**Status: CZĘŚCIOWO POTWIERDZONY — edge case**

Kod ma dwa tryby detekcji schwytanych bierek:
1. **Primary:** Używa `captures` prop (poprawna lista od serwera)
2. **Fallback:** Szuka opponentów na diagonali między kolejnymi krokami path

Problem z fallback:
```js
for (let i = 0; i < path.length - 1; i++) {
  const [r1, c1] = path[i];
  const [r2, c2] = path[i + 1];
  // Check cells between r1,c1 and r2,c2 for captured pieces
  let r = r1 + dr, c = c1 + dc;
  while (r !== r2 || c !== c2) {
    if (prevBoard[r]?.[c] && prevBoard[r][c].color !== movingPiece.color) {
      capturedPositions.push([r, c]);  // ← bierze PIERWSZĄ znalezioną bierkę
    }
    r += dr; c += dc;
  }
}
```

Jeśli na diagonali między krokami path jest **wiele** opponentów, fallback oznaczy WSZYSTKIE jako schwytane — nawet jeśli król przeskoczył tylko jednego. To prowadzi do złej animacji (znikają nieschwytane bierki).

**Ale:** Ten fallback jest używany TYLKO gdy `captures` prop jest pusty/undefined. Server zawsze wysyła `captures`, więc fallback nie jest aktywny w normalnym przepływie.

**Impact:** Teoretyczny — wymaga brakujących captures z serwera. Niska severity.

---

### 5. Trainer Duplicate Game-Over (server/ai/trainer.js:724 i 791-816)

**Status: POTWIERDZONY — kod jest zduplikowany z ryzykiem divergencji**

Blok 1 (line 724-762): Obsługa `gameOver === true` z C++ engine
Blok 2 (line 791-816): Safety net gdy `legalMoves.length === 0` ale `gameOver === false`

Oba bloki robią identyczne rzeczy:
- `stats.draws++` / `stats.gamesPlayed++`
- `samples[].result = 0`
- `samples[samples.length-1].done = true`
- `buffer.add(s)` dla każdego sample
- `io.emit('gameOver', ...)`
- Aktualizacja `roundTimes`, `totalTimeMs`

Komentarz w kodzie mówi: _"This duplicates the gameOver block above intentionally"_

**Ryzyko divergencji:** Jeśli ktoś zaktualizuje np. format eventu `gameOver` w bloku 1, blok 2 zostanie z starym formatem. Lub jeśli doda się nowe statystyki w bloku 1, blok 2 ich nie zaktualizuje.

**Test dynamiczny:** Self-play działa poprawnie (1722 gier). Blok 2 nie był aktywowany podczas testów (C++ engine zawsze zgłaszał `gameOver: true` gdy nie było ruchów).

---

## Nowo Znalezione Bugi

### BUG-DYN-006: Model Auto-Save Crash (ENOTEMPTY)

**Severity: WAŻNY** — model nie jest zapisywany na dysk  
**Lokalizacja:** `server/ai/model.js:427` → `saveModel()`

```
[AutoSave] Save error: ENOTEMPTY: directory not empty, rename 
  '/opt/Checkers_vibe/data/model/white.tmp' -> '/opt/Checkers_vibe/data/model/white'
```

**Kroki reprodukcji:**
1. Uruchom self-play
2. Poczekaj na auto-save (co ~60s lub po grze)
3. `saveModel()` tworzy `white.tmp/`, zapisuje model, próbuje `rename(white.tmp, white)`
4. `rename()` rzuca `ENOTEMPTY` bo oba katalogi nie są puste

**Root cause:** `fs/promises.rename()` nie nadpisuje niepustego katalogu na tym filesystemie (Docker/overlayfs). Komentarz w kodzie mówi _"On Linux, rename(2) atomically replaces the target directory"_ — ale Node.js `rename()` nie gwarantuje tego na wszystkich filesystemach.

**Impact:** Model AI nie jest zapisywany na dysk. Po restarcie serwera, model wraca do ostatniego udanego zapisu (Mar 23 16:34). Trenowanie od ostatniego zapisu jest tracone.

**Fix:** Przed `rename()`, wykonać `rm(dirPath, { recursive: true, force: true })` — ale to łamie atomic swap (ryzyko utraty danych przy crashu między rm a rename). Alternatywa: użyć `fs.rename()` z callbackiem zamiast `fs/promises`, lub sprawdzić filesystem capabilities.

---

### BUG-DYN-007: Self-Play Game Error (C++ Move 400)

**Severity: ŚREDNI** — self-play gry mogą się zawiesić  
**Lokalizacja:** `server/ai/trainer.js` → `cppFetch('/api/move')`

```
[Trainer cppFetch] POST http://localhost:8080/api/move → 400
[SelfPlay] Game error (1/3): C++ engine error: POST http://localhost:8080/api/move → 400
```

Self-play AI oblicza ruch, który C++ engine odrzuca jako nieprawidłowy (HTTP 400). Może to oznaczać:
- Board state niezsynchronizowany między Node.js a C++
- Model prediction zwraca ruch spoza legal moves (mimo walidacji)
- C++ engine stan planszy zmienił się między `getLegalMoves` a `move`

**Impact:** Self-play ma retry logic (3 próby), więc jednorazowy błąd jest tolerowany. Ale jeśli błędy są częste, gry mogą się niekończyć.

**Obserwacja:** Podczas testów, błąd wystąpił raz na ~20 sekund. Self-play kontynuował (1722 gier zakończone).

---

### BUG-DYN-008: Rapid WebSocket Crash (Potencjalny)

**Severity: NISKA** — wymaga więcej testów  
**Lokalizacja:** `server/index.js` (WebSocket handler)

Podczas wczesnych testów, Node.js server **zmarł** (proces zniknął z `ps`). Nie udało się ustalić bezpośredniej przyczyny — mogło to być spowodowane:
- Oversized captures array (50000 elementów) w `move` event
- Memory pressure z TensorFlow + self-play + WebSocket testing
- Timeout z zewnętrznego `timeout 15` command

**Impact:** Serwer wymaga restartu. Wszystkie połączenia WebSocket są zrywane.

**Reprodukcja:** Nie udało się reprodukować po restarcie serwera. Server działa stabilnie z nowymi testami.

---

### BUG-DYN-009: Trainer Self-Play draws=0

**Severity: KOSMETYCZNY / POTENCJALNY**  
**Lokalizacja:** `server/ai/trainer.js` → game-over handling

Po 1722 gier, `stats.draws === 0`. To jest statystycznie nieprawdopodobne — w warcabach, gry kończące się remisem są częste (szczególnie przy losowym exploration).

**Możliwe przyczyny:**
- Model jest na tyle silny że gry zawsze kończą się zwycięstwem
- Draw detection nie działa (C++ engine nie zgłasza `gameOver: true` dla remisów)
- `MAX_MOVES` limit jest zbyt wysoki (gry trwają zbyt długo by zakończyć się przed limitem)

**Impact:** Statystyki mogą być niedokładne. Jeśli draw detection jest zepsuta, model nie uczy się końcówek remisowych.

---

## Summary — Endpoint Security

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/game/state` | GET | ✅ 200 | Proxied to C++, works |
| `/api/game/reset` | POST | ✅ 200 | Proxied to C++, resets board |
| `/api/game/move` | POST | ⚠️ 404 | C++ nie ma tego endpointu — ruchy idą przez WebSocket/cppFetch |
| `/api/ai/predict` | POST | ✅ Validated | Odrzuca invalid input |
| `/api/ai/train` | POST | ✅ Validated | Auth check present |
| `/api/selfplay/*` | POST | ✅ Validated | Wymaga WebSocket |
| `WS: move` | - | ✅ Throttled+Validated | 50ms throttle, coord validation |
| `WS: getLegalMoves` | - | ✅ Throttled | 50ms throttle, coord validation |
| `WS: setParams` | - | ✅ Auth check | Tylko w aivai mode |

---

## Podsumowanie

| Bug | Severity | Status | Nowy? |
|-----|----------|--------|-------|
| isHumanPiece timing | Niska | Analiza kodu — potencjalny | Nie |
| getLegalMoves race | Niska | Potwierdzony w kodzie | Nie |
| Proxy body handling | Niska | Potwierdzony dynamicznie | Nie |
| King multi-capture anim | Niska | Edge case, captures prop chroni | Nie |
| Trainer duplicate game-over | Średnia | Potwierdzony kodem | Nie |
| **Model Auto-Save (ENOTEMPTY)** | **WAŻNA** | **Potwierdzony dynamicznie** | **TAK** |
| **Self-Play Move 400** | **Średnia** | **Potwierdzony w logach** | **TAK** |
| **Server Crash (potencjalny)** | **Niska** | **Nie zreprodukowany** | **TAK** |
| **draws=0** | **Kosmetyczny** | **Obserwacja** | **TAK** |

**Priorytet naprawy:** BUG-DYN-006 (model save) > BUG-DYN-007 (self-play 400) > reszta.
