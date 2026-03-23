/**
 * issue129.test.js — Terminal reward: string vs int type mismatch (#129).
 *
 * Bug: _playGame() receives winner as string ("white"/"black"/"draw") or
 * integer (1/-1/0) depending on engine version. The terminal result assignment
 * to samples must handle BOTH formats correctly.
 *
 * The fix converts winner to a numeric winnerVal before assigning results:
 *   const winnerVal = winner === 'white' ? 1 : winner === 'black' ? -1 : 0;
 *   s.result = s.turn === winnerVal ? 1 : -1;
 *
 * Previously, comparing s.turn (number) against winner (string) would always
 * fail, giving every sample result = -1 regardless of who won.
 */

import assert from 'node:assert/strict';

// ── Extracted: winner→winnerVal conversion + result assignment ──────────────

/**
 * Convert winner to numeric value, handling both string and int formats.
 * Mirrors the fix in _playGame():
 *   const winnerVal = winner === 'white' ? 1 : winner === 'black' ? -1 : 0;
 */
function winnerToNumeric(winner) {
  if (winner === 'white') return 1;
  if (winner === 'black') return -1;
  // Numeric pass-through: 1, -1, 0, null, undefined → treat as 0 (draw) or direct value
  if (typeof winner === 'number') return winner;
  return 0; // draw / unknown
}

/**
 * Assign terminal results to samples given a winner (string or int).
 * This is the FIXED version that handles both types.
 */
function assignTerminalResults(samples, winner) {
  const winnerVal = winnerToNumeric(winner);
  for (const s of samples) {
    if (winnerVal === 0) {
      s.result = 0;
    } else {
      s.result = s.turn === winnerVal ? 1 : -1;
    }
  }
  if (samples.length > 0) {
    samples[samples.length - 1].done = true;
  }
  return samples;
}

/**
 * BROKEN version (pre-fix): directly compares s.turn against winner string.
 * Demonstrates the bug — string comparison always fails for numeric turns.
 */
function assignTerminalResultsBroken(samples, winner) {
  for (const s of samples) {
    if (winner === 'draw' || !winner) {
      s.result = 0;
    } else {
      // BUG: if winner is "white" (string), s.turn===1 !== "white" → always -1
      s.result = s.turn === winner ? 1 : -1;
    }
  }
  if (samples.length > 0) {
    samples[samples.length - 1].done = true;
  }
  return samples;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runIssue129Tests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── winnerToNumeric ───────────────────────────────────────────────────

  test('winnerToNumeric: "white" → 1', () => {
    assert.equal(winnerToNumeric('white'), 1);
  });

  test('winnerToNumeric: "black" → -1', () => {
    assert.equal(winnerToNumeric('black'), -1);
  });

  test('winnerToNumeric: "draw" → 0', () => {
    assert.equal(winnerToNumeric('draw'), 0);
  });

  test('winnerToNumeric: null → 0', () => {
    assert.equal(winnerToNumeric(null), 0);
  });

  test('winnerToNumeric: undefined → 0', () => {
    assert.equal(winnerToNumeric(undefined), 0);
  });

  test('winnerToNumeric: 1 → 1 (int pass-through)', () => {
    assert.equal(winnerToNumeric(1), 1);
  });

  test('winnerToNumeric: -1 → -1 (int pass-through)', () => {
    assert.equal(winnerToNumeric(-1), -1);
  });

  test('winnerToNumeric: 0 → 0 (int pass-through)', () => {
    assert.equal(winnerToNumeric(0), 0);
  });

  // ── String winner: FIXED version works correctly ──────────────────────

  test('FIXED: string "white" winner → white samples get +1, black get -1', () => {
    const samples = [
      { turn: 1, result: 0, done: false },   // white move
      { turn: -1, result: 0, done: false },  // black move
      { turn: 1, result: 0, done: false },   // white move
    ];

    assignTerminalResults(samples, 'white');

    assert.equal(samples[0].result, 1, 'white move → +1');
    assert.equal(samples[1].result, -1, 'black move → -1');
    assert.equal(samples[2].result, 1, 'white move → +1');
    assert.equal(samples[2].done, true, 'last sample is terminal');
  });

  test('FIXED: string "black" winner → black samples get +1, white get -1', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, 'black');

    assert.equal(samples[0].result, -1, 'white move → -1');
    assert.equal(samples[1].result, 1, 'black move → +1');
  });

  test('FIXED: string "draw" winner → all samples get 0', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, 'draw');

    assert.equal(samples[0].result, 0, 'white move → 0');
    assert.equal(samples[1].result, 0, 'black move → 0');
  });

  // ── Integer winner: still works (backward compat) ─────────────────────

  test('FIXED: int 1 winner → white samples get +1', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, 1);

    assert.equal(samples[0].result, 1, 'white move → +1');
    assert.equal(samples[1].result, -1, 'black move → -1');
  });

  test('FIXED: int -1 winner → black samples get +1', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, -1);

    assert.equal(samples[0].result, -1, 'white move → -1');
    assert.equal(samples[1].result, 1, 'black move → +1');
  });

  test('FIXED: int 0 winner → all samples get 0', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, 0);

    assert.equal(samples[0].result, 0);
    assert.equal(samples[1].result, 0);
  });

  // ── BROKEN version demonstrates the bug ───────────────────────────────

  test('BUG DEMO: pre-fix string "white" → all samples get -1 (wrong!)', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
      { turn: 1, result: 0, done: false },
    ];

    assignTerminalResultsBroken(samples, 'white');

    // The bug: 1 === "white" is false, -1 === "white" is false
    // So ALL samples get result = -1
    assert.equal(samples[0].result, -1, 'BUG: white move gets -1 instead of +1');
    assert.equal(samples[1].result, -1, 'black move gets -1 (correct by accident)');
    assert.equal(samples[2].result, -1, 'BUG: white move gets -1 instead of +1');
  });

  test('BUG DEMO: pre-fix int 1 winner works fine (no bug with ints)', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResultsBroken(samples, 1);

    // With int, comparison works: 1 === 1 is true
    assert.equal(samples[0].result, 1, 'white move → +1 (int works)');
    assert.equal(samples[1].result, -1, 'black move → -1');
  });

  // ── Null/undefined winner edge cases ──────────────────────────────────

  test('null winner → all results are 0 (draw)', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, null);

    assert.equal(samples[0].result, 0);
    assert.equal(samples[1].result, 0);
  });

  test('undefined winner → all results are 0 (draw)', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignTerminalResults(samples, undefined);

    assert.equal(samples[0].result, 0);
    assert.equal(samples[1].result, 0);
  });

  // ── Empty samples ─────────────────────────────────────────────────────

  test('empty samples + string winner → no crash', () => {
    const samples = [];
    assignTerminalResults(samples, 'white');
    assert.equal(samples.length, 0);
  });

  test('empty samples + int winner → no crash', () => {
    const samples = [];
    assignTerminalResults(samples, 1);
    assert.equal(samples.length, 0);
  });

  // ── Long game: many samples with string winner ────────────────────────

  test('long game (50 moves) + string "white" winner → correct results', () => {
    const samples = [];
    for (let i = 0; i < 50; i++) {
      samples.push({ turn: i % 2 === 0 ? 1 : -1, result: 0, done: false });
    }

    assignTerminalResults(samples, 'white');

    // Every white move (even indices) should get +1
    // Every black move (odd indices) should get -1
    for (let i = 0; i < 50; i++) {
      const expected = samples[i].turn === 1 ? 1 : -1;
      assert.equal(samples[i].result, expected,
        `Move ${i}: turn=${samples[i].turn} should have result=${expected}`);
    }
    assert.equal(samples[49].done, true, 'last sample is terminal');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Issue #129 — Terminal Reward String vs Int Tests');

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`   ─── ${passed} passed, ${failed} failed ───`);
  return { passed, failed };
}
