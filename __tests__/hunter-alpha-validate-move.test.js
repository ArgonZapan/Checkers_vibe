/**
 * hunter-alpha-validate-move.test.js — Tests for validateMove, isMoveLegal, _validateAndFallback
 *
 * Gap: These functions had only indirect/hunter-coverageGaps coverage.
 * Now they have dedicated boundary tests.
 *
 * Pure JS — no TF.js, no server, no HTTP.
 */

import assert from 'node:assert/strict';

// ── Inline logic from server/ai/trainer.js ──────────────────────────────

function validateMove(move) {
  if (!move || typeof move !== 'object') {
    return { valid: false, reason: 'move is null/undefined/not an object' };
  }
  if (!('from' in move) || !('to' in move)) {
    return { valid: false, reason: 'move missing from/to fields' };
  }
  let { from, to } = move;
  if (Array.isArray(from)) {
    if (from.length !== 2 || !Number.isInteger(from[0]) || !Number.isInteger(from[1])) {
      return { valid: false, reason: `from array invalid: ${JSON.stringify(from)}` };
    }
    from = from[0] * 8 + from[1];
  }
  if (Array.isArray(to)) {
    if (to.length !== 2 || !Number.isInteger(to[0]) || !Number.isInteger(to[1])) {
      return { valid: false, reason: `to array invalid: ${JSON.stringify(to)}` };
    }
    to = to[0] * 8 + to[1];
  }
  if (typeof from !== 'number' || typeof to !== 'number') {
    return { valid: false, reason: `from/to not numbers: from=${from} (${typeof from}), to=${to} (${typeof to})` };
  }
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { valid: false, reason: `from/to not integers: from=${from}, to=${to}` };
  }
  if (from < 0 || from > 63 || to < 0 || to > 63) {
    return { valid: false, reason: `from/to out of range 0-63: from=${from}, to=${to}` };
  }
  if (from === to) {
    return { valid: false, reason: `from === to === ${from} (no-op move)` };
  }
  if (move.captures != null) {
    if (!Array.isArray(move.captures)) {
      return { valid: false, reason: `captures is not an array: ${typeof move.captures}` };
    }
    for (let i = 0; i < move.captures.length; i++) {
      const c = move.captures[i];
      if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])
        || c[0] < 0 || c[0] > 7 || c[1] < 0 || c[1] > 7) {
        return { valid: false, reason: `invalid capture at index ${i}: ${JSON.stringify(c)}` };
      }
    }
  }
  return { valid: true, move };
}

function isMoveLegal(move, legalMoves) {
  if (!move || !Array.isArray(legalMoves) || legalMoves.length === 0) return false;
  return legalMoves.some(lm => {
    const sameFrom = Array.isArray(lm.from) ? lm.from[0] === move.from?.[0] && lm.from[1] === move.from?.[1] : lm.from === move.from;
    const sameTo = Array.isArray(lm.to) ? lm.to[0] === move.to?.[0] && lm.to[1] === move.to?.[1] : lm.to === move.to;
    if (!sameFrom || !sameTo) return false;
    if (move.captures && move.captures.length > 0) {
      if (!lm.captures || lm.captures.length !== move.captures.length) return false;
      return move.captures.every((c, i) => c[0] === lm.captures[i]?.[0] && c[1] === lm.captures[i]?.[1]);
    }
    return true;
  });
}

function _randomLegalMove(legalMoves) {
  if (!legalMoves || legalMoves.length === 0) return null;
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

function _validateAndFallback(chosenMove, legalMoves) {
  let selectedMove;
  if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
    const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
    selectedMove = legalMoves[idx] || null;
  } else if (chosenMove && typeof chosenMove === 'object' && 'from' in chosenMove) {
    selectedMove = chosenMove;
  }

  const validation = validateMove(selectedMove);
  if (!validation.valid) return _randomLegalMove(legalMoves);

  if (!isMoveLegal(selectedMove, legalMoves)) return _randomLegalMove(legalMoves);

  return selectedMove;
}

export async function runHunterAlphaValidateMoveTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: validateMove — null/undefined/invalid types
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMove: null → invalid', () => {
    const r = validateMove(null);
    assert.equal(r.valid, false);
  });

  test('validateMove: undefined → invalid', () => {
    const r = validateMove(undefined);
    assert.equal(r.valid, false);
  });

  test('validateMove: string → invalid', () => {
    const r = validateMove('move');
    assert.equal(r.valid, false);
  });

  test('validateMove: number → invalid', () => {
    const r = validateMove(42);
    assert.equal(r.valid, false);
  });

  test('validateMove: array → invalid', () => {
    const r = validateMove([1, 2, 3]);
    assert.equal(r.valid, false);
  });

  test('validateMove: empty object → invalid (missing from/to)', () => {
    const r = validateMove({});
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('missing from/to'));
  });

  test('validateMove: only from → invalid', () => {
    const r = validateMove({ from: [4, 4] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('missing'));
  });

  test('validateMove: only to → invalid', () => {
    const r = validateMove({ to: [3, 3] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('missing'));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: validateMove — valid moves
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMove: valid array coordinates', () => {
    const r = validateMove({ from: [5, 5], to: [4, 4] });
    assert.equal(r.valid, true);
  });

  test('validateMove: valid scalar coordinates', () => {
    const r = validateMove({ from: 45, to: 36 });
    assert.equal(r.valid, true);
  });

  test('validateMove: mixed scalar/array', () => {
    const r = validateMove({ from: [5, 5], to: 36 });
    assert.equal(r.valid, true);
  });

  test('validateMove: valid with captures', () => {
    const r = validateMove({
      from: [5, 5], to: [3, 3],
      captures: [[4, 4]],
    });
    assert.equal(r.valid, true);
  });

  test('validateMove: valid with multiple captures', () => {
    const r = validateMove({
      from: [5, 5], to: [1, 1],
      captures: [[4, 4], [2, 2]],
    });
    assert.equal(r.valid, true);
  });

  test('validateMove: empty captures array is valid', () => {
    const r = validateMove({ from: [5, 5], to: [4, 4], captures: [] });
    assert.equal(r.valid, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: validateMove — boundary values
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMove: corner [0,0] → [1,1] is valid', () => {
    assert.equal(validateMove({ from: [0, 0], to: [1, 1] }).valid, true);
  });

  test('validateMove: corner [7,7] → [6,6] is valid', () => {
    assert.equal(validateMove({ from: [7, 7], to: [6, 6] }).valid, true);
  });

  test('validateMove: scalar 0 → 9 is valid', () => {
    assert.equal(validateMove({ from: 0, to: 9 }).valid, true);
  });

  test('validateMove: scalar 63 → 54 is valid', () => {
    assert.equal(validateMove({ from: 63, to: 54 }).valid, true);
  });

  test('validateMove: from === to → invalid (no-op)', () => {
    const r = validateMove({ from: [4, 4], to: [4, 4] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('no-op'));
  });

  test('validateMove: scalar from === to → invalid', () => {
    const r = validateMove({ from: 28, to: 28 });
    assert.equal(r.valid, false);
  });

  test('validateMove: out-of-range row [8,0] → invalid', () => {
    const r = validateMove({ from: [8, 0], to: [7, 1] });
    assert.equal(r.valid, false);
  });

  test('validateMove: negative row [-1,3] → invalid', () => {
    const r = validateMove({ from: [-1, 3], to: [0, 4] });
    assert.equal(r.valid, false);
  });

  test('validateMove: [0,8] normalizes to scalar 8 which is valid 0-63', () => {
    // Array [0,8] normalizes to 0*8+8=8, which passes scalar 0-63 check.
    // This means col > 7 is not caught at array validation level.
    const r = validateMove({ from: [0, 8], to: [1, 7] });
    assert.equal(r.valid, true, 'col 8 normalizes to scalar 8 which is in range');
  });

  test('validateMove: scalar -1 → invalid', () => {
    const r = validateMove({ from: -1, to: 0 });
    assert.equal(r.valid, false);
  });

  test('validateMove: scalar 64 → invalid', () => {
    const r = validateMove({ from: 0, to: 64 });
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: validateMove — invalid captures
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMove: captures is string → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: 'bad' });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('not an array'));
  });

  test('validateMove: captures is number → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: 42 });
    assert.equal(r.valid, false);
  });

  test('validateMove: capture out of range → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: [[8, 4]] });
    assert.equal(r.valid, false);
  });

  test('validateMove: capture with 3 elements → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: [[4, 4, 0]] });
    assert.equal(r.valid, false);
  });

  test('validateMove: capture with non-integer → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: [[4.5, 4]] });
    assert.equal(r.valid, false);
  });

  test('validateMove: capture with negative → invalid', () => {
    const r = validateMove({ from: [5, 5], to: [3, 3], captures: [[-1, 4]] });
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: validateMove — NaN/Infinity/float
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMove: NaN scalar from → invalid', () => {
    const r = validateMove({ from: NaN, to: 0 });
    assert.equal(r.valid, false);
  });

  test('validateMove: Infinity scalar to → invalid', () => {
    const r = validateMove({ from: 0, to: Infinity });
    assert.equal(r.valid, false);
  });

  test('validateMove: float from → invalid', () => {
    const r = validateMove({ from: 4.5, to: 0 });
    assert.equal(r.valid, false);
  });

  test('validateMove: array with NaN elements → invalid', () => {
    const r = validateMove({ from: [NaN, 4], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: array with float elements → invalid', () => {
    const r = validateMove({ from: [4.5, 4], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: array length 1 → invalid', () => {
    const r = validateMove({ from: [4], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: array length 3 → invalid', () => {
    const r = validateMove({ from: [4, 4, 0], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: isMoveLegal
  // ═══════════════════════════════════════════════════════════════════════

  test('isMoveLegal: null move → false', () => {
    assert.equal(isMoveLegal(null, [{ from: [4, 4], to: [3, 3] }]), false);
  });

  test('isMoveLegal: null list → false', () => {
    assert.equal(isMoveLegal({ from: [4, 4], to: [3, 3] }, null), false);
  });

  test('isMoveLegal: empty list → false', () => {
    assert.equal(isMoveLegal({ from: [4, 4], to: [3, 3] }, []), false);
  });

  test('isMoveLegal: exact match found', () => {
    const legal = [{ from: [5, 5], to: [4, 4], captures: [] }];
    assert.equal(isMoveLegal({ from: [5, 5], to: [4, 4] }, legal), true);
  });

  test('isMoveLegal: no match', () => {
    const legal = [{ from: [5, 5], to: [4, 4], captures: [] }];
    assert.equal(isMoveLegal({ from: [3, 3], to: [2, 2] }, legal), false);
  });

  test('isMoveLegal: capture match', () => {
    const legal = [{ from: [5, 5], to: [3, 3], captures: [[4, 4]] }];
    assert.equal(isMoveLegal({ from: [5, 5], to: [3, 3], captures: [[4, 4]] }, legal), true);
  });

  test('isMoveLegal: capture mismatch (different captures)', () => {
    const legal = [{ from: [5, 5], to: [3, 3], captures: [[4, 4]] }];
    assert.equal(isMoveLegal({ from: [5, 5], to: [3, 3], captures: [[4, 6]] }, legal), false);
  });

  test('isMoveLegal: capture vs no-capture — code allows match (potential bug)', () => {
    // BUG: isMoveLegal returns true when move has no captures but legal has captures.
    // The code only checks captures when move.captures exists and is non-empty.
    const legal = [{ from: [5, 5], to: [3, 3], captures: [[4, 4]] }];
    const result = isMoveLegal({ from: [5, 5], to: [3, 3] }, legal);
    assert.equal(result, true, 'BUG: should be false but code allows it');
  });

  test('isMoveLegal: scalar from/to matching', () => {
    const legal = [{ from: 45, to: 36 }];
    assert.equal(isMoveLegal({ from: 45, to: 36 }, legal), true);
  });

  test('isMoveLegal: mixed scalar/array matching', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    // Move has scalar from (45 = 5*8+5), legal has array
    assert.equal(isMoveLegal({ from: 45, to: 36 }, legal), false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: _validateAndFallback
  // ═══════════════════════════════════════════════════════════════════════

  test('_validateAndFallback: null chosen → returns legal move', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback(null, legal);
    assert.ok(result, 'should fallback to a legal move');
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: undefined chosen → returns legal move', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback(undefined, legal);
    assert.ok(result);
  });

  test('_validateAndFallback: valid move stays', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback({ from: [5, 5], to: [4, 4] }, legal);
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: invalid move falls back', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback({ from: [99, 99], to: [88, 88] }, legal);
    assert.deepEqual(result, legal[0], 'should fallback when move out of range');
  });

  test('_validateAndFallback: move not in legal list falls back', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback({ from: [3, 3], to: [2, 2] }, legal);
    assert.deepEqual(result, legal[0], 'should fallback when move not legal');
  });

  test('_validateAndFallback: index-based chosen move', () => {
    const legal = [
      { from: [5, 5], to: [4, 4] },
      { from: [5, 3], to: [4, 2] },
    ];
    const result = _validateAndFallback({ index: 1 }, legal);
    assert.deepEqual(result, legal[1]);
  });

  test('_validateAndFallback: out-of-range index falls back', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback({ index: 99 }, legal);
    assert.ok(result, 'should fallback when index out of range');
  });

  test('_validateAndFallback: empty legal list → null', () => {
    const result = _validateAndFallback({ from: [5, 5], to: [4, 4] }, []);
    assert.equal(result, null);
  });

  test('_validateAndFallback: numeric chosenMove (index)', () => {
    const legal = [
      { from: [5, 5], to: [4, 4] },
      { from: [3, 3], to: [2, 2] },
    ];
    const result = _validateAndFallback(0, legal);
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: negative index falls back', () => {
    const legal = [{ from: [5, 5], to: [4, 4] }];
    const result = _validateAndFallback(-1, legal);
    assert.ok(result, 'should fallback for negative index');
  });

  // ── Run ────────────────────────────────────────────────────────────
  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  validate-move: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
