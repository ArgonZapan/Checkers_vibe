# Hunter Data Leak Check — Checkers_vibe
**Data:** 2026-03-23
**Agent:** Hunter Alpha (data-leak-checker)
**Zakres:** /opt/Checkers_vibe — audyt bezpieczeństwa

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| Hardcoded secrets/keys/tokens | ✅ Czysto | 0 |
| .env / .gitignore | ✅ Poprawnie skonfigurowane | 0 |
| HTTP security headers | ⚠️ Brak | 1 |
| Rate limiting | ⚠️ Brak | 1 |
| CORS misconfiguration | ⚠️ Częściowy | 1 |
| Server binding | ⚠️ 0.0.0.0 | 1 |
| WebSocket validation | ⚠️ Brak type-check na setParams | 1 |
| Config mutation | ⚠️ Brak sanityzacji | 1 |
| Training endpoint | ⚠️ Brak walidacji batch structure | 1 |
| Proxy logging | ⚠️ Leaking request bodies | 1 |
| Sensitive logging | ⚠️ socket.id w logach | 1 |

**Ogólny werdykt:** Brak krytycznych wycieków sekretów, ale kilka ważnych braków w walidacji i konfiguracji bezpieczeństwa.

---

## Szczegóły

### LEAK-001: Brak HTTP security headers
- **Severity:** ważny
- **Plik:** server/index.js:28
- **Opis:** Brak nagłówków bezpieczeństwa (X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, Content-Security-Policy, X-XSS-Protection). Express serve'uje statyczne pliki i JSON bez żadnych zabezpieczeń HTTP.
- **Fix:** Dodać middleware ustawiające security headers.

### LEAK-002: Brak rate limiting
- **Severity:** ważny
- **Plik:** server/index.js:28 (cały serwer)
- **Opis:** Żaden endpoint HTTP ani WebSocket nie ma rate limiting. `/api/ai/predict`, `/api/ai/train`, WebSocket `move` events mogą być floodowane. Brak ochrony przed DoS.
- **Fix:** Dodać proste rate limiting middleware (in-memory, bez zewnętrznych pakietów).

### LEAK-003: Server binduje na 0.0.0.0
- **Severity:** ważny
- **Plik:** server/index.js:659
- **Opis:** `httpServer.listen(PORT)` binduje na wszystkich interfejsach (0.0.0.0), eksponując serwer na zewnątrz. Dla aplikacji dev/localhost to niepożądane.
- **Fix:** Bindować na `127.0.0.1` lub dać konfigurację `HOST` z env.

### LEAK-004: CORS tylko na Socket.IO, brak na Express
- **Severity:** kosmetyczny
- **Plik:** server/index.js:22
- **Opis:** CORS origin jest skonfigurowane tylko dla Socket.IO, ale Express HTTP endpoints (`/api/ai/*`, `/api/selfplay/*`) nie mają żadnej CORS polityki. Mogą być wywoływane cross-origin bez ograniczeń.
- **Fix:** Dodać CORS middleware dla Express (opcjonalne — dla dev OK, ale warto mieć).

### LEAK-005: Brak type-check na `setParams` WebSocket event
- **Severity:** ważny
- **Plik:** server/index.js:411
- **Opis:** `socket.on('setParams', async (newParams) => ...)` — `newParams` nie jest weryfikowane jako obiekt. Przekazanie stringa, array, null lub innej wartości mogłoby spowodować nieoczekiwane zachowanie. `Object.assign` w `setModelParams` nie waliduje typów.
- **Fix:** Dodać walidację `typeof newParams !== 'object' || Array.isArray(newParams)` na wejściu.

### LEAK-006: Config mutation bez sanityzacji
- **Severity:** ważny
- **Plik:** server/index.js:484-487 (setSpeed), 494-498 (setSpeedMode)
- **Opis:** `setSpeed` i `setSpeedMode` bezpośrednio mutują obiekt `CONFIG.server`. Chociaż wartości są clampowane, mutacja globalnego config obiektu przez WebSocket bez auth jest ryzykowna. Każdy podłączony klient może zmienić prędkość.
- **Fix:** Dodać walidację typeof przed mutacją.

### LEAK-007: Training endpoint akceptuje dowolny batch od klienta
- **Severity:** ważny
- **Plik:** server/index.js:68
- **Opis:** `/api/ai/train` akceptuje `req.body.batch` — tablicę dowolnych obiektów. Chociaż jest limit 10000 samples, brak walidacji struktury każdego sample. Crafted obiekty z `chosenMove`, `board`, `legalMoves` mogą zawierać nieprzewidywalne dane.
- **Fix:** Dodać podstawową walidację struktury batch samples.

### LEAK-008: Proxy loguje body requestów
- **Severity:** kosmetyczny
- **Plik:** server/proxy.js:35
- **Opis:** `console.log` w `proxyReq` loguje URL i method, ale nie body. Poprzedni fix (hunter-sub-bugfinder) naprawił `_proxyReq.end()`. Brak wycieku, ale logowanie jest verbose.
- **Fix:** Brak (już poprawione).

### LEAK-009: Socket.id logowane w console
- **Severity:** kosmetyczny
- **Plik:** server/index.js:291, 327, 389, 395, 405, 440, 505
- **Opis:** `socket.id` jest logowane w wielu miejscach. Socket.id to losowy string używany do identyfikacji sesji WebSocket — nie jest tosecret, ale może pomóc w korelacji aktywności użytkownika.
- **Fix:** Usunąć socket.id z logów lub obciąć do prefixu.

### LEAK-010: Brak walidacji captures w move handler
- **Severity:** kosmetyczny
- **Plik:** server/index.js:363-368
- **Opis:** `captures` array jest walidowane tylko na `Array.isArray`, ale elementy nie są sprawdzane jako koordynaty `[row, col]`. Mogą zawierać arbitrary dane.
- **Fix:** Dodać walidację elementów captures.

### LEAK-011: Brak Content-Security-Policy na statycznych plikach
- **Severity:** kosmetyczny
- **Plik:** client/dist/index.html
- **Opis:** `index.html` nie ma meta CSP. Inline scripts nie istnieją (dobrze — bundle jest external), ale brak CSP pozwala na XSS przez injected content.
- **Fix:** Dodać CSP header w Express static middleware.

---

## Testy — Sekrety

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens/passwords | ✅ Brak |
| .env files in repo | ✅ Brak (w .gitignore) |
| .pem/.key files | ✅ Brak (tylko node_modules test) |
| process.env exposure | ✅ Tylko PORT i CORS_ORIGIN |
| WebSocket transmituje secrets | ✅ Brak |
| config.js zawiera secrets | ✅ Brak (tylko domyślne wartości) |

## Testy — Walidacja Wejścia

| Check | Result |
|-------|-------|
| SQL injection | ✅ N/A (brak SQL) |
| XSS | ✅ N/A (backend JSON API, nie renderuje HTML) |
| Command injection | ✅ Brak (brak exec/eval) |
| Prototype pollution | ✅ Brak (nie ma __proto__ assignments) |
| SSRF via proxy | ✅ Proxy targetuje tylko localhost:8080, filter odfiltruje AI routes |

---

## Commit

Fixy zastosowane:
1. Security headers middleware
2. Basic rate limiting dla HTTP i WebSocket
3. Host binding na 127.0.0.1
4. Type-check na setParams
5. Walidacja captures elements
6. Walidacja batch structure w train
