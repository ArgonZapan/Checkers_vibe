# 🔒 Data Leak Check — Checkers_vibe (CYCLE 2)
**Date:** 2026-03-24 00:31 UTC  
**Agent:** hunter-sub-leakcheck (Jarvis Horner)  
**Zakres:** server/index.js, server/proxy.js, config.js — data leaks, information disclosure, sensitive data exposure  
**Baseline:** Previous reports (hunter-sub-leakcheck-CYCLE, ha-leakcheck-007, hunter-sub-002, hunter-alpha-dataleak)

---

## Podsumowanie

| Kategoria | Status | Nowe znaleziska |
|-----------|--------|:---:|
| HTTP security headers | ✅ Dobre | 0 |
| Error responses — info leaks | ⚠️ **1 nowe** | **1** |
| WebSocket payloads | ⚠️ 1 nowe | **1** |
| Environment variables / secrets | ✅ Czysto | 0 |
| Rate limiting | ✅ Obecne | 0 |
| CORS | ✅ Poprawne | 0 |
| Secrets w kodzie | ✅ Brak | 0 |
| Client-side XSS | ✅ Brak | 0 |

---

## Weryfikacja poprzednich fixów

| ID | Opis | Status |
|----|------|--------|
| CSP `style-src 'unsafe-inline'` | Usunięto `unsafe-inline`, teraz `style-src 'self'` | ✅ NAPRAWIONO |
| `_config: CONFIG.ai` w paramsUpdate | Usunięto z WebSocket emit | ✅ NAPRAWIONO |
| LEAK-004 legalMoves validation | Dodano pełną walidację struktury legalMoves | ✅ NAPRAWIONO |
| GitHub PAT w .git/config | Zmieniono URL na beztokenowy | ✅ NAPRAWIONO |
| Security headers (CSP, X-Frame-Options, etc.) | Kompletne i poprawne | ✅ NADAL OK |
| Rate limiting (120 req/min/IP) | Obecne z cleanup interval | ✅ NADAL OK |
| Prototype pollution (ALLOWED_PARAMS whitelist) | Obecne | ✅ NADAL OK |
| WebSocket throttle (per-socket) | Obecne | ✅ NADAL OK |

---

## Nowe znaleziska

### 🔴 LEAK-018: `getGameState()` leakuje `err.message` do klientów przez WebSocket
- **Severity:** średni
- **Plik:** server/index.js:344-352
- **Dowód:**
  ```javascript
  } catch (err) {
    console.error('[getGameState] Error fetching game state:', err.message);
    return {
      board: Array(64).fill(0),
      turn: 'white',
      legalMoves: [],
      gameOver: true,
      winner: null,
      lastMove: null,
      error: err.message,  // ← LEAK: wysyłane do klienta przez socket.emit('state', state)
    };
  }
  ```
- **Problem:** `err.message` pochodzi z `cppFetch()` i może zawierać:
  - `"C++ engine timeout (5000ms) — engine may be crashed"` — ujawnia timeout konfiguracji i sugeruje crash
  - `"C++ engine unreachable — ECONNREFUSED"` — ujawnia kody błędów systemowych
  - `"C++ /api/game/state → 500"` — ujawnia internal endpoint paths i HTTP statusy
- **Jak to leci do klienta:** Obiekt `state` z polem `error` jest wysyłany przez:
  - `socket.emit('state', state)` — na nowe połączenie (linia 436)
  - `io.emit('state', statePayload)` — na każdy ruch w PvP (linia 401)
  - `socket.emit('state', statePayload)` — na ruch w PvAI (linia 403)
  - `socket.emit('state', state)` — po `startGame` (linia 472)
- **Fix:** Usunąć `error: err.message` z zwracanego obiektu lub zastąpić generycznym `"Game state unavailable"`.

### 🟡 LEAK-019: `POST /api/ai/params` zwraca pełny `trainer.getStatus()` — brak auth
- **Severity:** niski
- **Plik:** server/index.js:215
- **Dowód:**
  ```javascript
  trainer.setParams(epsilon, networkSize, side);
  io.emit('paramsChange', { epsilon, networkSize, side });
  res.json({ ok: true, ...trainer.getStatus() });
  ```
- **Problem:** `getStatus()` zwraca:
  - `avgRoundTimeMs` — timing wewnętrznych operacji
  - `last10Times` — ostatnie 10 czasów rund (dokładne timingi)
  - `totalTimeMs` — całkowity czas pracy
  - `bufferSize` — wielkość bufora treningowego
  - `modelParams` — pełne parametry modelu (layers, neurons, lr, etc.)
  - `stats` — gry, wygrane, remisy
- **Kontekst:** To NIE są secrety (żadnych credentials), ale endpoint nie wymaga autentykacji. Każdy kto może wysłać HTTP POST może odczytać pełną konfigurację AI.
- **Porównanie:** Inne endpoints (`/api/ai/info`, `/api/ai/stats`) zwracają podzbiór danych — ten zwraca wszystko.
- **Fix:** Ograniczyć response do `{ ok: true }` lub wymagać auth. Niski priorytet (localhost).

### 🟡 LEAK-020: WebSocket brak globalnego rate limiting — tylko per-socket throttle
- **Severity:** niski
- **Plik:** server/index.js (wsThrottle helper, sekcja WebSocket)
- **Opis:** Express ma rate limiting 120 req/min/IP dla HTTP. WebSocket ma tylko per-socket throttle (move: 50ms, setParams: 1s), ale brak globalnego limitu na liczbę połączeń WebSocket z jednego IP. Atakujący może otworzyć tysiące połączeń WS z tego samego IP, każde z osobnym throttle, i przeciążyć serwer.
- **Fix:** Dodać connection rate limiting w `io.on('connection')` — max N połączeń na IP w oknie czasowym.

---

## Sprawdzone i czyste ✅

### 1. HTTP Security Headers
| Header | Wartość | Status |
|--------|---------|--------|
| Content-Security-Policy | `default-src 'self'; script-src 'self'; style-src 'self'; ...` | ✅ Poprawny (bez `unsafe-inline`) |
| X-Content-Type-Options | `nosniff` | ✅ |
| X-Frame-Options | `DENY` | ✅ |
| X-XSS-Protection | `0` | ✅ (prawidłowa wartość) |
| Referrer-Policy | `strict-origin-when-cross-origin` | ✅ |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | ✅ |
| X-Powered-By | Usunięty (defense-in-depth) | ✅ |

### 2. CORS
- Socket.IO: `origin: CONFIG.server.corsOrigin || 'http://localhost:3000'` — restrykcyjny ✅
- Express: brak CORS middleware — OK bo React serwowany z tego samego origin ✅
- Proxy: `changeOrigin: true` do `localhost:8080` — wewnętrzny, nie exploitable ✅

### 3. Secrets / Credentials
- Brak hardcoded API keys, tokenów, haseł w kodzie ✅
- `process.env` tylko: `PORT`, `HOST`, `CORS_ORIGIN`, `CSP_ALLOW_WS`, `TF_ENABLE_ONEDNN_OPTS` — żadnych secrets ✅
- `.env` pliki nie istnieją w repo ✅
- `.gitignore` blokuje: `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`, `credentials/` ✅

### 4. Error Responses (HTTP)
| Endpoint | Response | Leak? |
|----------|----------|-------|
| `POST /api/ai/predict` catch | `"Prediction failed"` | ❌ Nie |
| `POST /api/ai/train` catch | `"Training failed"` | ❌ Nie |
| `POST /api/ai/reset` catch | `"Reset failed"` | ❌ Nie |
| Proxy error | `"C++ backend unavailable"` | ❌ Nie |
| Validation errors | `"board must be an array of 64 elements"` | ❌ Nie (bezpieczne) |

### 5. Rate Limiting
- Express: 120 req/min/IP, cleanup interval, hard cap 10000 entries ✅
- WebSocket: per-socket throttle (wsThrottle helper) ✅

### 6. Input Validation
- `setParams`: whitelist ALLOWED_PARAMS, type checking, range validation ✅
- `train`: board validation (64 elements, integer 0-4), turn 1/-1 ✅
- `move`: coordinate validation (row/col 0-7), captures validation ✅
- `predict`: board + legalMoves structure validation ✅

### 7. Client-Side
- Brak `innerHTML`, `dangerouslySetInnerHTML`, `eval()` w user code ✅
- React auto-escapes output ✅

### 8. Proxy (server/proxy.js)
- Target hardcoded na `localhost:8080` — brak SSRF ✅
- Error handler zwraca generyczny message ✅
- Loguje tylko method + URL (nie body) ✅
- Filter odfiltruje AI/selfplay routes ✅

---

## Issues already tracked (nie duplikuję)

Z poprzednich raportów — nadal obecne ale niski priorytet:
- **Brak CORS middleware na Express HTTP** (LEAK-013) — nie exploitable (same-origin)
- **Brak CSRF na HTTP POST** (LEAK-014) — nie exploitable (same-origin + JSON content-type wymaga preflight)
- **WebSocket brak autentykacji** (LEAK-001 alpha) — akceptowalne dla localhost dev
- **CORS env brak walidacji na `*`** (LEAK-006) — edge case
- **socket.id w logach** (LEAK-017) — kosmetyczne

---

## Ogólna ocena

Kod Checkers_vibe jest w **dobrym stanie bezpieczeństwa**. Większość poważnych problemów z poprzednich cykli została naprawiona. Nowe znaleziska:

- **LEAK-018** (średni) — `err.message` w `getGameState()` leakuje infrastrukturę do klientów. Fix prosty: usunąć pole `error` z zwracanego obiektu.
- **LEAK-019** (niski) — `/api/ai/params` zwraca pełny status trainera. Niekrytyczne (localhost).
- **LEAK-020** (niski) — brak globalnego WS connection rate limiting. Niekrytyczne (localhost).

Brak krytycznych wycieków danych, credentials ani PII.
