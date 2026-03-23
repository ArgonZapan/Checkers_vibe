# Hunter BugFinder Report — Checkers_vibe

**Scan date:** 2026-03-23 12:55 UTC
**Scope:** Runtime bugs, edge cases, logic errors
**Files scanned:** server/index.js, server/proxy.js, server/boardConvert.js, server/ai/trainer.js, server/ai/model.js, server/ai/buffer.js, config.js, client/src/*.jsx

---

### BUG-001: boardFromCpp nie waliduje długości flat array
- **Severity:** ważny
- **Plik:** server/boardConvert.js, linia 25-31
- **Kroki odtworzenia:**
  1. Wywołaj `boardFromCpp([1, 2, 3])` — flat array z mniej niż 64 elementami
  2. Pętla `for (let r = 0; r < 8; r++)` slicuje `cppBoard.slice(r*8, r*8+8)` — dla r≥1 zwraca puste tablice
  3. Wynikowa tablica 2D ma jagged shape (rows 0-3 z elementami, rows 4-7 puste)
  4. React Board component dostaje `board[row][col]` = `undefined` dla pustych rows → potencjalny crash
- **Oczekiwane:** Funkcja powinna odrzucić niepoprawne dane wejściowe i zwrócić pustą planszę z ostrzeżeniem.
- **Rzeczywiste:** Cicha akceptacja za krótkich tablic → generuje planszę z undefined wartościami.
- **Propozycja fixu:** Dodaj walidację `flat.length !== 64` przed konwersją.

### BUG-002: proxy.js — pathRewrite przywraca prefix który Express już obsłużył (działa ale redundantny)
- **Severity:** kosmetyczny
- **Plik:** server/proxy.js, linia 11
- **Kroki odtworzenia:** (statyczny — widoczny w kodzie)
- **Oczekiwane:** `pathRewrite` powinno być jasne w intencji lub usunięte.
- **Rzeczywiste:** `pathRewrite: { '^': '/api' }` — Express mount na `/api` stripuje prefix, proxy widzi `/game/state`. Rewrite zamienia `''` → `'/api'` dając `/api/game/state`. To faktycznie działa poprawnie (przywraca prefix), ale jest nieoczywiste i może być źródłem pomyłek przy zmianach.
- **Propozycja fixu:** Dodaj komentarz wyjaśniający intencję lub uprość.

### BUG-003: setParams WebSocket nie broadcastuje per-side networkSize do klienta
- **Severity:** kosmetyczny
- **Plik:** server/index.js, handler `setParams` (linia ~267)
- **Kroki odtworzenia:**
  1. Otwórz ParamsPanel → zakładka "Białe" → zmień sieć na "large"
  2. Server przyjmuje zmianę, `trainer.networkSizeWhite = 'large'`, tworzy nowe modele
  3. Server broadcastuje `paramsUpdate` z `modelParams` ale BEZ `whiteNetworkSize`/`blackNetworkSize`
  4. Klient nie aktualizuje `params.whiteNetworkSize` → dropdown może pokazywać starą wartość po reconnect
- **Oczekiwane:** `paramsUpdate` powinno zawierać `whiteNetworkSize`/`blackNetworkSize`.
- **Rzeczywiste:** Pola nieobecne w broadcast → desynchronizacja UI po reconnect.
- **Propozycja fixu:** Dodaj `whiteNetworkSize`/`blackNetworkSize` do broadcastowanego `paramsUpdate`.

### BUG-004: Błędny komentarz PIECE_VALUE w trainer.js
- **Severity:** kosmetyczny
- **Plik:** server/ai/trainer.js, linia ~40
- **Opis:** Komentarz `{ white pawn=1, white king=3, black pawn=3(val=1), black king=4(val=3) }` sugeruje że black pawn ma wartość 3, ale `PIECE_VALUE[3] = 1`. Wartość 3 to encoding C++ (piece type), nie wartość punktowa. Komentarz myli encoding z wartością.
- **Propozycja fixu:** Popraw komentarz na `{ 1: white pawn=1, 2: white king=3, 3: black pawn=1, 4: black king=3 }`.

---

## Summary

| # | Severity | Description | Fixed |
|---|----------|-------------|-------|
| 001 | ważny | boardFromCpp missing flat array length validation | ✅ |
| 002 | kosmetyczny | proxy.js redundant/unclear pathRewrite | ✅ |
| 003 | kosmetyczny | setParams missing per-side networkSize broadcast | ✅ |
| 004 | kosmetyczny | Wrong PIECE_VALUE comment | ✅ |

**Total: 4 bugs (1 ważny, 3 kosmetyczne). 0 krytycznych.**

The codebase is well-structured with good error handling, validation, and race condition guards (#102, #120, #121, #124, #133 issues are properly addressed). Buffer ring logic, model tensor encoding, and policy index computation are all correct.
