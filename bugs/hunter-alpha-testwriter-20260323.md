# Hunter Alpha — Test Writer Report
**Date:** 2026-03-23  
**Agent:** test-writer (hunter-sub-testwriter)

## Summary

Znaleziono **6 głównych luk** w pokryciu testowej. Napisano **6 nowych plików testowych** z **238 testami** (wszystkie przechodzą).

## Nowe pliki testowe

| Plik | Testy | Moduł | Opis |
|------|-------|-------|------|
| `hunter-alpha-minimax-core.test.js` | 50 | `minimax.js` | **Zero coverage before.** evaluate, applyMove, generateLegalMoves, minimaxSearch — piece values, promotion, captures, multi-capture, edge pawns, king movement, alpha-beta pruning |
| `hunter-alpha-validate-move.test.js` | 58 | `trainer.js` | validateMove (null/undefined/NaN/Infinity/boundary coords), isMoveLegal, _validateAndFallback — all edge cases |
| `hunter-alpha-reward-edge.test.js` | 32 | `trainer.js` | calcMaterial, calcPosition, calcThreat, calcAdvance, calcTempo, calculateReward — boundary boards, strategy differences, symmetry |
| `hunter-alpha-model-tensor.test.js` | 23 | `model.js` | buildInputArray (all piece types, invalid inputs, 2D/flat, turn encoding), computePolicyIndex (all 4 directions, invalid) |
| `hunter-alpha-config-speed-edge.test.js` | 27 | `config.js` | moveDelayMs/animationStepDurationMs getters (fast/normal, boundaries), CONFIG.ai validation (weights sum, gamma, epsilon ranges), speed mode transitions |
| `hunter-alpha-trainer-state.test.js` | 48 | `trainer.js` | SelfPlay constructor defaults, getStatus, setParams (NaN/Infinity/boundary epsilon), setModelParams (batchSize clamp), restart, paramsVersion race guard, dirty flag lifecycle |

## Znalezione bugi

### BUG-001: calcPosition odwrócone scoring dla czarnych pionów
- **Severity:** Średni
- **Plik:** `server/ai/trainer.js` → `calcPosition()`
- **Opis:** Formuła `advance = turn === 1 ? row : (7 - row)` dla czarnych pionów daje wyższą wartość pionom bliżej wiersza startowego (row 1→6) niż bliżej promocji (row 6→1). Piony czarne powinny awansować w stronę row 7, ale formuła premiuje cofanie się.
- **Impact:** Trening AI czarnych pionów jest zniekształcony — model nie uczy się prawidłowego awansu.

### BUG-002: isMoveLegal akceptuje ruch bez captures gdy legalny ruch ma captures
- **Severity:** Niski
- **Plik:** `server/ai/trainer.js` → `isMoveLegal()`
- **Opis:** Gdy `move.captures` jest `undefined/null/puste`, funkcja nie sprawdza czy ruch legalny wymaga captures. Zwraca `true` mimo niedopasowania.
- **Impact:** Może pozwolić na nieprawidłowe dopasowanie ruchów w edge case'ach.

### BUG-003: buildInputArray traktuje nieprawidłowe kody figur (>4) jako czarne piony
- **Severity:** Niski
- **Plik:** `server/ai/model.js` → `buildInputArray()`
- **Opis:** Wartość `5` (lub dowolna >4, nie-biała) ląduje w kanale czarnych (`input[base+2] = 1`) zamiast być odfiltrowana. Brak walidacji `val` w zakresie 0-4.
- **Impact:** Dane treningowe z nieprawidłowymi kodami figur będą cicho zanieczyszczone.

### BUG-004: validateMove nie weryfikuje zakresu kolumny w formacie tablicowym
- **Severity:** Niski
- **Plik:** `server/ai/trainer.js` → `validateMove()`
- **Opis:** `[0, 8]` normalizuje się do skalarnej wartości 8, która przechodzi walidację zakresu 0-63. Kolumna 8 jest poza zakresem 0-7, ale nie jest wykrywana.
- **Impact:** Minimalny — C++ engine odrzuci nieprawidłowe koordynaty.

## Luki w pokryciu (już istniejące testy)

Przed tym cyklem:
- **minimax.js**: 0 testów dedicated (teraz: 50)
- **validateMove/isMoveLegal**: pośrednio testowane (teraz: 58 dedicated)
- **Reward helpers**: częściowo pokryte (teraz: 32 edge case tests)
- **buildInputArray**: 2 testy (teraz: 23 z boundary)
- **Config speed helpers**: podstawowe testy (teraz: 27 z edge cases)
- **Trainer state**: pokryte ale bez edge case'ów (teraz: 48 z boundary)

## Nadal słabo pokryte

- `proxy.js` → `setupProxy()` — brak testów integracyjnych z `http-proxy-middleware`
- `server/index.js` → WebSocket event handlers (wymaga mock Socket.IO)
- `SelfPlay._loop()` / `_playGame()` — pętle asynchroniczne, trudne do testowania bez mock engine
- `saveModel()` / `loadModel()` — wymaga TF.js i filesystem
