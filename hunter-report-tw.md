# Hunter Report — test-writer (hunter-sub-tw)

**Date:** 2026-03-24
**Agent:** test-writer sub-agent
**Branch:** main

## Summary

Sprawdziłem 5 fixed issues pod kątem testów regresyjnych. Jeden issue (#150) nie miał testów — napisałem je. Wszystkie 3281 testów przechodzi.

---

### TEST: #153 — GameControls speed buttons — brak widocznego tekstu (a11y)

- **Test exists:** tak — `__tests__/a11yRegression.test.js`
- **Test added:** nie (już istniały)
- **Passes:** tak
- **Test count:** 8 testów (aria-label Polish, visible text, aria-pressed, uniqueness)

---

### TEST: #152 — ParamsPanel tabs — brak Home/End/nawigacja góra-dół (a11y)

- **Test exists:** tak — `__tests__/a11yRegression.test.js`
- **Test added:** nie (już istniały)
- **Passes:** tak
- **Test count:** 7 testów (Home/End/Arrow keys, full connectivity, roving tabindex)

---

### TEST: #150 — Multi-capture animation — duplicate piece visible

- **Test exists:** nie (brak testu regresyjnego)
- **Test added:** tak — `__tests__/issue150-multi-capture-duplicate.test.js`
- **Passes:** tak
- **Test count:** 18 testów
- **Commit:** `6de228e` — `fix: regression test for #150 multi-capture duplicate piece (hunter-sub-tw)`
- **Co pokryte:**
  - `getDisplayBoard` — logika wyboru boardu podczas/po animacji
  - animStep >= 0 → animBoard (brak duplikatu)
  - Post-animation → animBoard trzyma się do aktualizacji board prop
  - Board prop update → przełączenie na nowy board
  - `buildBaseBoard` — usuwanie bitego pionka z pozycji startowej
  - Captured pieces removal (z captures prop i fallback geometry)
  - Friendly pieces nie są usuwane (fallback)
  - Piece count invariant (brak dodatkowych pionków)
  - Transition: anim → animBoard kept → board updates → normal
  - Rapid board updates mid-animation
  - Null safety edge cases

---

### TEST: #156 — handleToggleSelfplay — stale closure

- **Test exists:** tak — `__tests__/hunter-tw-issues154-146-156-151-142.test.js`
- **Test added:** nie (już istniały)
- **Passes:** tak
- **Test count:** 5 testów (rapid toggle alternation, ref correctness, 100 toggles, odd count, external sync)

---

### TEST: #144 — MoveHistory.jsx — dead code

- **Test exists:** tak — `__tests__/hunter-tw-issues163-164-144.test.js`
- **Test added:** nie (już istniały)
- **Passes:** tak
- **Test count:** 3 testów (existence check, archive check, import check in App.jsx)
- **Note:** MoveHistory.jsx nie istnieje jako komponent. `moveHistory` to zmienna stanu w App.jsx — to jest używane.

---

## Test Results

```
Total: 3281 | ✅ 3281 passed | ❌ 0 failed
🎉 All tests passed!
```

## Changes

| File | Action |
|------|--------|
| `__tests__/issue150-multi-capture-duplicate.test.js` | **NEW** — 18 regression tests for #150 |
| `__tests__/run.js` | **MODIFIED** — registered new test suite |
