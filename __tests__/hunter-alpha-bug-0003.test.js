/**
 * Bug #3: calcAdvance in trainer.js had inverted advancement direction.
 * White pawn moving forward got NEGATIVE reward (penalized).
 * Black pawn moving forward also got NEGATIVE reward.
 *
 * FIX: Swapped (7 - row) / 7 and row / 7 for white/black.
 */

import assert from 'node:assert/strict';

export async function runBug0003Tests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // Fixed calcAdvance from trainer.js
  function calcAdvance(prev, next, turn) {
    let totalAdvance = 0, prevTotalAdvance = 0;
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      const isOwnPawn = (val) => turn === 1 ? val === 1 : val === 3;
      if (isOwnPawn(next[i])) {
        // FIX: white forward = increasing row → row/7; black forward = decreasing row → (7-row)/7
        const adv = turn === 1 ? row / 7 : (7 - row) / 7;
        totalAdvance += adv;
      }
      if (isOwnPawn(prev[i])) {
        const adv = turn === 1 ? row / 7 : (7 - row) / 7;
        prevTotalAdvance += adv;
      }
    }
    return Math.max(-1, Math.min(1, totalAdvance - prevTotalAdvance));
  }

  test('white pawn row 4→5 should have POSITIVE advance delta', () => {
    const prev = new Array(64).fill(0); prev[4 * 8 + 3] = 1;
    const next = new Array(64).fill(0); next[5 * 8 + 4] = 1;
    const delta = calcAdvance(prev, next, 1);
    assert.ok(delta > 0, `Expected positive, got ${delta}`);
  });

  test('white pawn row 5→4 should have NEGATIVE advance delta (retreat)', () => {
    const prev = new Array(64).fill(0); prev[5 * 8 + 3] = 1;
    const next = new Array(64).fill(0); next[4 * 8 + 2] = 1;
    const delta = calcAdvance(prev, next, 1);
    assert.ok(delta < 0, `Expected negative, got ${delta}`);
  });

  test('black pawn row 3→2 should have POSITIVE advance delta', () => {
    const prev = new Array(64).fill(0); prev[3 * 8 + 3] = 3;
    const next = new Array(64).fill(0); next[2 * 8 + 2] = 3;
    const delta = calcAdvance(prev, next, -1);
    assert.ok(delta > 0, `Expected positive, got ${delta}`);
  });

  test('black pawn row 2→3 should have NEGATIVE advance delta (retreat)', () => {
    const prev = new Array(64).fill(0); prev[2 * 8 + 3] = 3;
    const next = new Array(64).fill(0); next[3 * 8 + 4] = 3;
    const delta = calcAdvance(prev, next, -1);
    assert.ok(delta < 0, `Expected negative, got ${delta}`);
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (e) { failed++; console.log(`  ❌ ${t.name}: ${e.message}`); }
  }
  return { passed, failed };
}
