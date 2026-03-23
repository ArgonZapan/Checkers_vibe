# Frontend Audit Report — Checkers_vibe
**Date:** 2026-03-23 | **Hunter:** hunter-sub-frontend

## Summary
- **Critical:** 0
- **Important:** 7
- **Cosmetic:** 8
- **Total issues:** 15

---

### FE-001: Brak `lang` atrybutu w `<html>`
- **Severity:** ważny
- **Plik:** `client/index.html` linia 2
- **Opis:** Tag `<html>` nie ma atrybutu `lang`. Screen readers nie wiedzą w jakim języku jest strona.
- **Fix:** `<html lang="pl">`

### FE-002: Brak `aria-live` dla toast notifications
- **Severity:** ważny
- **Plik:** `client/src/App.jsx` linia ~293 (toast render)
- **Opis:** Toast notifications pojawiają się dynamicznie ale nie ogłaszają zmiany screen readerom. Brak `role="alert"` lub `aria-live="polite"`.
- **Fix:** `<div className="toast-notification" role="alert" aria-live="assertive">`

### FE-003: Przyciski szybkości bez `aria-pressed`
- **Severity:** ważny
- **Plik:** `client/src/App.jsx` linie ~170-172, `GameControls.jsx` linie ~41-43
- **Opis:** Przyciski wyboru prędkości (⚡/🏃/🐢) działają jak toggle ale nie mają `aria-pressed` — screen reader nie wie który jest aktywny.
- **Fix:** `aria-pressed={speed === 0}` na każdym przycisku.

### FE-004: Params tabs bez `role="tablist"` i `aria-selected`
- **Severity:** ważny
- **Plik:** `client/src/components/ParamsPanel.jsx` linie ~204-218
- **Opis:** Kontener tabs nie ma `role="tablist"`, przyciski nie mają `role="tab"` + `aria-selected`, a panele nie mają `role="tabpanel"`. Brak też klawiszowej nawigacji (strzałki) między tabami.
- **Fix:** Dodaj role i aria attributes + obsługę klawiatury.

### FE-005: Game over overlay bez `role="dialog"` i focus trap
- **Severity:** ważny
- **Plik:** `client/src/components/Board.jsx` linie ~286-295
- **Opis:** Overlay końca gry nie ma `role="dialog"`, `aria-modal="true"` ani `aria-label`. Focus nie jest przenoszony na przycisk Reset. Użytkownik klawiatury może utknąć pod overlayem.
- **Fix:** Dodaj `role="dialog"` i auto-focus na przycisk.

### FE-006: SVG board — brak semantycznej grupy cell labels
- **Severity:** ważny
- **Plik:** `client/src/components/Board.jsx` linie ~170+
- **Opis:** Każda komórka ma `aria-label` (np. "a8") ale brak kontekstu — screen reader powie "button a8" bez informacji czy jest tam pionek. Pionki mają aria-label z kolor/king info ale to osobne elementy.
- **Fix:** Cell aria-label powinien zawierać info o pionku: `"a8, white piece"` zamiast tylko `"a8"`.

### FE-007: SVG width/height stałe — brak responsywności na very small screens
- **Severity:** ważny
- **Plik:** `client/src/components/Board.jsx` + `client/src/index.css`
- **Opis:** Board SVG ma `width={BOARD_SIZE}` (stała 480px) ale CSS ustawia `max-width: 480px` i `width: 100%`. Na ekranach < 320px (stare telefony) kontrolki mogą się łamać.
- **Fix:** Dodaj `@media (max-width: 480px)` z mniejszym paddingiem.

### FE-008: inline styles w ErrorBoundary i menu
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/ErrorBoundary.jsx` linie 16-35, `client/src/App.jsx` linie ~166-172
- **Opis:** Style inline w ErrorBoundary i przyciski menu z `style={{ fontSize: ... }}` — powinno być w CSS dla konsystencji i maintainability.
- **Fix:** Przenieś do klas CSS.

### FE-009: Brak `aria-label` na przyciskach restartu i self-play
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/ParamsPanel.jsx` linie ~246-268
- **Opis:** Przyciski "Restart ⚪", "Restart ⚫", "Restart oba", "Start/Stop Self-Play" nie mają `aria-label` opisującego akcję.
- **Fix:** Dodaj `aria-label` np. `aria-label="Restart white neural network"`.

### FE-010: Dashboard — canvas redrawuje się przy każdej zmianie `lossHistory`
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/Dashboard.jsx` linie ~11
- **Opis:** `useEffect` depends na `lossHistory` — każde nowe loss powoduje full redraw. Przy szybkim self-play to może być 1000x. Rozważ throttling.
- **Fix:** Throttle redraw np. do max 1x/sekundę.

### FE-011: Move history — duplikacja logiki
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx` (moveHistory render ~245-258) vs `client/src/components/MoveHistory.jsx`
- **Opis:** App.jsx ręcznie renderuje historię ruchów zamiast użyć komponentu MoveHistory. MoveHistory istnieje ale nie jest importowany.
- **Fix:** Użyj `<MoveHistory moves={moveHistory} />` zamiast inline render.

### FE-012: GameTimer — importowany ale nieużywany
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/GameTimer.jsx`
- **Opis:** Komponent GameTimer istnieje i jest pełny ale nie jest importowany/rendereowany nigdzie w App.jsx.
- **Fix:** Albo użyj go w GameControls albo usuń.

### FE-013: Speed buttons na mobile — małe tap target
- **Severity:** kosmetyczny
- **Plik:** `client/src/App.jsx` + `client/src/components/GameControls.jsx`
- **Opis:** Speed buttons (⚡/🏃/🐢) mają padding 0.35rem 0.7rem — na mobile to ~20px wysokości, poniżej rekomendowanego 44px tap target.
- **Fix:** Zwiększ min-height na mobile do 44px.

### FE-014: Keyboard navigation w ParamsPanel tabs
- **Severity:** kosmetyczny
- **Plik:** `client/src/components/ParamsPanel.jsx` linie ~204-218
- **Opis:** Tabs obsługują tylko click, nie strzałki klawiatury. Zgodnie z WAI-ARIA pattern, tablist powinien reagować na ArrowLeft/ArrowRight.
- **Fix:** Dodaj onKeyDown handler z obsługą strzałek.

### FE-015: `index.html` — brak meta description
- **Severity:** kosmetyczny
- **Plik:** `client/index.html`
- **Opis:** Brak `<meta name="description">` — drobiazg ale wpływa na SEO i link previews.
- **Fix:** `<meta name="description" content="Checkers AI — graj przeciwko AI lub oglądaj AI vs AI">`
