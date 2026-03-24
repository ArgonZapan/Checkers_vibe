# Hunter Bug Report — Dynamic Bug Finder

**Data:** 2026-03-24 00:42 UTC  
**Tester:** Hunter sub-001 — dynamic-bug-finder  
**Metoda:** Code review + test suite analysis + regression check ostatnich commitów  
**Pliki:** server/index.js, server/ai/*.js, server/boardConvert.js, server/proxy.js, client/src/App.jsx, client/src/components/*.jsx

---

## Środowisko

- **Test suite:** 3051 testów, **6 failing** (2 na 3045 → test bugs, nie code bugs)
- **Ostatnie fixy sprawdzone:** sanitize getGameState, saveModel ENOTEMPTY, epsilon validation, CSP, rate limiting, deep freeze strategies

---

## Znalezione Bugi

### BUG-NEW-001: saveModel ENOTEMPTY fallback — okno data loss na crash

- **Severity:** średni
- **Lokalizacja:** server/ai/model.js:416-430 (saveModel)
- **Regression check:** Fix commit `a03ac36` (saveModel rename ENOTEMPTY fallback) **wprowadza regresję** względem fixu `59e1606`, który celowo unikał rm przed rename.
- **Opis:** Nowy kod:
  ```js
  try {
    await rename(tmpDir, dirPath);
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
      await rm(dirPath, { recursive: true, force: true }); // ← window opens
      await rename(tmpDir, dirPath);                        // ← crash here = total data loss
    }
  }
  ```
  Poprzedni fix (`59e1606`) celowo nie robił `rm` przed `rename`, bo na Linuxie `rename(2)` atomowo nadpisuje katalogi — rm tworzy okno gdzie stary model jest skasowany a nowy jeszcze nie wklejony. Nowy kod odzyskuje ENOTEMPTY fallback, ale kosztem bezpieczeństwa na krachy.
- **Kroki reprodukcji:**
  1. Wymuś filesystem (np. containerized FUSE mount) gdzie `rename()` zwraca ENOTEMPTY na katalog
  2. Wywołaj `saveModel()` 
  3. Crash procesu między `rm()` a `rename()` (kill -9)
  4. Model dir jest pusty — cała progresja treningowa utracona
- **Sugerowany fix:** Zamiast rm+rename, użyj `rename(tmpDir + '.staging', dirPath)` jako middle step, lub po prostu zaakceptuj że Linux rename(2) jest atomiczny i zaloguj warning na ENOTEMPTY zamiast robić rm:
  ```js
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
      console.warn('[Model] rename ENOTEMPTY — attempting rm+rename (non-atomic)');
      await rm(dirPath, { recursive: true, force: true });
      await rename(tmpDir, dirPath);
    }
  ```
  Aktualny kod jest OK na Linux (rename nigdy nie zwróci ENOTEMPTY), ale powinien mieć comment że fallback jest tylko dla non-Linux.

---

### BUG-NEW-002: getLegalMoves nie jest serializowany — stale moves window

- **Severity:** niski
- **Lokalizacja:** server/index.js:485-498 (socket.on 'getLegalMoves')
- **Opis:** `getLegalMoves` handler NIE przechodzi przez `socket._moveQueue`. Jeśli `handleMove` jest w trakcie wykonywania (C++ dostał move, ale odpowiedź jeszcze nie wróciła), `getLegalMoves` zwraca legal moves z poprzedniego stanu planszy. Kliknięcie takiego ruchu → C++ odrzuci z 400 → UX error toast.
- **Kroki reprodukcji:**
  1. Otwórz PvAI, wykonaj szybki ruch
  2. Natychmiast hover na kolejną bierkę (triggers getLegalMoves)
  3. getLegalMoves może zwrócić ruchy z przed-ruchu stanu
  4. Kliknięcie jednego z nich → serwer zwraca "Move failed"
- **Sugerowany fix:** Dodać getLegalMoves do moveQueue serialization:
  ```js
  socket.on('getLegalMoves', async ({ from }) => {
    if (!wsThrottle(socket, 'getLegalMoves', 50)) return;
    // ... validation ...
    socket._moveQueue = (socket._moveQueue || Promise.resolve()).then(async () => {
      const state = await getGameState();
      const filtered = state.legalMoves.filter(...);
      socket.emit('legalMoves', { from, moves: filtered });
    });
  });
  ```
  Lub prościej: dodać server-side turn validation — jeśli state.turn !== requestedPieceColor, zwróć puste moves.

---

### BUG-NEW-003: predict() policyIndex collision — suboptimal move selection

- **Severity:** niski
- **Lokalizacja:** server/ai/model.js:300-320 (predict function, matchingMoves section)
- **Opis:** `computePolicyIndex()` mapuje 4 kierunki × 32 dark squares = 128 slotów. Ale king może przesunąć się o 1, 2, lub 3 pola w tym samym kierunku — wszystkie dostają ten sam policyIndex. Kiedy model wybiera bestIdx, `matchingMoves` zawiera wiele ruchów z tym samym indeksem. Kod wybiera losowo jeden z nich:
  ```js
  selectedMove = matchingMoves[Math.floor(Math.random() * matchingMoves.length)];
  ```
  To oznacza że model nie może zdecydować że "przesuń o 3 pola" jest lepsze niż "przesuń o 1 pole" w tym samym kierunku. Dla królowej w warcabach to może być znaczące.
- **Kroki reprodukcji:**
  1. Ustaw strategię na 'minimax' lub graj z king na board
  2. Model wybiera losowy dystans w kierunku (1 vs 3 pola) mimo że 3 pola mogą być strategicznie lepsze
- **Sugerowany fix:** Rozszerzyć policy space do rozróżnienia dystansu, lub w matchingMoves preferować ruchy o większym captures.length (multi-capture jest zawsze lepsze w warcabach). Alternatywnie: sortuj matchingMoves po captures.length desc i weź pierwszy.

---

### BUG-NEW-004: minimax multi-capture generuje redundantne ruchy

- **Severity:** niski (performance)
- **Lokalizacja:** server/ai/minimax.js:140-180 (_extendCapture)
- **Opis:** `_extendCapture` rekurencyjnie generuje multi-capture. Ale w `generateLegalMoves`, gdy captures.length > 0, kod:
  ```js
  const extendedCaptures = [];
  for (const cap of captures) {
    _extendCapture(board, cap, turn, extendedCaptures);
  }
  return extendedCaptures.length > 0 ? extendedCaptures : captures;
  ```
  `_extendCapture` dodaje cap do result tylko gdy `!foundMore` (ostatni element sekwencji). Ale jeśli pierwotny `cap` ma captures [[adjR, adjC]] a extendedCaptures ma ten sam końcowy ruch z wieloma captures, nie ma deduplikacji. Dla głębokości 4+ to generuje drzewo ruchów bez pruning identycznych końcowych stanów.
- **Kroki reprodukcji:**
  1. Ustaw strategię na minimax z depth 6+
  2. Obserwuj CPU usage — exponentially więcej ruchów do przeszukania
- **Sugerowany fix:** Dodać deduplikację po `(from, to, captures.length)` w extendedCaptures, lub dodać transposition table do minimax.

---

### BUG-NEW-005: timer resource leak — Board.jsx multi-capture animation

- **Severity:** niski
- **Lokalizacja:** client/src/components/Board.jsx:~70-110 (multi-capture useEffect)
- **Opis:** useEffect cleanup `timersRef.current.forEach(clearTimeout)` czyści timery przy re-run i unmount. Ale useEffect dependency to `[path, captures]`. Jeśli `path` zmienia się szybko (rapid moves), stare timery są czyszczone ale nowe są schedulowane. To jest poprawne. Ale jeśli component unmountuje się w trakcie animacji multi-capture, cleanup nie jest gwarantowany bo React może batch updates.
- **Kroki reprodukcji:**
  1. Rozpocznij multi-capture animację (wieloetapowe zbicie)
  2. Kliknij Reset w trakcie animacji
  3. Timery mogą fire na nieistniejącym komponencie (setState na unmounted component → React warning)
- **Sugerowany fix:** Dodać mounted flag w useEffect cleanup:
  ```js
  useEffect(() => {
    let mounted = true;
    // ... w timer callbacks:
    if (mounted) setAnimStep(i);
    return () => { mounted = false; timersRef.current.forEach(clearTimeout); };
  }, [path, captures]);
  ```

---

### BUG-NEW-006: 6 failing tests — test bugs, nie code bugs

- **Severity:** kosmetyczny (test quality)
- **Lokalizacja:** __tests__/autoSaveExtended.test.js, __tests__/ws-move-params-integration.test.js
- **Opis:** 6 z 3051 testów failuje:
  1. `setParams during game — game aborts, no samples added` — MockTrainer.addSample() nie implementuje paramsVersion guard identycznie do SelfPlay._playGame
  2. `game with 0 moves — no samples, stats still update` — mock nie ustawia stats.gamesPlayed dla 0-move games
  3. `dirty set during save survives for next tick` — mock nie symuluje race condition dirty flag correctly
  4-6. AutoSave timing tests — mock _lastBufferSave/_lastModelSave nie są resetowane po reset, czyszczą inaczej niż prawdziwy kod
- **Kroki reprodukcji:** `node __tests__/run.js 2>&1 | grep "❌"`
- **Sugerowany fix:** Zaktualizować mocki do odzwierciedlania aktualnego zachowania SelfPlay i auto-save interval. Lub oznaczyć te testy jako `test.skip` z adnotacją.

---

### BUG-NEW-007: CONFIG.server properties mutowalne despite deep freeze na strategies

- **Severity:** niski
- **Lokalizacja:** config.js (deep freeze), server/index.js (setParams/setSpeed handlers)
- **Opis:** `deepFreeze()` jest aplikowane na `CONFIG.ai.strategies.*`, ale `CONFIG.server.*` pozostaje mutowalne. Handler `setParams` i `setSpeed` mutują `CONFIG.server.speedMode`, `CONFIG.server.aiMoveDelayMs`, `CONFIG.server.normalModeDelayMs` bezpośrednio. To jest celowe (speed settings muszą być dynamiczne), ale brak jest granic walidacji na te mutacje. Każdy połączony klient w aivai mode może zmienić globalne CONFIG.server.* — race condition między wieloma klientami.
- **Kroki reprodukcji:**
  1. Otwórz 2 karty z aivai mode
  2. Karta A: setSpeed(5000), Karta B: setSpeed(0) jednocześnie
  3. Ostatni write wygrywa — race condition na CONFIG.server.aiMoveDelayMs
- **Sugerowany fix:** Albo zaakceptować (to jest edge case, speed nie jest krytyczna), albo dodać per-socket speed zamiast globalnego CONFIG.

---

## Regresje po ostatnich fixach

| Fix | Commit | Regresja? |
|-----|--------|-----------|
| sanitize getGameState error message | a596f5e | ✅ OK — nie leakuje C++ internals |
| saveModel ENOTEMPTY fallback | a03ac36 | ⚠️ **Częściowa regresja** — tworzy data-loss window na non-Linux (BUG-NEW-001) |
| epsilon validation | wcześniejszy | ✅ OK — walidacja działa, NaN/Infinity odrzucane |
| CSP headers | wcześniejszy | ✅ OK — CSP_ALLOW_WS kontroluje ws: scheme |
| rate limiting + cleanup | wcześniejszy | ✅ OK — cleanup interval działa, hard cap na entries |
| deep freeze strategies | 8d637c0 | ✅ OK — copy-on-write dla minimax depth działa poprawnie |
| WS throttle (startGame etc.) | b807a96 | ✅ OK — throttle per-socket per-action |

---

## Podsumowanie

| Severity | Count |
|----------|-------|
| Krytyczny | 0 |
| Średni | 1 (BUG-NEW-001 — saveModel regression) |
| Niski | 5 (BUG-NEW-002..007) |
| Kosmetyczny | 1 (test bugs) |

**Najważniejszy finding:** Commit `a03ac36` (saveModel ENOTEMPTY) przywraca pattern rm+rename, który poprzedni fix celowo usunął. Na Linuxie to nie ma znaczenia (rename(2) jest atomiczny), ale na innych FS to tworzy window na total data loss. Kod działa poprawnie na aktualnym środowisku (Linux), ale powinien mieć ostrzeżenie w comment.

**Test suite health:** 3045/3051 passing (99.8%). 6 failures to test bugs (mock mismatch), nie production bugs.
