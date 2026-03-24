# Hunter Alpha — Dynamic Bug Scan Report

**Date:** 2026-03-23 23:42 UTC
**Scope:** server/, engine/, config.js, client/
**Method:** Static code analysis (read-only scan, no runtime execution)

---

## Critical

### [BUG-DYN-001] Minimax ocenia z złej perspektywy w węzłach terminalnych
**Severity:** Krytyczny | **Lokalizacja:** `server/ai/minimax.js` — `minimax()` base case (linia ~210)

Gdy `depth === 0`, funkcja zwraca `evaluate(flatBoard, turn)`. Problem: `turn` zmienia się co poziom (`turn` / `-turn`), więc w liściach na parzystej głębokości ocena jest z perspektywy białego, a na nieparzystej — z perspektywy czarnego. Minimax zakłada stałą perspektywę (biały=max, czarny=min). Gdy gałąź minimize otrzymuje wynik z perspektywy czarnego (wysoki = dobre dla czarnego), minuje go — co oznacza, że czarny wybiera ruch **minimalizujący własną przewagę** zamiast minimalizujący przewagę białego.

**Fix:** Zamień `evaluate(flatBoard, turn)` na `evaluate(flatBoard, 1)` (zawsze z perspektywy białego).

```javascript
// before (bug)
return { score: evaluate(flatBoard, turn), move: null };

// after (fix)
return { score: evaluate(flatBoard, 1), move: null };
```

---

### [BUG-DYN-002] Race condition w rate limiterze — podwójna inkrementacja
**Severity:** Krytyczny | **Lokalizacja:** `server/index.js` — middleware rate limitu (~linia 53)

Operacja check-then-set na `Map` nie jest atomowa. Dwa równoległe żądania od tego samego IP mogą jednocześnie odczytać `entry` (oba widzą ten sam obiekt), oba zinkrementują `entry.count`, ale tylko drugi żąd zapisze nowy `entry` do mapy. Efekt: limit 120 req/min może przepuścić ~240 requestów w skrajnym przypadku wysokiej konkurencji.

```javascript
// current code — non-atomic read-modify-write
let entry = _rateLimitMap.get(ip);
if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
  entry = { windowStart: now, count: 0 };  // ← OVERWRITES concurrent entry
  _rateLimitMap.set(ip, entry);
}
entry.count++;
```

---

### [BUG-DYN-003] Self-play łapie 400 z legal-moves gdy gra kończy się między parallel fetchami
**Severity:** Wysoki | **Lokalizacja:** `server/ai/trainer.js` — `_playGame()`, parallel fetch block

`Promise.all([state, legal-moves])` — jeśli gra skończy się między tymi dwoma requestami, `/api/game/state` zwraca `gameOver: false`, ale `/api/legal-moves` zwraca 400/404 (brak ruchów dla zakończonej gry). Kod rzuca błąd, który trafia do handlera błędów i uruchamia recovery loop. Nie powoduje utraty danych, ale generuje niepotrzebne restarty silnika.

---

## High

### [BUG-DYN-004] Duplikacja kodu obsługi końca gry w _playGame()
**Severity:** Wysoki | **Lokalizacja:** `server/ai/trainer.js` — `_playGame()`, block "no legal moves" (~linia 360)

Gdy `legalMoves.length === 0` ale `gameOver === false`, kod powtarza całą logikę końca gry (stats, buffer, emit) zamiast ustawiać flagę i wchodzić w istniejący blok `if (gameOver)`. To ~30 linii zduplikowanego kodu. Każda zmiana w głównym bloku gameOver musi być ręcznie kopiowana do tego fallbacka — i już teraz różnią się (np. brak `avgTime` w emisji fallback).

---

### [BUG-DYN-005] turnToColor(0) zwraca 'white' — mylący default
**Severity:** Wysoki | **Lokalizacja:** `server/index.js` — `turnToColor()`

```javascript
const turnToColor = (turn) => {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return 'white'; // ← turn === 0 (draw) returns 'white'
};
```

Gdy `state.turn === 0` (remis), klient dostaje `turn: 'white'`. Chociaż `gameOver: true` jest ustawione, klient który ignoruje `gameOver` i sprawdza tylko `turn` może błędnie pokazać "tura białego" w zakończonej grze.

---

### [BUG-DYN-006] Brak walidacji tury po stronie serwera w PvP
**Severity:** Wysoki | **Lokalizacja:** `server/index.js` — `handleMove()`

Serwer nie sprawdza czy ruch pochodzi od gracza którego jest tura. W trybie PvP czarny może wykonać ruch w turze białego (i vice versa). Walidacja jest tylko po stronie klienta (blokada w `handleCellClick`), co jest niewystarczające — zmodyfikowany klient może wysłać dowolny ruch.

---

### [BUG-DYN-007] Auto-save nie resetuje timestampów po resetModel()
**Severity:** Wysoki | **Lokalizacja:** `server/index.js` — `_autoSaveInterval`

Po `resetModel()`, `_lastBufferSave` i `_lastModelSave` nie są zerowane. Jeśli od ostatniego zapisu minęło >2 min, pierwszy auto-save po resecie pominie zapis bufora (bo `now - _lastBufferSave >= 2min` jest prawdziwe). Świeżo zresetowany model/buffer może nie zostać zapisany na dysk do następnego cyklu 2-minutowego.

---

## Medium

### [BUG-DYN-008] PvAI: gracz kontroluje zawsze białe — brak opcji gry czarnymi
**Severity:** Średni | **Lokalizacja:** `client/src/App.jsx` — `handleCellClick()`

```javascript
const isHumanPiece = modeRef.current === 'pvai'
  ? piece && piece.color === 'white'   // ← hardcoded
  : piece && piece.color === turnRef.current;
```

Klient zawsze pozwala kontrolować białe pionki. Nie ma sposobu na grę czarnymi. Serwer nie ma też logiki zmiany stron.

---

### [BUG-DYN-009] Proxy handler może pisać na zamknięty response
**Severity:** Średni | **Lokalizacja:** `server/proxy.js` — `error` handler

```javascript
error: (err, _req, res) => {
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'C++ backend unavailable' }));
  }
}
```

Sprawdza `!res.headersSent`, ale nie sprawdza `res.writable` / `res.destroyed`. Jeśli response jest częściowo zapisany ale nie zamknięty, `res.writeHead()` rzuci wyjątek.

---

### [BUG-DYN-010] Brak timeout na WebSocket move handler
**Severity:** Średni | **Lokalizacja:** `server/index.js` — `handleMove()`, WS `move` event

Jeśli `cppFetch('/api/move')` w `handleMove()` wisi (silnik C++ nie odpowiada ale połączenie TCP żyje — nie `ECONNREFUSED`), Promise w `_moveQueue` nigdy się nie rozwiązuje. Kolejne ruchy od tego socketa kolejkują się i nigdy nie wykonują. Gracz widzi "zawieszony" interfejs bez feedbacku. Brak timeout na poziomie handlera — jest tylko na poziomie `cppFetch` (5s), ale to nie obejmuje wszystkich scenariuszy.

---

### [BUG-DYN-011] lossHistory growth — potencjalny memory leak w długich sesjach
**Severity:** Średni | **Lokalizacja:** `client/src/App.jsx` — `loss` event handler

```javascript
setLossHistory((prev) => {
  if (prev.length >= 1000) {
    return [...prev.slice(1), data.loss];  // ← creates new array every time
  }
  return [...prev, data.loss];
});
```

Po 1000 loss events, każde nowe zdarzenie tworzy nową tablicę 1000 elementów. W sesji self-play z 10k+ gier, to tysiące alokacji tablic. Canvas chart redrawuje za każdym razem. Rozwiązanie: ring buffer lub agresywniejszy cap.

---

### [BUG-DYN-012] DeepFreeze nie zamarza strategii minimax jeśli dodana dynamicznie
**Severity:** Średni | **Lokalizacja:** `config.js` — initialization loop

```javascript
for (const key of Object.keys(CONFIG.ai.strategies)) {
  deepFreeze(CONFIG.ai.strategies[key]);
}
```

Pętla iteruje po istniejących kluczach. Jeśli `minimax` strategia nie istniałaby w configu i byłaby dodana później (np. przez plugin), nie zostałaby zamrożona. W obecnej wersji `minimax` jest w configu, więc to nie jest aktywny bug — ale jest to luka w architekturze.

---

### [BUG-DYN-013] Model params sent from PvAI client are silently ignored
**Severity:** Średni | **Lokalizacja:** `client/src/App.jsx` — `handleApplyModelParams()`

Przycisk "Zastosuj zmiany" w ParamsPanel wysyła `setParams` niezależnie od trybu gry. Serwer odrzuca z błędem w PvAI (auth check), ale klient pokazuje opóźniony toast "✅ Model zresetowany" przez 500ms zanim przyjdzie error. Użytkownik widzi krótki flash sukcesu przed błędem — confusing UX, mimo że BUG-V3-002 próbuje to naprawić.

---

## Low

### [BUG-DYN-014] CSP pozwala ws: w produkcji gdy CSP_ALLOW_WS jest ustawione
**Severity:** Niski | **Lokalizacja:** `server/index.js` — CSP header

```javascript
const wsDirectives = process.env.CSP_ALLOW_WS === 'true' ? 'ws: wss:' : 'wss:';
```

Jeśli zmienna środowiskowa `CSP_ALLOW_WS` zostanie przypadkowo ustawiona na `'true'` w produkcji, CSP pozwoli na niezaszyfrowane połączenia WebSocket z dowolnego originu. Brak walidacji czy jesteśmy w środowisku dev czy prod.

---

### [BUG-DYN-015] generateLegalMoves — king capture na własną figurę nie jest blokowany w multi-capture
**Severity:** Niski | **Lokalizacja:** `server/ai/minimax.js` — `_extendCapture()`, king path

W multi-capture dla króla, po znalezieniu przeciwnika (`foundOpp = true`), kod sprawdza `alreadyCaptured` (czy ten przeciwnik już był zbity) ale nie sprawdza czy `oppR, oppC` to **ta sama figura** co w poprzednim skoku. Jeśli król skacze po tej samej diagonali w extended capture, `foundOpp` może być ustawione na już-zbitą figurę. W praktyce `alreadyCaptured` to chroni, ale logika jest odwrócona — łatwiej o błąd przy edycji.

---

### [BUG-DYN-016] Buffer sample() — brak zabezpieczenia przed n > count
**Severity:** Niski | **Lokalizacja:** `server/ai/buffer.js` — `sample()`

```javascript
sample(n) {
  if (this.count === 0) return [];
  const k = Math.min(n, this.count);  // ← zabezpieczone
  // ...
}
```

Jest zabezpieczone `Math.min`, ale jeśli ktoś wywoła `sample(Infinity)` lub `sample(-1)`, `Math.min` zwróci `count` lub `0`. To działa poprawnie, ale brak walidacji że `n` jest skończoną liczbą całkowitą > 0.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3     |
| High     | 4     |
| Medium   | 6     |
| Low      | 3     |
| **Total** | **16** |

**Najpilniejszy fix:** BUG-DYN-001 (minimax perspective) — powoduje suboptymalną grę minimax, szczególnie na głębokościach >1. Jeden znak (`turn` → `1`) naprawia buga.

**Drugie priority:** BUG-DYN-002 (rate limit race) i BUG-DYN-006 (brak walidacji tury w PvP) — oba to luki bezpieczeństwa.
