# Hunter Data Leak Check v2 — Checkers_vibe
**Data:** 2026-03-23  
**Agent:** Hunter Alpha (data-leak-checker, subagent)  
**Zakres:** /opt/Checkers_vibe — pełny audyt bezpieczeństwa (re-check po fixach)

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| Hardcoded secrets/keys/tokens | ✅ Czysto | 0 |
| .env / credentials in repo | ✅ Czysto (w .gitignore) | 0 |
| Git history — secrets | ✅ Czysto | 0 |
| HTTP security headers | ✅ Naprawione (LEAK-001) | 0 |
| Rate limiting | ✅ Naprawione (LEAK-002) | 0 |
| Server binding | ✅ Naprawione (LEAK-003) — 127.0.0.1 | 0 |
| WebSocket setParams validation | ✅ Naprawione (LEAK-005) | 0 |
| setSpeed/setSpeedMode auth | ✅ Naprawione (LEAK-006) | 0 |
| Training batch validation | ✅ Naprawione (LEAK-007) | 0 |
| Captures validation | ✅ Naprawione (LEAK-010) | 0 |
| C++ engine binding | ⚠️ 0.0.0.0 (minor) | 1 |
| Backup files — data exposure | ⚠️ state.json w backups/ (minor) | 1 |
| socket.id w logach | ℹ️ Kosmetyczny | 1 |

**Ogólny werdykt:** Wszystkie krytyczne i ważne problemy z poprzedniego raportu zostały naprawione. Pozostały 2 drobne uwagi i 1 kosmetyczna.

---

## Szczegóły

### LEAK-013: C++ engine binduje na 0.0.0.0
- **Severity:** minor
- **Plik:** `engine/src/main.cpp:17`
- **Opis:** C++ backend (httplib) binduje na `0.0.0.0:8080`. Chociaż Node.js proxy targetuje tylko `localhost:8080`, sam C++ serwer jest dostępny na wszystkich interfejsach sieciowych. Jeśli maszyna ma publiczny IP, port 8080 może być dostępny z zewnątrz.
- **Fix:** Zmienić na `svr.listen("127.0.0.1", 8080)` — C++ engine nie musi być dostępny z zewnątrz.

### LEAK-014: Backup files zawierają stan treningowy
- **Severity:** minor
- **Plik:** `backups/20260323/data/state.json`, `backups/20260323/data/buffer.json`
- **Opis:** Katalog `backups/` zawiera pliki `state.json` (statystyki gier, epsilon) i `buffer.json` (replay buffer). Nie zawierają sekretów/tokenów, ale `buffer.json` może być duży i zawierać dane modelu (stany plansz, nagrody). Pliki są poprawnie w `.gitignore`, więc nie trafią do repo.
- **Fix:** Brak (już poprawnie skonfigurowane w .gitignore). Można rozważyć automatyczne czyszczenie starych backupów.

### INFO: socket.id w logach (kosmetyczne)
- **Severity:** kosmetyczny
- **Plik:** `server/index.js` — wielokrotnie (`[WS] Client connected: ${socket.id}`, itp.)
- **Opis:** `socket.id` jest logowane w wielu miejscach. To losowy string identyfikujący sesję WebSocket — nie jest sekretem, ale może pomóc w korelacji aktywności. Praktycznie bez znaczenia.
- **Fix:** Brak konieczności (niski priorytet).

---

## Audit — Sekrety (re-check)

| Check | Result |
|-------|--------|
| Hardcoded API keys/tokens/passwords | ✅ Brak |
| .env files in repo | ✅ Brak (w .gitignore) |
| .pem/.key files | ✅ Brak |
| process.env exposure | ✅ Tylko PORT, HOST, CORS_ORIGIN, TF_ENABLE_ONEDNN_OPTS |
| WebSocket transmituje secrets | ✅ Brak |
| config.js zawiera secrets | ✅ Brak |
| Git history — committed secrets | ✅ Brak (przeszukano log + stash) |
| Git stash — secrets | ✅ Brak (3 stashy, czyste) |

## Audit — Walidacja Wejścia (re-check)

| Check | Result |
|-------|-------|
| SQL injection | ✅ N/A (brak SQL) |
| XSS | ✅ N/A (backend JSON API, CSP header) |
| Command injection | ✅ Brak (brak exec/eval) |
| Prototype pollution | ✅ Whitelist na setParams (LEAK-011) |
| SSRF via proxy | ✅ Proxy targetuje tylko localhost:8080 |
| Input validation — moves | ✅ Koordynaty 0-7, captures validated |
| Input validation — params | ✅ Whitelist + range checks + type checks |
| Input validation — train batch | ✅ Full sample validation |

## Audit — HTTP Headers (re-check)

| Header | Status |
|--------|--------|
| X-Powered-By | ✅ Wyłączony (双重防御) |
| X-Content-Type-Options | ✅ nosniff |
| X-Frame-Options | ✅ DENY |
| X-XSS-Protection | ✅ 0 (wyłączony — poprawnie, nowoczesne przeglądarki) |
| Referrer-Policy | ✅ strict-origin-when-cross-origin |
| Permissions-Policy | ✅ camera=(), microphone=(), geolocation=() |
| Content-Security-Policy | ✅ default-src 'self'; script-src 'self'; ... |

---

## Commit

Brak commitów — wszystkie ważne fixy zostały już zastosowane w poprzedniej rundzie (hunter-sub-bugfinder i hunter-dataleak-checker). Pozostałe uwagi to minor/kosmetyczne.
