# Frontend Checker — Raport
**Date:** 2026-03-23  
**Scanner:** Jarvis Horner (hunter-sub-frontchecker)  
**Scope:** Client-side code (`/opt/Checkers_vibe/client/`)

---

## Summary

| Severity | Count |
|----------|-------|
| Krytyczny | 0 |
| Ważny | 3 |
| Kosmetyczny | 3 |

---

## 1. useDebouncedCallback — Inline, Not External Library ✅ OK

**Plik:** `client/src/components/ParamsPanel.jsx:5-11`

`useDebouncedCallback` jest zaimplementowane inline jako custom hook — NIE pochodzi z pakietu npm `debounce`. Implementacja jest poprawna:

```js
function useDebouncedCallback(fn, ms) {
  const timerRef = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;           // ← zawsze najnowsza wersja fn
  return useCallback((...args) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), ms);
  }, [ms]);
}
```

**Brakujące:** timer nie jest czyszczony przy unmount komponentu. Jeśli komponent zostanie odmontowany w trakcie oczekiwania na debounce (300ms), timeout odpali `fnRef.current(...)` na odmontowanym komponencie.

### FBUG-001: Debounce timer nie czyszczony przy unmount ParamsPanel
- **Severity:** ważny
- **Status:** ✅ ALREADY FIXED (było w HEAD przed skanowaniem)
- **Plik:** `client/src/components/ParamsPanel.jsx:5-11`
- **Opis:** `useDebouncedCallback` nie czyści `timerRef.current` w cleanup function useEffect. Po odmontowaniu ParamsPanel (np. przejście do menu), pending timeout może wywołać `onParamsChange` na odmontowanym komponencie. W praktyce mały impact bo `onParamsChange` w App.jsx nie zmienia state jeśli socket nie istnieje, ale jest to violation of React cleanup rules.
- **Fix:** Dodać cleanup:
  ```js
  function useDebouncedCallback(fn, ms) {
    const timerRef = useRef(null);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    useEffect(() => () => clearTimeout(timerRef.current), []);
    return useCallback((...args) => { ... }, [ms]);
  }
  ```

---

## 2. WebSocket Connection Handling

### FBUG-002: Event listeners nie są rejestrowane przy reconnect — potencjalny stale state
- **Severity:** ważny
- **Plik:** `client/src/App.jsx:58-140`
- **Opis:** Wszystkie event listenery (`s.on('state', ...)`, `s.on('legalMoves', ...)`, `s.on('gameOver', ...)`, etc.) są rejestrowane raz w `useEffect([], [])`. Socket.io-client automatycznie re-registruje listenery na reconnect (bo to ten sam socket instance), więc **to NIE jest bug** — ale:
  - Brak explicit cleanup (`s.off(...)`) w return useEffect. Socket.io robi to automatycznie przy `s.disconnect()`, ale lepszą praktyką jest jawne odłączenie.
  - Komunikat "Brak połączenia" w menu nie informuje o liczbie prób reconnect (`reconnectAttempts` jest trackowany ale nie wyświetlany).

### FBUG-003: Race condition — reconnect emit 'startGame' nie sprawdza aktualnego mode
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx:80-84`
- **Opis:** Na reconnect handler emisuje `'startGame'` jeśli `modeRef.current === 'aivai'`. Ale między disconnect a reconnect użytkownik mógł zmienić mode na 'pvai' lub 'menu' — wtedy niepotrzebnie wysyła startGame.
  ```js
  s.on('reconnect', () => {
    setConnected(true);
    setReconnectAttempts(0);
    if (modeRef.current === 'aivai') {
      s.emit('startGame', { mode: 'aivai' });
    }
  });
  ```
  W praktyce mały window (1-10s reconnect delay), mało prawdopodobne. Ale lepszym podejściem byłoby sprawdzenie czy server już ma aktywną grę.

---

## 3. React Rendering

### FBUG-004: Imperatywny kod animacji w body render Board.jsx — violation of render purity
- **Severity:** ważny
- **Status:** ✅ FIXED (commit f738ee4)
- **Plik:** `client/src/components/Board.jsx:116-160`
- **Opis:** Duży blok kodu w body funkcji render Board wykonuje:
  1. Mutację `animFromRef.current` (side effect)
  2. Mutację `animFlagRef.current` (side effect)
  3. `requestAnimationFrame(animate)` (side effect)
  4. Mutację `prevBoardRef.current` / `animPrevBoardRef.current` (side effect)

  To wszystko dzieje się **synchronicznie w trakcie renderu**, co narusza zasadę czystości renderu React. React 18 Strict Mode może podwójnie wywołać render, co spowoduje podwójne `requestAnimationFrame` (chociaż `animFlagRef.current` flag zapobiega temu w praktyce).

  Kod powinien być w `useEffect` lub `useLayoutEffect`.
- **Fix:** Przenieść całą logikę detekcji zmian board + scheduling RAF do `useEffect`:
  ```js
  useEffect(() => {
    // ... detection + RAF scheduling logic
  }, [board]);
  ```

### FBUG-005: handleApplyModelParams zależy od modelParams — zbędne re-rendery ParamsPanel
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx:207-210`
- **Opis:** `handleApplyModelParams` ma `[modelParams, showToast]` w dependency array. Kiedy użytkownik przesuwa suwak architektury/szkolenia, `modelParams` się zmienia → nowy callback → ParamsPanel re-render (bo props `onApplyModelParams` changed). W praktyce bez znaczenia bo ParamsPanel re-renderuje się i tak (inne propsy się zmieniają), ale `modelParams` mógłby być ref-em:
  ```js
  const modelParamsRef = useRef(modelParams);
  modelParamsRef.current = modelParams;
  const handleApplyModelParams = useCallback(() => {
    socketRef.current?.emit('setParams', { ...modelParamsRef.current });
    showToast('✅ Model zresetowany, szkolenie od nowa');
  }, [showToast]);
  ```

---

## 4. ParamsPanel + Debounce

### FBUG-006: useEffect bez dependency array w App.jsx — runs every render
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx:67-74`
- **Opis:** `useEffect` bez `[]` synchronizuje ref-y z state na każdy render:
  ```js
  useEffect(() => {
    boardRef.current = board;
    turnRef.current = turn;
    // ...
  });
  ```
  To jest intentional pattern (refs muszą być aktualne dla stabilnych callbacków), ale React 18 Strict Mode wywoła to 2x. W praktyce nie powoduje buga bo operacja jest idempotentna.

### ParamsPanel debounce — Poprawny ✅
Debounce w ParamsPanel działa poprawnie:
- Local state (`localWhiteEps`, `localBlackEps`) daje natychmiastowy feedback wizualny
- Debounced callback (300ms) wysyła na server po zakończeniu drag
- `useEffect` synchronizuje local state z props po debounced update
- Brak infinite loops

---

## 5. Memory Leak Check

| Mechanism | Cleanup | Status |
|-----------|---------|--------|
| `socket.io` (useEffect) | `s.disconnect()` ✅ | OK |
| `requestAnimationFrame` (Board) | `cancelAnimationFrame` in useEffect cleanup ✅ | OK |
| `setTimeout` timers (Board multi-capture) | `timersRef.current.forEach(clearTimeout)` ✅ | OK |
| `setInterval` (GameTimer) | `clearInterval` in useEffect cleanup ✅ | OK |
| Debounce timer (ParamsPanel) | **NOT cleaned up** ❌ | FBUG-001 |
| `setTimeout` in `showToast` (App) | **NOT cleaned up** ⚠️ | Minor — 3s timeout, low risk |

### FBUG-007: showToast setTimeout nie jest czyszczony przy unmount
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx:196-199`
- **Opis:** `showToast` używa `setTimeout(() => setToast(null), duration)` bez cleanup. Po odmontowaniu App, timeout wywoła `setToast(null)` na odmontowanym komponencie.
- **Fix:** Użyć cleanup ref lub zignorować (React 18+ nie warnuje o tym w production).

---

## Positive Observations

- **React.memo** z custom `areEqual` na Board — dobra optymalizacja
- **Ref pattern** dla stabilnych callbacków (boardRef, turnRef, etc.) — unika zbędnych re-renderów
- **O(1) Set lookup** dla legal moves zamiast `.some()` — optymalizacja wydajności
- **Inline debounce** zamiast external dependency — zero dependency, proste
- **ErrorBoundary** — gracefully obsługuje crash-e
- **Reconnection config** z `reconnectionAttempts: Infinity` — robust
- **Canvas loss chart** — czyszczony i redrawnowany na update

---

## No Critical Bugs Found

Frontend jest w dobrym stanie. Żaden z powyższych bugów nie powoduje crash-u, data corruption, ani poważnego UX problemu. Najważniejszy to FBUG-004 (imperatywny kod w render) który może powodować subtelne problemy z React Strict Mode.
