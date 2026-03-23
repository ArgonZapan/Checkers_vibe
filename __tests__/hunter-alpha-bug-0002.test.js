/**
 * Bug #2: Minimax path in trainer.js doesn't set policyIndex on chosenMove.
 * Training target for policy head becomes all-zeros (silent failure).
 */

import assert from 'node:assert/strict';
import { computePolicyIndex } from '../server/ai/model.js';

export async function runBug0002Tests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test('move without policyIndex produces non-numeric training index', () => {
    const chosenMove = { from: [4, 3], to: [3, 2], captures: [] };
    const moveIdx = typeof chosenMove === 'number' ? chosenMove
      : (chosenMove.policyIndex ?? chosenMove.index ?? chosenMove);
    // BUG: moveIdx is the object itself, not a number
    assert.notEqual(typeof moveIdx, 'number',
      'moveIdx should be a number, but got object (policyIndex missing)');
  });

  test('policy target is all-zeros when policyIndex missing', () => {
    const chosenMove = { from: [4, 3], to: [3, 2], captures: [] };
    const policyTarget = new Float32Array(128).fill(0);
    const moveIdx = typeof chosenMove === 'number' ? chosenMove
      : (chosenMove.policyIndex ?? chosenMove.index ?? chosenMove);
    if (moveIdx >= 0 && moveIdx < 128) {
      policyTarget[moveIdx] = 1;
    }
    const sum = policyTarget.reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, 'Policy target should be all-zeros (BUG: training learns nothing)');
  });

  test('move with policyIndex produces valid training target', () => {
    const from = [4, 3], to = [3, 2];
    const pi = computePolicyIndex(from, to);
    const chosenMove = { from, to, captures: [], policyIndex: pi };
    const moveIdx = typeof chosenMove === 'number' ? chosenMove
      : (chosenMove.policyIndex ?? chosenMove.index ?? chosenMove);
    assert.equal(typeof moveIdx, 'number');
    assert.equal(moveIdx, pi);

    const policyTarget = new Float32Array(128).fill(0);
    if (moveIdx >= 0 && moveIdx < 128) policyTarget[moveIdx] = 1;
    const sum = policyTarget.reduce((a, b) => a + b, 0);
    assert.equal(sum, 1, 'Policy target should have exactly one hot entry');
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (e) { failed++; console.log(`  ❌ ${t.name}: ${e.message}`); }
  }
  return { passed, failed };
}
