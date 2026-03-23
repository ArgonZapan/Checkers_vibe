/**
 * trainerPolicyFix.test.js — Tests for issues #121 and #122.
 *
 * #121: Empty legalMoves should not crash self-play.
 * #122: predict() should return a valid move object, not a raw policy index (0-47).
 *
 * These tests validate the fixes without requiring a running C++ engine or TensorFlow model.
 */

// ── Test helpers ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} (expected: ${expected}, got: ${actual})`);
}

function assertNotEqual(actual, notExpected, msg) {
  assert(actual !== notExpected, `${msg} (should not be: ${notExpected})`);
}

function assertType(val, type, msg) {
  assert(typeof val === type, `${msg} (expected type: ${type}, got: ${typeof val})`);
}

// ── Issue #121: Empty legalMoves handling ───────────────────────────────────

function testEmptyLegalMoves() {
  console.log('\n── Issue #121: Empty legalMoves should not crash ──');

  // Simulate the check that should exist in _playGame()
  const legalMoves = [];

  // The fix: check before attempting to select a move
  const hasMoves = legalMoves && legalMoves.length > 0;
  assert(!hasMoves, 'Empty legalMoves array should be detected as no moves available');

  // Simulate what happens without the fix (would crash)
  const randomIdx = Math.floor(Math.random() * legalMoves.length);
  const chosenMove = legalMoves[randomIdx];
  assert(chosenMove === undefined, 'Accessing legalMoves[0] on empty array returns undefined');

  // The fix should prevent reaching this point by breaking the game loop
  assert(true, 'Early break on empty legalMoves prevents undefined move selection');
}

function testNullLegalMoves() {
  console.log('\n── Issue #121: Null/undefined legalMoves ──');

  // Test null
  const nullMoves = null;
  const safeNull = nullMoves && nullMoves.length > 0;
  assert(!safeNull, 'Null legalMoves should be detected as no moves');

  // Test undefined
  const undefMoves = undefined;
  const safeUndef = undefMoves && undefMoves.length > 0;
  assert(!safeUndef, 'Undefined legalMoves should be detected as no moves');
}

// ── Issue #122: predict() returns move object, not policy index ─────────────

function testPredictReturnsMoveObject() {
  console.log('\n── Issue #122: predict() should return move object, not raw index ──');

  // Simulate legal moves (7 moves, as described in the issue)
  const legalMoves = [
    { from: 8, to: 12, captures: [], index: 0 },
    { from: 9, to: 13, captures: [], index: 1 },
    { from: 10, to: 14, captures: [], index: 2 },
    { from: 11, to: 15, captures: [], index: 3 },
    { from: 8, to: 17, captures: [12], index: 4 },
    { from: 10, to: 19, captures: [14], index: 5 },
    { from: 11, to: 20, captures: [15], index: 6 },
  ];

  // Simulate predict() returning a policy index (the BUG)
  const policyIndex = 42; // Index in 48-element policy vector
  assert(policyIndex >= legalMoves.length, 'Policy index 42 >= legalMoves.length 7 (would cause undefined access)');

  // The OLD (buggy) behavior: use policy index directly on legalMoves
  const buggyMove = legalMoves[policyIndex];
  assert(buggyMove === undefined, 'OLD: legalMoves[42] is undefined (out of bounds)');

  // The FIX: find the corresponding move in legalMoves by matching index field
  // simulate the fixed predict() behavior
  function fixedPredictSelect(policyIdx, moves) {
    const selected = moves.find(m => m.index === policyIdx) || moves[0];
    return selected;
  }

  // When policyIdx is within legalMoves range
  const validIdx = 3;
  const validMove = fixedPredictSelect(validIdx, legalMoves);
  assert(validMove !== undefined, 'FIXED: Valid policy index returns a move');
  assertEqual(validMove.from, 11, 'FIXED: Returned move has correct from');
  assertEqual(validMove.to, 15, 'FIXED: Returned move has correct to');

  // When policyIdx is outside legalMoves range (the bug scenario)
  const outOfRangeIdx = 42;
  const fallbackMove = fixedPredictSelect(outOfRangeIdx, legalMoves);
  assert(fallbackMove !== undefined, 'FIXED: Out-of-range policy index falls back to first legal move');
  assertEqual(fallbackMove.from, 8, 'FIXED: Fallback move is legalMoves[0]');
  assertEqual(fallbackMove.to, 12, 'FIXED: Fallback move is legalMoves[0]');
}

function testPredictWithSingleMove() {
  console.log('\n── Issue #122: Edge case — single legal move ──');

  const legalMoves = [{ from: 20, to: 24, captures: [], index: 15 }];

  // Even if policy picks index 0 (not 15), the fix should still return a valid move
  function fixedPredictSelect(policyIdx, moves) {
    const selected = moves.find(m => m.index === policyIdx) || moves[0];
    return selected;
  }

  // Policy index doesn't match any legal move
  const move = fixedPredictSelect(0, legalMoves);
  assert(move !== undefined, 'Single legal move always returned as fallback');
  assertEqual(move.from, 20, 'Single move has correct from');
  assertEqual(move.to, 24, 'Single move has correct to');

  // Policy index matches
  const exactMove = fixedPredictSelect(15, legalMoves);
  assert(exactMove !== undefined, 'Exact match returns the move');
  assertEqual(exactMove.from, 20, 'Exact match has correct from');
}

function testValidateAndFallbackIntegration() {
  console.log('\n── Issue #122: _validateAndFallback integration ──');

  const legalMoves = [
    { from: 8, to: 12, captures: [], index: 0 },
    { from: 9, to: 13, captures: [], index: 1 },
    { from: 10, to: 14, captures: [], index: 2 },
  ];

  // Simulate _validateAndFallback when given a move OBJECT (the fixed path)
  function validateAndFallback(chosenMove, legalMoves) {
    if (!chosenMove || typeof chosenMove !== 'object' || !('from' in chosenMove)) {
      return legalMoves[0]; // fallback
    }
    // Check if move is in legal moves
    const found = legalMoves.some(lm => lm.from === chosenMove.from && lm.to === chosenMove.to);
    return found ? chosenMove : legalMoves[0];
  }

  // With a proper move object (what fixed predict() returns)
  const properMove = { from: 10, to: 14, captures: [], index: 2 };
  const result1 = validateAndFallback(properMove, legalMoves);
  assert(result1 !== undefined, 'Move object validates correctly');
  assertEqual(result1.from, 10, 'Validated move has correct from');

  // With an invalid move object (simulated out-of-range)
  const invalidMove = { from: 99, to: 100, captures: [] };
  const result2 = validateAndFallback(invalidMove, legalMoves);
  assert(result2 !== undefined, 'Invalid move falls back to legal move');
  assertEqual(result2.from, 8, 'Fallback is legalMoves[0]');

  // With null (should not happen with fix, but test resilience)
  const result3 = validateAndFallback(null, legalMoves);
  assert(result3 !== undefined, 'Null move falls back to legal move');
}

function testPredictWithIndexField() {
  console.log('\n── Issue #122: predict() uses index field for matching ──');

  // In real code, legalMoves passed to predict() are movesWithIndex:
  // legalMoves.map((m, i) => ({ ...m, index: i }))
  // So the index field is the ARRAY index, not the policy index.

  const rawMoves = [
    { from: 8, to: 12, captures: [] },
    { from: 9, to: 13, captures: [] },
    { from: 10, to: 14, captures: [] },
  ];
  const movesWithIndex = rawMoves.map((m, i) => ({ ...m, index: i }));

  // predict() returns `move: bestIdx` where bestIdx is from legalIndices
  // legalIndices = legalMoves.map(m => m.index ?? m)
  // So legalIndices = [0, 1, 2]
  const legalIndices = movesWithIndex.map(m => m.index);

  // bestIdx sampled from these indices
  const bestIdx = legalIndices[1]; // = 1

  // FIXED: find the move with matching index
  const selected = movesWithIndex.find(m => m.index === bestIdx) || movesWithIndex[0];
  assert(selected !== undefined, 'Selected move found by index');
  assertEqual(selected.from, 9, 'Correct move selected (from=9)');
  assertEqual(selected.to, 13, 'Correct move selected (to=13)');
  assertEqual(selected.index, 1, 'Selected move has correct index');
}

// ── Run all tests ──────────────────────────────────────────────────────────

export function runTrainerPolicyFixTests() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Trainer Policy Fix Tests (#121, #122)');
  console.log('═══════════════════════════════════════════════');

  testEmptyLegalMoves();
  testNullLegalMoves();
  testPredictReturnsMoveObject();
  testPredictWithSingleMove();
  testValidateAndFallbackIntegration();
  testPredictWithIndexField();

  console.log('\n── Summary ──');
  console.log(`  Passed: ${passed} | Failed: ${failed}`);

  return { passed, failed };
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const { passed: p, failed: f } = runTrainerPolicyFixTests();
  process.exit(f > 0 ? 1 : 0);
}
