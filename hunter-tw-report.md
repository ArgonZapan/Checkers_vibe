# Hunter TW — Raport Testów Regresyjnych

**Data:** 2026-03-24  
**Agent:** Hunter Alpha (subagent: hunter-sub-tw)  
**Zadanie:** Napisanie testów regresyjnych dla 5 zgłoszonych issue

---

## Podsumowanie

| Issue | Opis | Testów | Status |
|-------|------|--------|--------|
| #154 | Board areEqual — nie sprawdza turn | 6 | ✅ |
| #146 | undoLastMove type mismatch (size_t) | 8 | ✅ |
| #156 | handleToggleSelfplay stale closure | 6 | ✅ |
| #151 | multiCapture buffer overflow przy promocji | 7 | ✅ |
| #142 | epsilon validation — non-numeric | 25 | ✅ |
| **Razem** | | **52** | **✅ 52/52** |

---

## Plik testowy

**`__tests__/hunter-tw-issues154-146-156-151-142.test.js`**  
52 testów, zarejestrowanych w `__tests__/run.js` jako `hunterTwIssues154-146-156-151-142`.

---

## Szczegóły per Issue

### #154: areEqual — turn check (6 testów)

Testy weryfikują, że `areEqual()` w `Board.jsx` zwraca `false` gdy `turn` się różni, co wymusza re-render komponentu Board.

- `turn` white→black → `false` ✅
- `turn` black→white → `false` ✅
- `turn` unchanged → `true` ✅ (both colors)
- Turn change alongside captures → `false` ✅
- Turn checked before board reference comparison ✅

**Bug scenario:** Gdyby `areEqual` pominęło porównanie `turn`, Board nie odświeżałby się przy zmianie tury — gracz widziałby "Tura: Białe" gdy faktycznie grają Czarne.

---

### #146: undoLastMove — size_t boundaries (8 testów)

Testy weryfikują edge case'y typu `size_t` w pętli undoLastMove.

- Empty history → returns `false` (no crash) ✅
- Single element undo ✅
- Loop index `i = 0; i > 0` nie wchodzi do pętli (nie ma wrap do SIZE_MAX) ✅
- Wielokrotne undo do zera + jeden więcej → `false` ✅
- Undo z captures — poprawne przejście historii ✅
- `numCaptures` (int) mieści się w MAX_CAPTURES=12 ✅
- `capturedKingsMask` (uint16_t) mieści 12 bitów → max 4095 < 65535 ✅
- Granica uint16_t: MAX_CAPTURES ≤ 16 ✅

**Bug scenario:** Gdyby pętla używała `for (size_t i = size - 1; ...)` zamiast `for (size_t i = size; i > 0; i--)`, pusta historia powodowała underflow `0 - 1 = SIZE_MAX` → crash/nieskończona pętla.

---

### #156: handleToggleSelfplay stale closure (6 testów)

Testy symulują mechanizm `useRef` zamiast `useState` do odczytu stanu self-play.

- 4 szybkie toggle → alternating `[start, stop, start, stop]` ✅
- Ref poprawnie aktualizuje się po każdym toggle ✅
- 100 toggle → dokładnie 50 start + 50 stop ✅
- Nieparzysta liczba toggle → active=true ✅
- Toggle po zewnętrznej synchronizacji stanu ✅
- Demonstracja buga: wersja bez ref generuje same `startSelfPlay` ✅

**Bug scenario:** Bez `useRef`, szybkie klikanie "Start/Stop Self-Play" w React powodowało, że `useCallback` przechwytywał stary stan → np. dwa `stopSelfPlay` zamiast `stop`→`start`.

---

### #151: multiCapture buffer overflow przy promocji (7 testów)

Testy weryfikują clamping `captures` i `path` do `MAX_CAPTURES` (12) / `MAX_PATH` (13).

- 20 captures → clamped do 12 ✅
- Wersja bugowa (bez clampa) pozwala na 20 captures ✅ (demonstracja)
- Realistyczny multi-capture z promocją (3 captures, 4 path) ✅
- Dokładnie MAX_CAPTURES captures → dozwolone ✅
- MAX_CAPTURES+1 captures → clamped ✅
- Path clamped niezależnie od captures ✅
- `capturedKingsMask` używa tylko bitów 0..11 ✅

**Bug scenario:** Pawn przechodzi przez 13+ pól (captures + promotion). Bez clampa, `m.captures[i]` zapisywane poza tablicą `Square captures[12]` → buffer overflow w C++.

---

### #142: epsilon validation — non-numeric (25 testów)

Najobszerniejsza grupa. Weryfikuje odrzucanie WSZYSTKICH nie-numerycznych typów.

- **Zaakceptowane:** `null`, `undefined`, `0`, `1`, `0.5`, `-0` ✅
- **Odrzucone:** string `"0.5"`, `""`, `"NaN"`... (19 cases) ✅
- **Odrzucone:** `true`, `false` ✅
- **Odrzucone:** `{}`, `[]`, `() => {}`, `Symbol`, `BigInt`, `Date`, `new Number()`, `Map`, `Set` ✅
- **Odrzucone:** `NaN`, `Infinity`, `-Infinity`, `-0.5`, `1.5` ✅
- **JSON body:** `{"epsilon":"0.5"}` → odrzucone; `{"epsilon":0.5}` → zaakceptowane ✅
- **Dwa testy demonstrujące buga:** wersja walidacji bez `typeof` akceptuje `"0.5"` i `true` ✅

**Bug scenario:** Bez sprawdzania `typeof epsilon !== 'number'`, string `"0.5"` przechodzi walidację bo `"0.5" < 0` → `false` i `"0.5" > 1` → `false` (leksykograficzne porównanie). Następnie `Math.max(MIN, "0.5" - DECAY)` → `NaN` na epsilonie.

---

## Commit

```
fix: testy regresyjne dla #154,#146,#156,#151,#142 (hunter-sub-tw)
```

---

## Pełny wynik testów

```
Total: 3201 | ✅ 3201 passed | ❌ 0 failed
🎉 All tests passed!
```

52 nowe testy + 3149 istniejące = 3201 total, wszystkie zielone.
