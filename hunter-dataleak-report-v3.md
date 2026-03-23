# Hunter Data Leak Checker — Audyt v3
**Data:** 2026-03-23 21:30 UTC
**Agent:** hunter-sub-leakcheck (subagent)
**Zakres:** /opt/Checkers_vibe — pełny audyt bezpieczeństwa (re-check po poprzednich fixach)

---

## Podsumowanie

| Kategoria | Status | Uwagi |
|-----------|--------|-------|
| Stack traces / wycieki w odpowiedziach HTTP | ✅ Czysto | Wszystkie błędy zwracają generyczne komunikaty |
| Wrażliwe dane w logach | ✅ Czysto | setParams loguje tylko speedMode/aiMoveDelayMs |
| CORS | ✅ Poprawnie | Socket.IO locked do CORS_ORIGIN / localhost:3000 |
| Content-Security-Policy (#140) | ✅ Naprawione | Silna CSP, 9 dyrektyw, brak unsafe-*/wildcard |
| Rate limiting (#143) | ✅ Naprawione | 120 req/min/IP, cleanup, hard cap 10k, trust proxy=false |

**Werdykt:** Wszystkie 5 obszarów audytu jest w dobrym stanie. Brak nowych wycieków do naprawienia.

---

## Szczegóły

### 1. Stack traces / wycieki w odpowiedziach HTTP/API

| Check | Result |
|-------|--------|
| Node.js catch blocks | ✅ Generyczne: "Prediction failed", "Training failed", "Reset failed", "Move failed" |
| C++ engine /api/move | ✅ "invalid json", "invalid type", "internal error" (bez e.what()) |
| C++ engine /api/board/set | ✅ Walidacja + catch-all z generycznymi komunikatami |
| Proxy error handler | ✅ 502: "C++ backend unavailable" (bez err.stack) |
| cppFetch (server/index.js) | ✅ Loguje err.message, throw new Error z generycznym komunikatem |
| cppFetch (trainer.js) | ✅ Nie loguje response body — poprawnie discarduje |
| client ErrorBoundary | ✅ Wyświetla "Coś poszło nie tak" — nie pokazuje err.stack w UI |

**Wniossek:** Żaden endpoint nie eksponuje stack traces, ścieżek plików ani wersji frameworka w odpowiedziach HTTP.

### 2. Wrażliwe dane w logach

| Check | Result |
|-------|--------|
| setParams log | ✅ Loguje tylko `{ speedMode, aiMoveDelayMs }` (nie cały obiekt) |
| Passwords/tokens/secrets | ✅ Brak w żadnym console.log/error/warn |
| err.message vs err.stack | ✅ Tylko err.message w logach |
| socket.id w logach | ℹ️ Kosmetyczne — losowy string, nie sekret |
| Trainer modelParams log | ℹ️ Loguje architekturę modelu (layers/neurons) — nie wrażliwe |

**Wniossek:** Brak wrażliwych danych w logach.

### 3. CORS

| Check | Result |
|-------|--------|
| Socket.IO CORS origin | ✅ `CONFIG.server.corsOrigin` (env CORS_ORIGIN lub `http://localhost:3000`) |
| Wildcard (*) origin | ✅ Brak |
| Express CORS middleware | ℹ️ Nie używane (tylko Socket.IO ma CORS) — OK dla tej architektury |

**Wniossek:** CORS poprawnie skonfigurowany, locked do jednego origin.

### 4. Content-Security-Policy (issue #140)

| Dyrektywa | Wartość | Status |
|-----------|---------|--------|
| default-src | 'self' | ✅ |
| script-src | 'self' | ✅ (brak unsafe-inline/unsafe-eval) |
| style-src | 'self' | ✅ |
| img-src | 'self' data: | ✅ |
| font-src | 'self' | ✅ |
| connect-src | 'self' wss: | ✅ (ws: tylko gdy CSP_ALLOW_WS=true) |
| object-src | 'none' | ✅ |
| base-uri | 'self' | ✅ |
| frame-ancestors | 'none' | ✅ |

Dodatkowe headery: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy.

**Wniossek:** Issue #140 naprawione. CSP kompletna i silna.

### 5. Rate limiting (issue #143)

| Check | Result |
|-------|--------|
| Limit | ✅ 120 req/min per IP |
| Cleanup interval | ✅ Okresowe czyszczenie wygasłych wpisów |
| Hard cap | ✅ 10,000 entries max (eviction oldest-first) |
| trust proxy | ✅ `false` — zapobiega spoofowaniu IP przez X-Forwarded-For |
| IP source | ✅ `req.ip` z fallbackiem `req.socket.remoteAddress` |
| WS throttle | ✅ Per-socket throttling na setParams/setSpeed/setSpeedMode (1s cooldown) |
| 429 response | ✅ `{ error: 'Too many requests' }` |

**Wniossek:** Issue #143 naprawione. Rate limiting skuteczny, odporny na memory exhaustion.

---

## Inne obserwacje (minor)

| # | Opis | Severity |
|---|------|----------|
| 1 | C++ engine binduje na `127.0.0.1:8080` (poprzednio 0.0.0.0 — naprawione) | ✅ Fixed |
| 2 | `app.disable('X-Powered-By')` + `res.removeHeader` —双重防御 | ✅ Good |
| 3 | `express.json({ limit: '1mb' })` — rozsądny limit body | ✅ Good |
| 4 | `.gitignore` zawiera .env, .pem, .key, secrets/ | ✅ Good |
| 5 | Brak sekretów w git history | ✅ Clean |

---

## Testy

Wszystkie **2431 testów przechodzi** (w tym testy regresyjne issues #140-#143, security headers, rate limit security, CSP completeness).

---

## Commity

Brak nowych commitów — wszystkie ważne fixy zostały zastosowane w poprzednich rundach audytu.
