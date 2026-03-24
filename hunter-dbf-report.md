# Hunter DBF (Dynamic Bug Finder) — Raport

**Agent:** hunter-sub-dbf  
**Data:** 2026-03-24  
**Zakres:** Skan kodu pod kątem nowych bugów, weryfikacja napraw #147, #150, #151, #156, #157, #158, #160, #161, sprawdzenie regresji po ostatnich commitach.

---

## Status napraw wcześniejszych issue

| Issue | Status | Uwagi |
|-------|--------|-------|
| #161 (rate limiting OOM) | ✅ Naprawione | Cap 10000 entries + cleanup interval + eviction on insert |
| #158 (CORS/WS origin) | ✅ Naprawione | `_isAllowedWsOrigin()` blokuje gdy `CORS_ORIGIN=*` |
| #157 (auth na endpoints) | ✅ Naprawione | `requireApiToken` na `/api/ai/train`, `/params`, `/reset`, `/restart`, selfplay |
| #160 (race condition dispose) | ✅ Naprawione | `acquireModelLock()` + `disposeModel()` + guards w predict/train |
| #159 (startGame race) | ✅ Naprawione | `_moveQueue` serializuje startGame z move |
| #150 (duplicate piece animation) | ✅ Naprawione | `animStep >= 0` guard + mounted flag |
| #151 (buffer overflow multi-capture) | ✅ Naprawione | Timers czyszczone w cleanup, mounted flag |
| #156 (stale closure handleToggleSelfplay) | ✅ Naprawione | Używa `selfPlayActiveRef` zamiast `selfPlayActive` |
| #147 (hasAnyMove short-circuit) | N/A | `hasAnyMove` nie istnieje w kodzie — engine C++ obsługuje |

---

## Nowe znalezione bugi

### BUG-DBF-001: `trainer.restart()` nie `await`uje `_replaceModel()` — CRITICAL

- **Lokalizacja:** `server/ai/trainer.js:562,565` (metoda `restart()`)
- **Severity:** Krytyczny
- **Opis:** Refaktor `_replaceModel()` z sync na async (praca w working tree) dodał `await` w `setParams()` i `resetModel()`, ale pominął `restart()`. Metoda `restart()` przypisuje wynik `this._replaceModel(...)` do `this.modelWhite`/`this.modelBlack` BEZ `await`. Zmienne te stają się Promise'ami zamiast obiektami modeli TF.js — następna predykcja crashuje.
- **Impact:** Przyciski "Restart ⚪" / "Restart ⚫" / "Restart oba" w UI powodują crash serwera przy następnej próbie predykcji.
- **Fix:** Dodano `await` do obu wywołań `_replaceModel()` w `restart()`.
- **Status:** ✅ Naprawione

---

## Regresje po ostatnich commitach

**Brak regresji.** Wszystkie 3263 testy przechodzą. Ostatnie commity (hunter-sub-tw, hunter-sub-dbf) nie wprowadziły nowych bugów.

---

## Podsumowanie

- **Znalezione nowe bugi:** 1
- **Naprawione:** 1
- **Regressje:** 0
- **Testy:** 3263/3263 ✅
