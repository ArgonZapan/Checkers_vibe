# Raport Audytu Bezpieczeństwa — Hunter Alpha (Data Leak Checker)

**Projekt:** Checkers_vibe
**Data:** 2026-03-23
**Audytor:** Jarvis Horner (data-leak-checker)
**Zakres:** server/index.js, server/proxy.js, config.js, client/vite.config.js, .gitignore, git history

---

## Podsumowanie

| Kategoria | Status | Znalezione problemy |
|---|---|---|
| Secrets/credentials leaks | ✅ Czysto | 0 |
| CSP headers | ✅ Dobrze skonfigurowany | 1 niski priorytet |
| Input validation | ✅ Solidna | 2 niski priorytet |
| File exposure | ✅ Brak wycieków | 0 |
| Rate limiting | ✅ Działa poprawnie | 1 niski priorytet |
| Proxy/SSRF | ✅ Bezpieczny | 0 |

**Ogólna ocena: DOBRA** — projekt przeszedł wcześniej audyt (commit `005cd75`), który naprawił kluczowe problemy (CORS wildcard, error leaking, .gitignore). Obecny stan jest bezpieczny.

---

## Szczegółowe znaleziska

### LEAK-001: Brak autentykacji WebSocket — każdy klient może kontrolować serwer | Niski | server/index.js | Fix: Dodać token auth lub ograniczyć self-play controls do localhost

**Opis:** WebSocket (`io.on('connection')`) nie wymaga żadnej autentykacji. Każdy klient który połączy się z serwerem może:
- Uruchomić/zatrzymać self-play (`startSelfPlay`, `stopSelfPlay`)
- Zmieniać parametry modelu (`setParams`, `setSpeed`, `setSpeedMode`)
- Resetować model (`reset`)
- Rozpoczynać gry (`startGame`)

**Kontekst:** Serwer nasłuchuje na `127.0.0.1` (domyślnie), więc to nie jest krytyczne w deployment localhost. Ale jeśli HOST zostanie zmieniony na `0.0.0.0`, każdy w sieci może kontrolować AI.

**Fix:** Dodać token autentykacji w WebSocket handshake lub ograniczyć kontrolne eventy do trybu aivai (częściowo już zrobione — `setParams`, `setSpeed` wymagają aivai).

---

### LEAK-002: `style-src 'unsafe-inline'` w CSP — potencjalny wektor XSS | Niski | server/index.js:33 | Fix: Usunąć 'unsafe-inline' i użyć nonce/hash

**Opis:** Content-Security-Policy zawiera `style-src 'self' 'unsafe-inline'`, co pozwala na inline CSS. W połączeniu z ewentualnym bugiem renderowania, atakujący mógłby wstrzyknąć style, które np. przekierowują kliknięcia (clickjacking via CSS). Niskie ryzyko bo `frame-ancestors 'none'` blokuje iframe embedding.

**Fix:** Przejść na CSP nonce-based lub hash-based dla styli.

---

### LEAK-003: Rate limiter in-memory — resetuje się po restarcie serwera | Niski | server/index.js:38-64 | Fix: Rozważyć Redis-backed rate limiting dla production

**Opis:** `_rateLimitMap` to `Map()` w pamięci. Po restarcie serwera (lub crash) limity się zerują, co pozwala na burst requestów tuż po starcie. Dodatkowo cleanup interval (`setInterval`) jest tworzony ale `RATE_LIMIT_MAX_ENTRIES` jest zdefiniowany PO jego użyciu (hoisting nie działa z `const`). To nie jest bug w runtime (Map.get() na nieistniejącym key zwraca undefined, a `RATE_LIMIT_MAX_ENTRIES` jest dostępne w closure), ale jest to code-smell.

**Fix:** Dla production rozważyć Redis lub inny persistent store. Przenieść definicję `RATE_LIMIT_MAX_ENTRIES` przed `setInterval`.

---

### LEAK-004: Walidacja `legalMoves` w API predict — brak sprawdzenia elementów tablicy | Niski | server/index.js:69-73 | Fix: Dodać walidację struktury legalMoves

**Opis:** Endpoint `/api/ai/predict` waliduje `board` (64 elementy, integer 0-4), ale nie waliduje `legalMoves`. Wysłanie `legalMoves` z nieprawidłową strukturą może spowodować crash w funkcji `predict()`.

```javascript
if (!board || !legalMoves) { ... }  // tylko null/undefined check
// brak: Array.isArray(legalMoves) lub walidacji struktury ruchów
```

**Fix:** Dodać `if (!Array.isArray(legalMoves)) return res.status(400)...`

---

### LEAK-005: WebSocket `paramsUpdate` wysyła wewnętrzną konfigurację AI do klienta | Niski | server/index.js (sekcja connection) | Fix: Usunąć `_config: CONFIG.ai` z emit

**Opis:** Przy nowym połączeniu WebSocket, serwer wysyła `_config: CONFIG.ai` — pełną konfigurację treningową AI (gamma, epsilon, bufferSize, trainEpochs etc.). To nie są secrety, ale ujawnia parametry modelu. Prefiks `_` sugeruje "internal", a wysyłanie tego jest zbędne.

```javascript
socket.emit('paramsUpdate', {
  ...
  _config: CONFIG.ai,  // ← zbędne ujawnienie wewnętrznej konfiguracji
});
```

**Fix:** Usunąć `_config: CONFIG.ai` z emisji lub przefiltrować tylko potrzebne pola.

---

### LEAK-006: CORS origin z `process.env` — brak walidacji formatu | Niski | config.js:29 | Fix: Dodać walidację URL formatu

**Opis:** `corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000'` — jeśli zmienna środowiskowa zostanie ustawiona na `*` (przez pomyłkę), CORS stanie się otwarte. Brak walidacji czy wartość jest prawidłowym URL.

**Fix:** Dodać walidację: `if (corsOrigin === '*') throw new Error('CORS wildcard not allowed')`.

---

## Co jest DOBRZE ✅

- **Brak hardcoded secrets** — żadnych API keys, tokenów, haseł w kodzie ani historii git
- **CSP headers** — poprawnie skonfigurowane (default-src, script-src, frame-ancestors)
- **X-Frame-Options: DENY** — blokuje clickjacking
- **Input validation** — WebSocket move validation (coordinates 0-7), train batch validation, params validation z zakresami
- **WsThrottle** — per-socket throttle na move (50ms), setParams (1s), setSpeed (1s)
- **Prototype pollution protection** — whitelist `ALLOWED_PARAMS` w setParams
- **Proxy SSRF safe** — `target: CPP_TARGET` jest hardcoded na localhost:8080, nie można manipulować
- **Static files** — serwuje tylko `client/dist/`, nie expose'uje .git, .env, node_modules
- **Error messages sanitized** — nie leakują err.message do klienta (naprawione w commit 005cd75)
- **.gitignore** — blokuje .env, .pem, .key, secrets/, credentials/, data/
- **git history clean** — brak wcześniej committed secrets
- **express.json limit** — 1MB body limit zapobiega large payload attacks
- **Socket.IO CORS** — ograniczony do konkretnego origin (nie wildcard)
- **cppFetch timeout** — 5s timeout zapobiega hung connections
