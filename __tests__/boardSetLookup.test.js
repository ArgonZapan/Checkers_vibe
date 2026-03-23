/**
 * boardSetLookup.test.js — Tests for Set.has() O(1) lookup vs array.some().
 *
 * Board.jsx uses: const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));
 *                 const isValidMove = validTargets.has(`${row},${col}`);
 *
 * This tests the correctness and performance characteristics of that pattern.
 */

import assert from 'node:assert/strict';

export async function runBoardSetLookupTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Set construction from legalMoves ──────────────────────────────────

  test('Set built from legalMoves contains correct targets', () => {
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
      { from: [2, 1], to: [3, 2] },
      { from: [2, 3], to: [3, 4] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    assert.ok(validTargets.has('3,0'));
    assert.ok(validTargets.has('3,2'));
    assert.ok(validTargets.has('3,4'));
    assert.ok(!validTargets.has('2,1')); // from, not to
    assert.ok(!validTargets.has('3,1'));
  });

  test('Set does NOT contain from positions', () => {
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    assert.ok(!validTargets.has('2,1'), 'Set should not contain from positions');
  });

  test('empty legalMoves → empty Set', () => {
    const legalMoves = [];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    assert.equal(validTargets.size, 0);
    assert.ok(!validTargets.has('0,0'));
  });

  // ── Set.has() vs array.some() equivalence ─────────────────────────────

  test('Set.has() matches array.some() for all cells', () => {
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
      { from: [2, 1], to: [3, 2] },
      { from: [4, 5], to: [5, 4] },
      { from: [4, 5], to: [5, 6] },
    ];

    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    // Check all 64 cells
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const setResult = validTargets.has(`${row},${col}`);
        const someResult = legalMoves.some(m => m.to[0] === row && m.to[1] === col);
        assert.equal(setResult, someResult, `Mismatch at [${row}][${col}]`);
      }
    }
  });

  test('Set.has() matches array.some() with captures', () => {
    const legalMoves = [
      { from: [3, 3], to: [5, 5], captures: [[4, 4]] },
      { from: [3, 3], to: [5, 1], captures: [[4, 2]] },
    ];

    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const setResult = validTargets.has(`${row},${col}`);
        const someResult = legalMoves.some(m => m.to[0] === row && m.to[1] === col);
        assert.equal(setResult, someResult);
      }
    }
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  test('duplicate targets deduplicated in Set', () => {
    // Two different pieces can move to the same square
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
      { from: [4, 1], to: [3, 0] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    assert.equal(validTargets.size, 1, 'Duplicates should be deduplicated');
    assert.ok(validTargets.has('3,0'));
  });

  test('edge coordinates (0,0) and (7,7)', () => {
    const legalMoves = [
      { from: [1, 1], to: [0, 0] },
      { from: [6, 6], to: [7, 7] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    assert.ok(validTargets.has('0,0'));
    assert.ok(validTargets.has('7,7'));
  });

  // ── Performance characteristic (correctness, not speed) ───────────────

  test('Set.has() returns boolean for all lookups', () => {
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
      { from: [6, 7], to: [5, 6] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const result = validTargets.has(`${row},${col}`);
        assert.equal(typeof result, 'boolean', `has() should return boolean at [${row}][${col}]`);
      }
    }
  });

  test('Set size equals unique target count', () => {
    const legalMoves = [
      { from: [2, 1], to: [3, 0] },
      { from: [2, 1], to: [3, 2] },
      { from: [2, 3], to: [3, 2] }, // duplicate target
      { from: [2, 5], to: [3, 4] },
      { from: [2, 5], to: [3, 6] },
    ];
    const validTargets = new Set(legalMoves.map(m => `${m.to[0]},${m.to[1]}`));

    // Unique targets: [3,0], [3,2], [3,4], [3,6] = 4
    assert.equal(validTargets.size, 4);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Board Set Lookup Tests (Set.has() O(1))');

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
