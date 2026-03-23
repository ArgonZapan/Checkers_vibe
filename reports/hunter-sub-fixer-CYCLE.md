# hunter-sub-fixer Cycle Report

**Date:** 2026-03-23 10:23 UTC
**Agent:** hunter-sub-fixer
**Commit:** 116b9ac

## Issues Fixed

### Issue #24: Move struct — vectors → fixed arrays

Converted `Move` struct in `board.h` from `std::vector` to fixed-size C arrays with counters:
- `std::vector<Square> captures` → `Square captures[MAX_CAPTURES]` + `int numCaptures`
- `std::vector<bool> capturedKings` → `bool capturedKings[MAX_CAPTURES]` + `int numCapturedKings`
- `std::vector<Square> path` → `Square path[MAX_PATH]` + `int numPath`
- `isCapture()` now checks `numCaptures > 0`
- Removed `#include <vector>` from `board.h`

**Files updated:**
- `engine/src/board.h` — Move struct definition
- `engine/src/board.cpp` — makeMove/undoMove: indexed loops instead of range-for
- `engine/src/engine.cpp` — custom `capturesEqual()` helper, `numCaptures == 0` checks
- `engine/src/server.cpp` — moveToJson + /api/move handler: indexed iteration
- `engine/tests/test_moves.cpp` — `numCaptures` instead of `.size()`, bounded iteration in `hasCapture`

### Issue #23: Bitboard iteration — 64-iteration loops → __builtin_ctzll

Replaced `for(row 0..7) { for(col 0..7) { if(!(myPieces & mask)) continue; ... } }` with:
```cpp
Bitboard remaining = myPieces;
while (remaining) {
    int sq = __builtin_ctzll(remaining);
    int row = sq / 8, col = sq % 8;
    remaining &= remaining - 1;
    ...
}
```

**Functions updated:**
- `MoveGenerator::generateAll()` — main move generation loop
- `MoveGenerator::generateCaptures()` — capture generation loop
- `MoveGenerator::hasAnyMove()` — quick existence check

## Build & Test Results

- **cmake:** ✅ configured
- **make -j:** ✅ compiled (0 errors, 0 warnings)
- **ctest:** ✅ 1/1 tests passed (0.00s)
- **Full test output:** all 25 tests passed including edge cases, multi-capture chains, king captures, promotion, undo, draw detection

## Notes

- `multiCapture()` internal recursion still uses `std::vector<Square>` for working state — these are local variables, not Move struct fields. Copy to fixed arrays happens at Move construction time.
- No performance benchmarks run, but eliminating per-move heap allocation (3 vectors × 2 allocations each) should reduce allocator pressure significantly.
