# Hunter Data Leak Check v4 — Checkers_vibe
**Data:** 2026-03-23 22:30 UTC
**Agent:** hunter-sub-dataleak-v4 (subagent)
**Zakres:** /opt/Checkers_vibe — pełny audyt wycieków danych (re-check)

---

## 🔴 Krytyczne Znalezienie

### LEAK-V4-001: GitHub PAT w git remote URL (KRYTYCZNY)
- **Severity:** 🔴 krytyczny
- **Plik:** `.git/config` (remote.origin.url)
- **Opis:** Git remote URL zawierał personalny token dostępu (PAT): `[REDACTED]`. Token był zapisany w formacie `https://x-access-token:<TOKEN>@github.com/...`. Każdy z dostępem do tego pliku mógł sklonować repozytorium z pełnymi uprawnieniami właściciela.
- **Status:** ✅ **NAPRAWIONE** — URL zmieniony na `https://github.com/ArgonZapan/Checkers_vibe.git` (token usunięty)
- **⚠️ PILNE:** Token `[REDACTED]` powinien zostać **natychmiast unieważniony (revoked)** w ustawieniach GitHub → Developer settings → Personal access tokens. Token mógł być używany przez inne tooly/CI — sprawdź czy nadal działa.
- **Nie trafił do git history** — potwierdzone `git log -p --all | grep -c '[REDACTED]'` = 0

---

## Podsumowanie

| Kategoria | Status | Znaleziono |
|-----------|--------|------------|
| 🔴 GitHub PAT w remote URL | 🔴 Krytyczny (naprawiony) | 1 |
| Hardcoded secrets/keys/tokens w kodzie | ✅ Czysto | 0 |
| .env files committed | ✅ Brak (w .gitignore) | 0 |
| .pem/.key files committed | ✅ Brak | 0 |
| Git history leaks | ✅ Czysto (PAT nie w historii) | 0 |
| .gitignore completeness | ✅ Kompletne | 0 |
| Sensitive logging (server/index.js) | ✅ Czysto | 0 |
| config.js secrets | ✅ Czysto (tylko domyślne wartości) | 0 |

---

## Szczegóły Skanowania

### 1. Hardcoded Secrets w kodzie źródłowym
- Przeszukano wszystkie `.js`, `.json`, `.html`, `.cpp` pliki (poza `node_modules/`)
- Wzorce: `api_key`, `secret`, `password`, `token`, `bearer`, `authorization`, `credentials`, `private_key`, `AKIA`, `ghp_`, `sk-`
- **Wynik:** ✅ Brak hardcoded sekretów w kodzie źródłowym

### 2. .env Files
- Sprawdzono `find` + `git ls-files` + `.gitignore`
- **Wynik:** ✅ Brak `.env` plików w repo. `.gitignore` zawiera: `.env`, `.env.*`, `.env.local`, `.env.*.local`, `.npmrc`, `*.pem`, `*.key`, `secrets/`, `credentials/`

### 3. Git History
- `git log -p --all | grep -iE 'token|key|password|secret'` — przeanalizowano
- Token PAT z remote URL **nie trafił** do żadnego commita (git config to plik lokalny)
- **Wynik:** ✅ Czysto

### 4. .gitignore Completeness
```
✅ build/, *.o, *.a
✅ models/, data/ (replay buffers, model weights)
✅ backups/
✅ node_modules/, dist/
✅ .vscode/, .idea/
✅ .DS_Store, Thumbs.db
✅ *.log
✅ .env, .env.*, .env.local, .env.*.local
✅ .npmrc, *.pem, *.key
✅ secrets/, credentials/
✅ status.json
```
- **Wynik:** ✅ Kompletne — pokrywa wszystkie kategorie wrażliwych plików

### 5. server/index.js — Sensitive Logging
- Przejrzano `console.log` i `console.error` w `server/index.js`
- Loguje: socket.id, speedMode, aiMoveDelayMs, err.message (nie err.stack)
- **Nie loguje:** haseł, tokenów, request body, parametrów modelu z danymi wejściowymi
- **Wynik:** ✅ Czysto — żadnych wrażliwych danych w logach

### 6. Poprzednie Raporty — Status

| Raport | Znalezienia | Status |
|--------|-------------|--------|
| `hunter-dataleak-report.md` (v1) | 11 problemów (security headers, rate limit, CORS, etc.) | ✅ Wszystkie naprawione |
| `hunter-dataleak-report-v2.md` | Re-check — C++ binding, backup files | ✅ Naprawione |
| `hunter-dataleak-report-v3.md` | Stack traces, sensitive logging, CSP | ✅ Czysto |
| `HUNTER-SECURITY-REPORT.md` | SEC-001 (X-Powered-By), SEC-002 (params logging) | ✅ Naprawione (app.disable('X-Powered-By') + selective logging) |

---

## Rekomendacje

### 🔴 Pilne
1. **Unieważnij token `[REDACTED]`** — GitHub → Settings → Developer settings → Personal access tokens → Revoke. Token był w `.git/config` i mógł być skompromitowany.

### 🟡 Zalecane
2. **Używaj SSH keys zamiast PAT** do git remote — `git@github.com:ArgonZapan/Checkers_vibe.git` — eliminuje ryzyko wycieku tokena w plikach konfiguracyjnych.
3. **Automatyczne czyszczenie starych backupów** — `backups/` rośnie, mimo że jest w `.gitignore`. Rozważyć retention policy (np. max 3 dni).
4. **socket.id w logach** — kosmetyczne, ale można obciąć do prefixu 8 znaków dla prywatności.

### ✅ Dobre praktyki już zastosowane
- CSP, rate limiting, security headers — wszystko na miejscu
- Brak hardcoded sekretów w kodzie
- .gitignore kompletne
- Generic error messages (brak stack traces)

---

## Commit

- `fix: remove GitHub PAT from git remote URL (hunter-sub-dataleak-v4)`
