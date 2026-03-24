# Bug Fix Report — hunter-sub-ifx3
**Date:** 2026-03-24
**Project:** Checkers_vibe (/opt/Checkers_vibe)

---

## BUG-001: saveModel ENOTEMPTY regression
- **Plik:** `server/ai/model.js` (saveModel function, ~linia 420)
- **Problem:** Brak warning comment i logowania w bloku catch ENOTEMPTY — fallback rm+rename jest non-atomic (crash window → total data loss), ale nie było żadnego śladu w logach ani komentarza o ryzyku.
- **Fix:**
  - Dodano detailed warning comment przed blokiem try/catch: `RISK: rm+rename is non-atomic — a crash between rm and rename loses all model data. On Linux, rename(2) should never return ENOTEMPTY...`
  - Dodano `console.warn('[Model] rename returned ENOTEMPTY — attempting force rename (non-atomic fallback)')` wewnątrz handlera ENOTEMPTY/EEXIST
  - Dodano inline comment `// WARNING: Non-atomic fallback — data loss window on crash`
- **Funkcjonalność:** Niezmieniona — to samo rm+rename, tylko z lepszą obserwowalnością.
- **Commit:** `d86a5c8` — `fix: add warning + log for saveModel ENOTEMPTY non-atomic fallback (hunter-sub-ifx3)`

---

## BUG-002: Timer resource leak — Board.jsx multi-capture animation
- **Plik:** `client/src/components/Board.jsx` (multi-capture useEffect, ~linia 70-145)
- **Problem:** useEffect cleanup czyści timery, ale jeśli component unmountuje się w trakcie animacji, timer callbacks mogą próbować `setAnimStep()` / `setAnimBoard()` na odmontowanym komponencie → React warning "Can't perform a React state update on an unmounted component" + resource leak.
- **Fix:**
  - Dodano `let mounted = true;` na początku effectu
  - Wszystkie `setAnimStep()`, `setAnimBoard()` i inner `setTimeout` callbacks sprawdzają `if (mounted)` przed state update
  - Cleanup `return () => { mounted = false; timersRef.current.forEach(clearTimeout); timersRef.current = []; };` — mounted flag jest resetowany, timery czyszczone
  - Wczesne returny (path null, path.length <= 2, same path, no prevBoard) mają proper cleanup: `return () => { mounted = false; }`
- **Funkcjonalność:** Niezmieniona — animacja działa identycznie, ale bez leaków.
- **Commit:** `8008b97` — `fix: add mounted flag to prevent timer leak in multi-capture animation (hunter-sub-ifx3)`

---

## Podsumowanie

| Bug | Status | Zmiana funkcjonalności | Commit |
|-----|--------|----------------------|--------|
| BUG-001 | ✅ Fixed | Nie | d86a5c8 |
| BUG-002 | ✅ Fixed | Nie | 8008b97 |

Minimalne zmiany, zero zmian funkcjonalności, oba fixy zcommitowane osobno.
