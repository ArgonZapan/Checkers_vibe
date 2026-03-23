# Dynamic Bug Report — Move Struct Field Initialization
**Date:** 2026-03-23
**Scope:** `/opt/Checkers_vibe/engine/src/` — move generation, move execution, undo
**Pattern:** Similar to bug #136 — missing or incorrect field initialization on `struct Move`

---

## Move Struct Reference (`board.h:23`)

```cpp
struct Move {
    Square from;
    Square to;
    Square captures[MAX_CAPTURES]; // 12-element array
    int numCaptures = 0;
    bool wasKing = false;
    uint16_t capturedKingsMask = 0;
    Square path[MAX_PATH];         // 13-element array
    int numPath = 0;
    bool isCapture() const { return numCaptures > 0; }
    bool capturedKing(int i) const { return (capturedKingsMask >> i) & 1; }
    void setCapturedKing(int i) { capturedKingsMask |= (1 << i); }
};
```

Default member initializers: `numCaptures=0`, `wasKing=false`, `capturedKingsMask=0`, `numPath=0`.
Arrays `captures[]` and `path[]` are **NOT** zero-initialized (garbage in unused slots).

---

## BUG-1: `Engine::makeMove()` — `capturesEqual()` ignores `capturedKingsMask` in move matching

**File:** `engine.cpp:11-15` (helper) + `engine.cpp:61-66` (`makeMove`)
**Severity:** HIGH — needs-fix
**Status:** Active

### Problem

`Engine::makeMove()` validates incoming moves against legal moves using `capturesEqual()`:

```cpp
static bool capturesEqual(const Move& a, const Move& b) {
    if (a.numCaptures != b.numCaptures) return false;
    for (int i = 0; i < a.numCaptures; i++) {
        if (a.captures[i] != b.captures[i]) return false;
    }
    return true;
}
```

This compares only `captures[]` positions. It does **NOT** compare `capturedKingsMask`. This means:

- A move that captures a **pawn** at position X is treated as identical to a move that captures a **king** at position X.
- `Board::undoMove()` uses `capturedKingsMask` to restore captured pieces as either pawns or kings.
- If a user manually constructs a Move with the right capture positions but wrong `capturedKingsMask`, `makeMove()` would accept it, but `undoMove()` would restore the wrong piece type.

### Impact

- Wrong piece type after undo (king ↔ pawn swap)
- Corrupted board state in search engines that use undo
- Bitboard bitfields could diverge from reality

### Fix

Add `capturedKingsMask` comparison to `capturesEqual()`:
```cpp
if (a.capturedKingsMask != b.capturedKingsMask) return false;
```

---

## BUG-2: `Board::makeMove()` overwrites `capturedKingsMask` set by move generators

**File:** `board.cpp:83-91` (`makeMove`)
**Severity:** MEDIUM — design concern / needs-fix
**Status:** Active

### Problem

In `multiCapture` (movegen.cpp), the generator correctly sets `m.capturedKingsMask` based on whether captured pieces were kings. Then `Board::makeMove()` **unconditionally overwrites it**:

```cpp
move.wasKing = isKing;
move.capturedKingsMask = 0;                    // ← wipes generator's value!
for (int i = 0; i < move.numCaptures; i++) {
    Bitboard capMask = squareToMask(move.captures[i].row, move.captures[i].col);
    bool capWasKing = (whiteKings | blackKings) & capMask;
    if (capWasKing) move.setCapturedKing(i);
}
```

This is **redundant but not currently broken** because the board state at makeMove time still reflects the original pieces. However:

1. If `makeMove()` is called on a Move that was created with captures where the piece was already removed from the board (e.g., during iterative deepening with shared board), the bitboard check would miss king status.
2. The generator's `capturedKingsMask` computation is wasted work.
3. It creates a hidden dependency: the generator's correct value is silently discarded.

### Impact

- Currently benign (board state is correct at call time), but fragile
- Wasted computation in move generation
- Potential future breakage if board state diverges

### Recommendation

Either let generators own `capturedKingsMask` (and don't overwrite in makeMove), OR document that generators shouldn't set it. Currently both do, creating confusion.

---

## BUG-3: Move generators don't set `wasKing` — relies on `makeMove()` side-effect

**File:** `movegen.cpp:118-134` (generatePawnMoves), `movegen.cpp:140-157` (generateKingMoves), `movegen.cpp:162-165` (multiCapture output)
**Severity:** MEDIUM — design concern
**Status:** Active

### Problem

No move generator function sets `wasKing`. The field defaults to `false`. This is only corrected later by `Board::makeMove()` which does `move.wasKing = isKing`.

If anyone constructs a Move manually (e.g., from a UI move parser, or in `server.cpp`) and calls `undoMove()` without going through `makeMove()` first, `wasKing` would be `false`, causing `undoMove()` to:

- Restore the piece as a **pawn** instead of a king
- Corrupt the king bitboard

`undoMove()` uses `wasKing` to determine piece restoration:
```cpp
bool wasPromotion = !move.wasKing && (myKings & toMask);
// ...
if (move.wasKing) {
    myKings |= squareToMask(move.from.row, move.from.col);
} else {
    myPieces |= squareToMask(move.from.row, move.from.col);
}
```

### Impact

- Dangerous if Moves are constructed outside the generator→makeMove pipeline
- The `Engine::makeMove()` validation path rebuilds legal moves, so it gets correct `wasKing` from makeMove. But `makeMoveUnchecked()` does NOT re-validate — it trusts the caller.
- server.cpp constructs moves from JSON (`Move chosen;`) — need to verify it goes through proper pipeline.

### Fix

Either:
- Set `wasKing` in generators (requires passing board state)
- Document clearly that Moves MUST go through `makeMove()` before `undoMove()`
- Or have `makeMoveUnchecked` also set `wasKing`

---

## BUG-4: `generatePawnMoves` / `generateKingMoves` don't set `wasKing` for king pieces

**File:** `movegen.cpp:125-133` (generatePawnMoves), `movegen.cpp:147-155` (generateKingMoves)
**Severity:** LOW — mitigated by BUG-3
**Status:** Active (same root cause as BUG-3)

### Problem

`generatePawnMoves` produces moves where `wasKing` stays `false` — correct for pawns.

`generateKingMoves` produces moves where `wasKing` also stays `false` — **incorrect** for kings. The default value happens to be right for pawns but wrong for kings.

Since `makeMove()` overwrites `wasKing`, this is only a problem if the move is used elsewhere before `makeMove()`.

---

## BUG-5: Uninitialized array slots in `captures[]` and `path[]`

**File:** `movegen.cpp` — all generators
**Severity:** LOW — mitigated by `numCaptures`/`numPath` counters
**Status:** Monitoring

### Problem

`Move m;` on the stack creates a struct where `captures[]` and `path[]` array elements are **not zero-initialized** (they contain garbage). The counters `numCaptures` and `numPath` correctly limit access to only the initialized slots.

However, any code that accidentally iterates over the full array (e.g., serialization, hashing, comparison beyond counter) would read garbage.

### Impact

- Currently safe as long as consumers respect counters
- `capturesEqual()` correctly uses `numCaptures` — safe
- JSON serialization in `server.cpp` — need to verify it uses counters

### Mitigation

Could zero-initialize: `Move m = {};` or `Move m{};` instead of `Move m;`

---

## Summary Table

| Bug | Location | Field(s) | Severity | Needs Fix? |
|-----|----------|----------|----------|------------|
| BUG-1 | engine.cpp:11 | `capturedKingsMask` not compared in `capturesEqual()` | HIGH | ✅ YES |
| BUG-2 | board.cpp:83 | `capturedKingsMask` overwritten in `makeMove()` | MEDIUM | ⚠️ RECOMMENDED |
| BUG-3 | movegen.cpp (all) | `wasKing` never set by generators | MEDIUM | ⚠️ RECOMMENDED |
| BUG-4 | movegen.cpp:147 | `generateKingMoves` leaves `wasKing=false` | LOW | ⚠️ RECOMMENDED |
| BUG-5 | movegen.cpp (all) | Array slots beyond counters are garbage | LOW | 💡 NICE-TO-HAVE |

---

## Verification: No direct #136-pattern bugs found

I checked all Move creation sites:
- `generatePawnMoves` — sets from, to, path[], numPath ✅
- `generateKingMoves` — sets from, to, path[], numPath ✅
- `multiCapture` — sets from, to, captures[], numCaptures, path[], numPath, capturedKingsMask ✅

None of the generators leave required fields completely unset (like #136's missing path/numPath). The issues found are more subtle: interaction between generators and makeMove/undoMove, and one clear bug in move validation.
