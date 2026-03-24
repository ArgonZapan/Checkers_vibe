# Hunter Alpha — Frontend Security & Quality Report

**Skan:** `/opt/Checkers_vibe/client/`  
**Data:** 2026-03-23  
**Zakres:** XSS, walidacja formularzy, accessibility, performance, cross-browser, responsywność

---

## 1. XSS Vulnerabilities

### ✅ BRAK krytycznych podatności

| Wzorzec | Źródła JSX | dist/ (bundle) | Ocena |
|---|---|---|---|
| `innerHTML` | **0** w src/ | Występuje tylko w React internals (vendor bundle) | ✅ OK |
| `eval()` | **0** | **0** | ✅ OK |
| `document.write` | **0** | **0** | ✅ OK |
| `dangerouslySetInnerHTML` | **0** | Tylko w React internals | ✅ OK |

**Wnioski:** Kod źródłowy nie korzysta z niebezpiecznych API do wstrzykiwania HTML. Wszystkie dane renderowane są przez React JSX z automatyczną escapacją.

### ⚠️ Uwaga (niskie ryzyko)
- Socket.io odbiera dane z serwera (`data.board`, `data.turn`, `data.winner`, `data.message`) — dane te trafiają do stanu React i renderowane są przez JSX, co jest bezpieczne.
- `console.warn('[Server error]', data?.message)` — loguje na konsolę, nie renderuje w DOM. OK.

---

## 2. Walidacja Formularzy

### ⚠️ BRAK walidacji na wejściu użytkownika

Brak formularzy HTML `<form>` w aplikacji — wszystkie interakcje opierają się na:
- **Przyciskach** (tryby gry, restart, self-play)
- **Sliderach `<input type="range">`** z `min/max/step` — walidacja zakresu jest natywna ✅
- **Select `<select>`** — ograniczone do predefiniowanych opcji ✅

**Problem:**
- **Brak walidacji `modelParams` po stronie klienta** przed wysłaniem przez `socket.emit('setParams', ...)`. Użytkownik nie może wstrzyknąć wartości poza zakres sliderów, ale serwer powinien też weryfikować (defense in depth).
- **Brak feedbacku przy nieudanych operacjach** — `handleSpeed()` pokazuje toast tylko w trybie AI vs AI, ale w PvAI przyciski prędkości są ukryte, więc to nie jest problem w praktyce.

---

## 3. Accessibility Issues

### ✅ Dobra podstawa — ale z lukami

**Co jest dobrze:**
- `aria-live="polite"` na statusie połączenia (App.jsx:458) ✅
- `aria-live="polite"` + `role="status"` na kontrolkach gry ✅
- `role="alert"` + `aria-live="assertive"` na toastach ✅
- `role="dialog"` + `aria-modal="true"` na overlay'u końca gry ✅
- `aria-label` na pionkach, komórkach planszy, przyciskach ✅
- `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` w ParamsPanel ✅
- `.sr-only` class dla screen readerów ✅
- `aria-pressed` na przyciskach prędkości ✅
- `onKeyDown` (Enter/Space) na elementach SVG clickable ✅
- `tabIndex={0}` na dark cells i pieces ✅
- `<noscript>` fallback ✅
- Focus-visible outline na interaktywnych elementach ✅

### ⚠️ Problemy

| # | Problem | Plik | Linia | Severity |
|---|---------|------|-------|---|
| A1 | **Brak `aria-controls` matching `id`** — tab buttons wskazują `aria-controls="panel-white"` etc., ale panele nie mają odpowiadających `id` | ParamsPanel.jsx | 248, 259, 270 | Średni |
| A2 | **SVG cells nie mają `aria-label` po polsku** — `cellLabel` buduje mieszany polsko-angielski opis: `a3, biały pionek` — OK, ale pieces mają angielskie `aria-label`: "White king at a3" | Board.jsx | 329 | Niski |
| A3 | **Tab trap w game-over overlay** — custom implementation z `onKeyDown` zamiast użycia `focus-trap` lub `inert` — brak obsługi Escape do zamknięcia | Board.jsx | 428-445 | Średni |
| A4 | **Brak `aria-label` na board container** — SVG ma `role="img"` + `aria-label`, ale otaczający `div.board-container` nie ma roli | Board.jsx | 384 | Niski |
| A5 | **Turn indicator** — `<span>` z klasą CSS bez `aria-hidden="true"` na dekoracyjnym elemencie wizualnym (kółko) | GameControls.jsx | 33 | Niski |
| A6 | **Brak skip-link** do pominięcia nagłówka i przejścia do gry | index.html | — | Niski |
| A7 | **Toast nie ma mechanizmu dismiss** — brak przycisku zamknięcia, timeout-only | App.jsx | 534 | Niski |

---

## 4. Performance

### ✅ Dobre praktyki obecne
- `React.memo` z custom `areEqual` na Board (Board.jsx:455)
- `useMemo` na cells/pieces (Board.jsx:268)
- `useCallback` na handlerach (App.jsx)
- `useRef` dla stabilnych referencji unikających re-renderów (App.jsx:77-82)
- `Set` zamiast `Array.some()` do O(1) lookup legalnych ruchów (Board.jsx:273)
- Debounced resize handler (Dashboard.jsx:88)

### ⚠️ Potencjalne problemy

| # | Problem | Plik | Severity |
|---|---------|------|---|
| P1 | **Loss history rośnie do 1000 elementów** bez limitu kompresji — `lossHistory` w stanie React, każde nowe `loss` event kopiuje tablicę. Przy 1000 elementów to ~8KB per update, z potencjalnie wieloma update'ami na sekundę. Canvas redraw przy każdej zmianie. | App.jsx:195 | Średni |
| P2 | **Move history nie jest throttlowane** — każdy ruch powoduje `setMoveHistory` z kopią tablicy + slice(-40). Przy szybkim AI vs AI to dużo re-renderów. | App.jsx:146 | Niski |
| P3 | **`forceUpdate` w Board** — celowe dla animacji, ale może powodować cascading re-renderów podczas animacji | Board.jsx:15 | Niski |
| P4 | **Board `areEqual` nie porównuje głęboko `legalMoves`** — porównuje referencję (`!==`), co jest OK bo React state, ale `captures?.length` jest porównywane tylko po długości, nie zawartości | Board.jsx:467 | Niski |
| P5 | **Brak `React.memo` na GameControls** — re-renderuje się przy każdej zmianie `turn` mimo że większość props się nie zmienia | GameControls.jsx | Niski |
| P6 | **Dashboard canvas redraw** — `useEffect` z pustą tablicą deps + `lossRef` do odczytu, ale drugi `useEffect` z `[lossHistory]` rysuje ponownie. Przy szybkich update'ach to redundantne redraws. | Dashboard.jsx:83-96 | Niski |

### ✅ Brak memory leaks

| Mechanizm | Cleanup | Status |
|---|---|---|
| Socket.io | `s.disconnect()` w cleanup useEffect | ✅ |
| Toast timers | `clearTimeout(toastTimerRef.current)` | ✅ |
| Pending toast | `clearTimeout(pendingModelParamsToast.current)` | ✅ |
| Board animation RAF | `cancelAnimationFrame(rafIdRef.current)` | ✅ |
| Board multi-capture timers | `timersRef.current.forEach(clearTimeout)` | ✅ |
| Dashboard resize | `removeEventListener` + `clearTimeout` | ✅ |
| GameTimer interval | `clearInterval(intervalRef.current)` | ✅ |

---

## 5. Cross-Browser Compatibility

### ⚠️ Potencjalne problemy

| # | Problem | Plik | Affected |
|---|---------|------|---|
| C1 | **`Array.from()` z `{ length: 8 }`** — IE11 nie wspiera, ale Vite transpiluje. OK dla nowoczesnych przeglądarek. | App.jsx:12 | — |
| C2 | **`performance.now()`** — Board.jsx:183 — wsparcie od IE10+, OK | Board.jsx | — |
| C3 | **`requestAnimationFrame`** — wsparcie od IE10+, OK | Board.jsx | — |
| C4 | **SVG `pointerEvents="visible"`** — nie jest standardową wartością CSS `pointer-events`. Działa w Chrome/Firefox/Safari, ale może być problematyczne w starszych wersjach. | Board.jsx:288 | Edge cases |
| C5 | **CSS `accent-color`** — input range (index.css:163) — wsparcie od Chrome 93+, Firefox 92+, brak Safari < 15.4 | index.css | Safari < 15.4 |
| C6 | **CSS Custom Properties (`--var`)** — szerokie wsparcie, brak IE11 | index.css | IE11 |
| C7 | **CSS `gap` we flexbox** — index.css:60 — wsparcie od Chrome 84+, Firefox 63+, Safari 14.1+ | index.css | Safari < 14.1 |
| C8 | **`Object.fromEntries`** — brak w IE11, ale Vite/Babel transpiluje | — | — |
| C9 | **Optional chaining `?.`** — brak w IE11, Vite transpiluje | — | — |
| C10 | **`String.prototype.replaceAll`** — nie znaleziono w src, OK | — | — |

**Podsumowanie:** Vite + React zapewnia dobrą transpilację. Główne ryzyko to `accent-color` na Safari i `gap` na starszych Safari.

---

## 6. Responsywność

### ✅ Obecne breakpointy

```css
@media (max-width: 768px)  — tablet
@media (max-width: 480px)  — mobile
```

| Element | Zachowanie | Ocena |
|---|---|---|
| `.game-layout` | `flex-wrap: wrap` → `flex-direction: column` @768px | ✅ |
| `.board-svg` | `width: 100%; max-width: 480px` | ✅ |
| `.game-side` | `min-width: 280px; max-width: 320px` → `100%` @768px | ✅ |
| Menu buttons | `width: 100%` @768px | ✅ |
| Header | Font size reduction @480px | ✅ |

### ⚠️ Problemy

| # | Problem | Severity |
|---|---------|---|
| R1 | **Brak breakpointu poniżej 320px** — bardzo małe ekrany (stare telefony) mogą mieć overflow | Niski |
| R2 | **`.game-side` ma `min-width: 280px`** — na ekranach < 320px to powoduje horizontal scroll | Średni |
| R3 | **Slider inputy** nie mają specjalnego stylowania na mobile — mogą być trudne w obsłudze dotykiem (mały target area) | Niski |
| R4 | **Board SVG** nie skaluje się proporcjonalnie poniżej ~280px width — pionki mogą być za małe | Niski |
| R5 | **Brak `touch-action` CSS** na SVG board — może kolidować z gestami przeglądarki na mobile | Niski |

---

## Podsumowanie

| Kategoria | Ocena |
|---|---|
| **XSS** | ✅ Czysty — brak innerHTML/eval/document.write w src |
| **Walidacja formularzy** | ✅ Brak formularzy HTML, slidery z min/max |
| **Accessibility** | ⚠️ Dobra baza z lukami (A1, A3 — tab IDs, escape handling) |
| **Performance** | ✅ Dobre praktyki, brak memory leaks, drobne optymalizacje możliwe (P1) |
| **Cross-browser** | ⚠️ Nowoczesne przeglądarki OK, Safari <15.4 potencjalne problemy z accent-color |
| **Responsywność** | ✅ Dobre breakpointy, drobne problemy na bardzo małych ekranach |

### Priorytetowe naprawy:
1. **A1** — Dodaj `id` do paneli tab content (`panel-white`, `panel-black`, `panel-general`)
2. **A3** — Dodaj obsługę Escape w game-over overlay
3. **P1** — Rozważ ograniczenie lossHistory do 200 zamiast 1000 lub kompresję danych
4. **R2** — Zmień `min-width` na `.game-side` na `min(280px, 100%)`
