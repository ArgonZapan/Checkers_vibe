# 🔒 Security Leak Check — Checkers_vibe (hunter-sub-leakcheck)
**Data:** 2026-03-23
**Agent:** Jarvis Horner (hunter-sub-leakcheck, data-leak-checker)
**Repo:** /opt/Checkers_vibe (ArgonZapan/Checkers_vibe)
**Scope:** Data leaks, CORS, CSP, rate limiting, input validation, WebSocket, secrets, regression check

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| Hardcoded secrets/keys/tokens | ✅ Czysto | 0 |
| .env / credentials in repo | ✅ Czysto (w .gitignore) | 0 |
| Git history — secrets | ✅ Czysto | 0 |
| HTTP security headers | ✅ Poprawne | 0 |
| Rate limiting | ✅ Poprawny (trust proxy: false) | 0 |
| Server binding | ✅ 127.0.0.1 | 0 |
| CORS | ✅ Skonfigurowany | 0 |
| CSP — server headers | ✅ Poprawne | 0 |
| CSP — test mismatch | ⚠️ Regresja | 1 |
| Input validation | ✅ Wyczerpująca | 0 |
| WebSocket — throttling | ✅ Obecny | 0 |
| WebSocket — auth | ⚠️ Brak (z poprzedniego raportu) | 1 |
| Data leak in logs | ✅ Czyste (filtered setParams log) | 0 |
| Previous fix regressions | ⚠️ 1 test regression | 1 |

**Ogólny werdykt:** Serwer jest dobrze zabezpieczony. Wszystkie krytyczne fixy z poprzednich rund działają poprawnie. Jeden problem: 3 pliki testowe nie zsynchronizowały się z produkcją po fixie CSP (commit 1ceed3e).

---

## Szczegóły

### LEAK-015: CSP test mismatch — 3 test files have stale `'unsafe-inline'` in style-src
- **Severity:** important
- **Location:** `__tests__/securityHeaders.test.js:22`, `__tests__/cspHeaderContent.test.js:16`, `__tests__/cspHeaders.test.js:21`
- **Evidence:** Server CSP (line 37) sets `style-src 'self'` — NIE ma `'unsafe-inline'`. Ale 3 z 4 testów CSP mają:
  ```
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ..."
  ```
  Tylko `__tests__/cspCompleteness.test.js:34` jest zsynchronizowany z produkcją (bez `'unsafe-inline'`).
  
  Skutki:
  - Testy **nie wykryją regresji** jeśli ktoś doda `'unsafe-inline'` do style-src na serwerze
  - Testy **fałszywie akceptują** CSP string z `'unsafe-inline'` mimo że produkcja go nie ma
  - Commit 1ceed3e naprawił tylko `cspCompleteness.test.js`, pominął pozostałe 3 pliki
- **Fix:** Usunąć `'unsafe-inline'` z CSP string w `securityHeaders.test.js`, `cspHeaderContent.test.js`, i `cspHeaders.test.js`, żeby testy mirrorowały produkcję.

---

## Audit — Sekrety (re-check)

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens/passwords | ✅ Brak |
| .env files in repo | ✅ Brak (w .gitignore) |
| .pem/.key files | ✅ Brak |
| process.env exposure | ✅ Tylko PORT, HOST, CORS_ORIGIN, TF_ENABLE_ONEDNN_OPTS, CSP_ALLOW_WS |
| WebSocket transmituje secrets | ✅ Brak |
| config.js zawiera secrets | ✅ Brak |
| Git history — committed secrets | ✅ Brak (przeszukano `git log -S`) |
| Git stash — secrets | ✅ Brak |

## Audit — CORS

| Check | Result |
|-------|--------|
| Socket.IO CORS origin | ✅ `CONFIG.server.corsOrigin` (env: `CORS_ORIGIN`, default `http://localhost:3000`) |
| Express CORS headers | ✅ N/A (brak globalnego CORS — tylko Socket.IO) |
| Proxy changeOrigin | ✅ `true` — proxy zmienia origin na C++ target |

**Uwaga:** Express nie ma globalnego middleware CORS — API endpointy (`/api/ai/*`) nie mają headera `Access-Control-Allow-Origin`. To bezpieczne (tylko same-origin frontend + Socket.IO mają CORS), ale oznacza że direct HTTP fetch z innych originów będzie zablokowany przez przeglądarkę. To **poprawne zachowanie**.

## Audit — CSP

| Check | Result |
|-------|--------|
| default-src 'self' | ✅ |
| script-src 'self' | ✅ (bez unsafe-inline, bez unsafe-eval) |
| style-src 'self' | ✅ (bez unsafe-inline — React używa inline style attrs, nie `<style>` blocks) |
| img-src 'self' data: | ✅ |
| font-src 'self' | ✅ |
| connect-src 'self' wss: | ✅ (ws: tylko gdy CSP_ALLOW_WS=true) |
| frame-ancestors 'none' | ✅ |
| style-src-attr | ℹ️ Brak — fallback do style-src (poprawne) |

**CSP jest kompletna i bezpieczna.** 7 dyrektyw, żadnych luk.

## Audit — Rate Limiting

| Check | Result |
|-------|--------|
| trust proxy | ✅ `false` (zapobiega X-Forwarded-For spoofing) |
| Limit: 120 req/min per IP | ✅ |
| Memory cap: 10,000 entries | ✅ |
| Periodic cleanup | ✅ (co 60s) |
| 429 response | ✅ `{ error: 'Too many requests' }` |

**Rate limiting jest skuteczny i nie można go obejść przez X-Forwarded-For.**

## Audit — Input Validation

| Endpoint | Validation | Status |
|----------|-----------|--------|
| POST /api/ai/predict | board[64], legalMoves (from/to coords 0-7, captures validated) | ✅ |
| POST /api/ai/train | batch size ≤10000, each sample: board[64] ints 0-4, turn ∈ {1,-1} | ✅ |
| POST /api/ai/params | epsilon finite 0-1, networkSize ∈ {small,medium,large} | ✅ |
| POST /api/ai/restart | side ∈ {white,black,both} | ✅ |
| WS: move | from/to coords validated (0-7), captures array validated | ✅ |
| WS: getLegalMoves | from coords validated (0-7) | ✅ |
| WS: setParams | whitelist keys, type+range checks, mode auth (aivai only) | ✅ |
| WS: setSpeed | type check (number 0-10000), NaN check, mode auth | ✅ |
| WS: setSpeedMode | type check (string), mode auth | ✅ |

**All endpoints have comprehensive input validation.**

## Audit — WebSocket

| Check | Result |
|-------|--------|
| Connection origin (CORS) | ✅ Socket.IO CORS locked to `CORS_ORIGIN` |
| Throttling (move) | ✅ 50ms per socket |
| Throttling (setParams/setSpeed/setSpeedMode) | ✅ 1000ms per socket |
| Mode-based auth (setParams/setSpeed/setSpeedMode) | ✅ aivai only |
| Prototype pollution (setParams) | ✅ Whitelist keys |
| Move queue serialization | ✅ per-socket promise chain |
| Authentication | ⚠️ Brak (z poprzedniego raportu — każdy connected client może kontrolować grę) |

**Uwaga o autentykacji:** To jest znany problem z poprzedniej rundy (BUG-001 z `__bugs_found_hunter_002.md`). Każdy klient po połączeniu może: start/stop self-play, reset model, zmieniać parametry. `setParams` wymaga `gameMode === 'aivai'`, ale klient może najpierw wysłać `startGame({ mode: 'aivai' })`. To **nie jest regresja** — istniało od początku.

## Audit — Previous Fix Regressions

| Commit | Fix | Regresja? |
|--------|-----|-----------|
| b5d5aa9 | trust proxy = false | ✅ Brak — działa |
| 44461f3 | rate limiting memory cap | ✅ Brak — działa |
| 708ced7 | C++ engine 127.0.0.1 | ✅ Brak — nadal 127.0.0.1 (main.cpp:17) |
| fe34e93 | sanitize error responses | ✅ Brak — generic error messages |
| 9f4585d | input validation gaps | ✅ Brak — all validators present |
| 1ceed3e | CSP test match production | ⚠️ **Częściowa regresja** — naprawił tylko cspCompleteness.test.js, nie naprawił securityHeaders.test.js, cspHeaderContent.test.js, cspHeaders.test.js |

---

## Commit

Brak commitów — problem LEAK-015 dotyczy testów (nie kodu produkcyjnego). Nie wymaga fix commita do kodu, ale testy powinny być zsynchronizowane.

---

**Werdykt końcowy:** Serwer Checkers_vibe jest solidnie zabezpieczony. Wszystkie krytyczne naprawy z poprzednich rund (leak-checker, bugfinder, dynbug) działają poprawnie i nie wprowadziły regresji. Jedyny znaleziony problem to desynchronizacja 3 plików testowych z produkcją — testy nadal przechodzą (1810/1810 ✅) bo testują własny hardcoded string, ale nie wykryłyby regresji CSP.
