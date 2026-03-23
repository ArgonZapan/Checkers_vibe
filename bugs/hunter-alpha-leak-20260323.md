# Hunter Alpha — Data Leak & Security Audit Report
**Data:** 2026-03-23  
**Agent:** Jarvis Horner (data-leak-checker, hunter-sub-leak)  
**Zakres:** /opt/Checkers_vibe — pełny audyt bezpieczeństwa i wycieków danych

---

## Podsumowanie

| Kategoria | Status | Znalezione | Naprawione |
|-----------|--------|-----------|------------|
| Logi wyciekające dane z response body | 🔴 Krytyczne | 2 | ✅ 2 |
| Fatal error handler — stack trace w logach | ⚠️ Ważne | 1 | ✅ 1 |
| CSP headers — brakujące dyrektywy | ⚠️ Ważne | 2 | ✅ 2 |
| Rate limiting — odporność na spoofed headers | ✅ OK | 0 | — |
| Input validation (HTTP + WebSocket) | ✅ OK | 0 | — |
| Pliki z sekretami w repo | ✅ Czysto | 0 | — |
| Error responses wyciekające do klientów | ✅ OK | 0 | — |

**Ogólny werdykt:** Kod był dobrze zabezpieczony z poprzednich rund Hunter Alpha. Znalazłem 3 realne problemy (wszystkie naprawione) i 2 minor observations. **2086 testów przechodzi po fixach.**

---

## Naprawione Problemy

### LEAK-FIX-01: cppFetch loguje body odpowiedzi C++ (server/index.js + server/ai/trainer.js)
- **Severity:** Krytyczne
- **Pliki:** `server/index.js:288`, `server/ai/trainer.js:210`
- **Problem:** `body.slice(0, 200)` w `console.error` logował do 200 znaków odpowiedzi C++ backendu. Response body mogło zawierać: internal file paths, stack traces z C++ engine, szczegółowe komunikaty błędów ujawniające architekturę.
- **Fix:** Usunięto logowanie body entirely — `await res.text().catch(() => '')` (discard), log tylko status code.
- **Impact:** Logi serwerowe nie będą zawierać potencjalnie wrażliwych danych z C++ engine.

### LEAK-FIX-02: Fatal error handler loguje pełny obiekt error (server/index.js:894)
- **Severity:** Ważne
- **Plik:** `server/index.js:894`
- **Problem:** `console.error('[Server] Fatal error:', err)` logował pełny obiekt Error wraz ze stack trace'em, ujawniając internal paths (`/opt/Checkers_vibe/...`), nazwy modułów, numery linii.
- **Fix:** Zmieniono na `console.error('[Server] Fatal error:', err.message)` — tylko komunikat błędu.

### LEAK-FIX-03: CSP brakowało `object-src` i `base-uri` (server/index.js)
- **Severity:** Ważne
- **Plik:** `server/index.js:40` (CSP header)
- **Problem:** CSP nie zawierał `object-src 'none'` (umożliwiałoby ładowanie pluginów Flash/Java) ani `base-uri 'self'` (umożliwiałoby atak `<base>` tag injection, przekierowujący ładowanie zasobów).
- **Fix:** Dodano `object-src 'none'; base-uri 'self'` do CSP header.
- **CSP przed:** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'`
- **CSP po:** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`

---

## Weryfikacja — Brak Problemów

### Rate Limiting — Odporność na Spoofed Headers ✅
- `app.set('trust proxy', false)` — Express nie ufa `X-Forwarded-For`
- Rate limiter używa `req.ip || req.socket.remoteAddress` — direct connection IP
- Cleanup interval zapobiega memory leak (max 10,000 entries)
- **Werdykt:** Odporny na header spoofing.

### Input Validation (HTTP) ✅
| Endpoint | Walidacja |
|----------|-----------|
| `POST /api/ai/predict` | board[64] integers 0-4, legalMoves coordinates 0-7, captures validated |
| `POST /api/ai/train` | batch size ≤10000, each sample: board[64] integers, turn ±1 |
| `POST /api/ai/params` | epsilon 0-1 (isFinite), networkSize small/medium/large |
| `POST /api/ai/restart` | side ∈ {white, black, both} |

### Input Validation (WebSocket) ✅
| Handler | Walidacja |
|---------|-----------|
| `move` | from/to [row,col] 0-7, captures array of valid coords |
| `getLegalMoves` | from [row,col] 0-7 |
| `setParams` | whitelist keys, numeric range checks, NaN/Infinity rejection |
| `setSpeed` | number 0-10000, NaN check, aivai-only auth |
| `setSpeedMode` | string, fast/normal only, aivai-only auth |

### Error Responses — Brak Wycieków do Klientów ✅
Wszystkie `res.json({ error: '...' })` i `socket.emit('error', { message: '...' })` używają generycznych komunikatów:
- `"Prediction failed"`, `"Training failed"`, `"Reset failed"`, `"Too many requests"`, `"C++ backend unavailable"`, `"Move failed"`, `"Failed to start game"`, `"Failed to update parameters"`
- Żaden nie zawiera stack traces, internal paths, ani process.env values.

### Sekrety w Repo ✅
- `.gitignore` pokrywa: `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`, `credentials/`, `.npmrc`
- Brak plików z sekretami na dyscie
- Brak hardcoded API keys/tokens/passwords w kodzie
- Git history i stash — czyste

---

## Minor Observations (nie naprawiane)

### INFO: Trainer cppFetch loguje internal URL
- **Plik:** `server/ai/trainer.js:215`
- `throw new Error(\`C++ engine error: ${opts.method || 'GET'} ${url} → ${res.status}\`)` — error zawiera pełny URL `http://localhost:8080/...`
- To tylko server-side (nie trafia do klientów), ale ujawnia internal architecture w logach.
- **Priorytet:** Niski — przydatne do debugowania.

### INFO: C++ engine binduje na 0.0.0.0
- **Plik:** `engine/src/main.cpp`
- C++ backend binduje na `0.0.0.0:8080` — dostępny na wszystkich interfejsach.
- **Priorytet:** Minor (o ile maszyna nie ma publicznego IP).

---

## Commit

```
b4fe51b fix: remove response body from cppFetch logs, harden CSP with object-src/base-uri, sanitize fatal error log (hunter-sub-leak)
```

**Zmienione pliki:** 10 (server/index.js, server/ai/trainer.js, 8 test files)  
**Testy:** 2086/2086 ✅
