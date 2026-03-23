# Hunter Sub-002: Data Leak Checker Report

**Date:** 2026-03-23  
**Branch:** main  
**Scanner:** data-leak-checker (hunter-sub-002)  
**Scope:** /opt/Checkers_vibe — secrets, credentials, XSS, SQLi, CORS, headers

---

## Summary

| Category | Status | Issues Found |
|----------|--------|:---:|
| Hardcoded API keys/tokens/passwords | ✅ Clean | 0 |
| .env files committed | ✅ Clean | 0 |
| .gitignore coverage | ✅ Good | 0 |
| XSS vulnerabilities | ✅ Clean | 0 |
| SQL injection | ✅ N/A (no SQL) | 0 |
| CORS misconfiguration | ✅ Proper | 0 |
| Security headers | ✅ Present | 0 |
| **GitHub PAT in .git/config** | **🔴 CRITICAL** | **1** |

---

## Findings

### LEAK-001: GitHub PAT w `.git/config` (CRITICAL — FIXED)

- **Severity:** krytyczny
- **Lokalizacja:** `.git/config` → `remote.origin.url`
- **Dowód:**
  ```
  remote.origin.url=https://[REDACTED]@github.com/ArgonZapan/Checkers_vibe.git
  ```
- **Opis:** GitHub Personal Access Token (PAT) jest jawny w URL zdalnego repozytorium. Każdy z dostępem do maszyny może go odczytać i użyć do push/pull na repo.
- **Naprawa:** Zmieniono URL na beztokenowy: `https://github.com/ArgonZapan/Checkers_vibe.git`. Token powinien zostać **zrotowany** na GitHubie (Settings → Developer settings → Personal access tokens).

---

## Zbadane i czyste

### 1. Hardcoded secrets w kodzie źródłowym
- `grep` po plikach `.js/.jsx/.json` z patternami: `password`, `secret`, `api_key`, `token`, `bearer`, `credential`, `BEGIN RSA`, `mongodb+srv://`
- **Wynik:** 0 trafień w kodzie źródłowym (poza node_modules i poprzednimi raportami)
- `config.js` zawiera tylko parametry gry/AI — żadnych sekretów

### 2. Pliki `.env` i credentials
- `find` na `.env*`, `*.pem`, `*.key`, `credentials/`, `secrets/`
- **Wynik:** 0 plików — `.gitignore` prawidłowo wyklucza `.env`, `.env.*`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `secrets/`, `credentials/`

### 3. XSS (server/index.js, client/index.html)
- `grep` na `innerHTML`, `dangerouslySetInnerHTML`, `eval()`, `document.write`, `.html()`
- **Wynik:** 0 trafień — React auto-escapuje output, brak `dangerouslySetInnerHTML`
- `client/index.html` zawiera tylko `<div id="root">` i `<noscript>` — czysto

### 4. SQL Injection
- **Wynik:** N/A — aplikacja nie używa SQL/bazy danych. Stan przechowywany w JSON.

### 5. CORS / Headers bezpieczeństwa
- **CORS:** `origin: CONFIG.server.corsOrigin || 'http://localhost:3000'` — prawidłowo skonfigurowane, nie `*`
- **Security headers** (server/index.js):
  - `X-Content-Type-Options: nosniff` ✅
  - `X-Frame-Options: DENY` ✅
  - `X-XSS-Protection: 0` ✅ (poprawna wartość — modern browsers)
  - `Referrer-Policy: strict-origin-when-cross-origin` ✅
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✅
- **Rate limiting:** 120 req/min per IP z cleanup interval ✅

### 6. WebSocket security
- Socket ID logowany w konsoli (identyfikator sesji, nie secret)
- Brak transmisji credentials/tokens przez WS
- Input validation na move coordinates (0-7) ✅
- Prototype pollution protection (whitelist w setParams) ✅

### 7. Data directory
- `data/state.json` — statystyki gry (gamesPlayed, wins, epsilon)
- `data/buffer.json` — replay buffer (board states, moves)
- `data/model/` — wagi sieci neuronowej
- **Żadnych PII ani credentials** — czyste dane treningowe

---

## Commit

```
fix: sanitize GitHub PAT from git remote URL (hunter-sub-002)
```
