# Hunter Leak Check — Checkers_vibe (ha-sub-leakcheck)
**Data:** 2026-03-23 16:33 UTC
**Agent:** Jarvis Horner (hunter-sub-007)
**Zakres:** /opt/Checkers_vibe — audyt bezpieczeństwa (wycieki danych, XSS/CSRF/SQLi, CSP, rate limiting, sensitive logging)
**Baseline:** poprzedni raport `hunter-dataleak-report.md` + fix commit `f5b2161` (hunter-sub-005)

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| Hardcoded secrets/keys/tokens | ✅ Czysto | 0 |
| .env / .gitignore | ✅ Poprawnie skonfigurowane | 0 |
| HTTP security headers (CSP) | ✅ Naprawione | 0 nowych |
| Rate limiting | ✅ Naprawione | 0 nowych |
| XSS | ✅ Brak (React + CSP) | 0 |
| SQLi | ✅ N/A (brak SQL) | 0 |
| CSRF | ⚠️ Brak ochrony na HTTP POST | 1 |
| CORS na Express | ⚠️ Brak | 1 |
| WebSocket auth | ⚠️ Brak (akceptowalne dla gry) | 1 |
| Sensitive logging | ✅ Czysto | 0 |
| Config leaks | ⚠️ `_config` w paramsUpdate | 1 |

**Ogólny werdykt:** Kod jest w dobrym stanie po poprzednich fixach. Brak krytycznych wycieków. Kilka minor issues.

---

## Weryfikacja poprzednich fixów (hunter-dataleak + hunter-sub-005)

| ID | Opis | Status | Uwagi |
|----|------|--------|-------|
| LEAK-001 | Security headers | ✅ NAPRAWIONE | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — wszystko na miejscu (server/index.js:28-35) |
| LEAK-002 | Rate limiting | ✅ NAPRAWIONE | In-memory Map, 120 req/min per IP, cleanup interval, hard cap 10000 entries (server/index.js:38-72) |
| LEAK-003 | Server binding | ✅ NAPRAWIONE | `process.env.HOST || '127.0.0.1'` (server/index.js:806) |
| LEAK-005 | setParams type-check | ✅ NAPRAWIONE | Sprawdza `typeof newParams !== 'object' || Array.isArray(newParams)` (server/index.js:411) |
| LEAK-007 | Train batch validation | ✅ NAPRAWIONE | Waliduje strukturę każdego sample — board array, turn 1/-1 (server/index.js:96-107) |
| LEAK-010 | Captures validation | ✅ NAPRAWIONE | Sprawdza elementy captures jako koordynaty [row,col] 0-7 (server/index.js:363-368) |
| LEAK-011 | Prototype pollution | ✅ NAPRAWIONE | `ALLOWED_PARAMS` whitelist Set (server/index.js:426-437) |
| LEAK-012 | WebSocket throttle | ✅ NAPRAWIONE | `wsThrottle()` helper, per-socket min intervals (move 50ms, setParams 1s, setSpeed 1s) |

---

## Nowe znaleziska

### LEAK-013: Brak CORS middleware na Express HTTP endpoints
- **Severity:** niski
- **Plik:** server/index.js (cały Express)
- **Opis:** CORS jest skonfigurowane tylko dla Socket.IO (`cors: { origin: CONFIG.server.corsOrigin }`). Express HTTP endpoints (`/api/ai/*`, `/api/selfplay/*`) nie mają żadnej CORS polityki. W praktyce nie jest to exploitable bo React app jest serwowana z tego samego origin, ale brak CORS na API endpoints jest złym praktyką bezpieczeństwa.
- **Rekomendacja:** Dodać `cors` middleware dla Express endpoints (niski priorytet — dev setup).

### LEAK-014: Brak CSRF protection na HTTP POST endpoints
- **Severity:** niski
- **Plik:** server/index.js — `/api/ai/train`, `/api/ai/params`, `/api/ai/reset`, `/api/ai/restart`, `/api/selfplay/*`
- **Opis:** HTTP POST endpoints nie mają żadnej ochrony CSRF. Złośliwa strona mogłaby wysłać cross-origin POST do `/api/ai/reset` i zresetować model. W praktyce: same-origin z React app, CORS brak = przeglądarka blokuje cross-origin POST z `application/json` content-type (preflight). Ale custom headers lub form POST mogą przejść.
- **Rekomendacja:** Dodać CSRF token lub ograniczyć do WebSocket-only (niski priorytet — same-origin).

### LEAK-015: CSP `style-src 'unsafe-inline'`
- **Severity:** niski
- **Plik:** server/index.js:35
- **Opis:** CSP pozwala na `style-src 'self' 'unsafe-inline'`. To osłabia ochronę przed CSS injection. W React/Vite build, inline styles nie powinny być potrzebne (CSS jest w external bundle).
- **Rekomendacja:** Przetestować usunięcie `'unsafe-inline'` z `style-src` po zbudowaniu client (niski priorytet — React może używać inline styles).

### LEAK-016: `_config` transmitowany przez WebSocket
- **Severity:** kosmetyczny
- **Plik:** server/index.js:298 (paramsUpdate event)
- **Opis:** `socket.emit('paramsUpdate', { ..., _config: CONFIG.ai })` — pełna konfiguracja AI jest wysyłana do klienta na połączeniu. To nie jest secret (wartości domyślne modelu), ale prefix `_` sugeruje "internal". Nie ma tu wycieku credentials.
- **Rekomendacja:** Brak (akceptowalne — to konfiguracja modelu, nie dane użytkownika).

### LEAK-017: socket.id logowane w console
- **Severity:** kosmetyczny
- **Plik:** server/index.js — wiele miejsc (connect, disconnect, startGame, setParams, setSpeed, reset)
- **Opis:** `socket.id` to losowy string identyfikujący sesję WebSocket. Nie jest secret, ale może pomóc w korelacji aktywności użytkownika w logach.
- **Rekomendacja:** Usunąć socket.id z logów lub obciąć do 8-znakowego prefixu (kosmetyczne).

---

## Wrażliwe dane w kodzie/plikach

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens/passwords | ✅ Brak |
| .env files in repo | ✅ Brak (.gitignore blokuje .env, .env.*, .npmrc, *.pem, *.key, secrets/, credentials/) |
| process.env exposure | ✅ Tylko PORT, HOST, CORS_ORIGIN, TF_ENABLE_ONEDNN_OPTS — żadnych secrets |
| WebSocket transmituje secrets | ✅ Brak |
| config.js zawiera secrets | ✅ Brak (tylko domyślne wartości konfiguracyjne) |
| Buffer/model data w .gitignore | ✅ data/, models/, backups/ zablokowane |

## Sensitive logging

| Check | Result |
|-------|--------|
| console.log z tokenami/kluczami | ✅ Brak |
| console.log z request body | ✅ Brak (proxy loguje tylko method + URL) |
| console.log z board state | ✅ Brak (tylko w testach) |
| Trainer logs | ✅ Tylko metadane (games played, epsilon, model params) — żadnych credentials |

## Walidacja wejścia

| Check | Result |
|-------|--------|
| SQL injection | ✅ N/A (brak SQL — in-memory + JSON files) |
| XSS | ✅ Brak (React JSX auto-escapes, brak innerHTML/document.write/eval, CSP blokuje inline scripts) |
| Command injection | ✅ Brak (brak exec/eval/child_process w aplikacyjnym kodzie) |
| Prototype pollution | ✅ NAPRAWIONE (ALLOWED_PARAMS whitelist) |
| SSRF via proxy | ✅ Proxy targetuje tylko localhost:8080, filter odfiltruje AI/selfplay routes |

---

## Commit

Brak nowych fixable leaks. Wszystkie poważne problemy z poprzedniego raportu zostały naprawione w commitach do `f5b2161`.

---

## Podsumowanie

Kod Checkers_vibe jest w **dobrym stanie bezpieczeństwa** po poprzednich fixach:

1. **Security headers** — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy ✅
2. **Rate limiting** — 120 req/min per IP z cleanup ✅
3. **Input validation** — setParams, train batch, captures, legal moves — wszystko walidowane ✅
4. **Prototype pollution** — whitelist ALLOWED_PARAMS ✅
5. **WebSocket throttle** — per-socket min intervals ✅
6. **Brak secrets** — .gitignore blokuje .env, keys, credentials ✅
7. **Brak sensitive logging** — console.log nie zawiera tokenów/kluczy ✅

**Minor issues** (niski priorytet): brak CORS na Express, brak CSRF na HTTP POST, `unsafe-inline` w CSP, `_config` w WebSocket.
