/**
 * legalMovesMemoization.test.js — Tests for BUG-009: areEqual legalMoves comparison.
 *
 * The areEqual function in client/src/components/Board.jsx should compare
 * the CONTENT of legalMoves, not just the reference. Currently it uses
 * `prevProps.legalMoves !== nextProps.legalMoves` which is reference-only,
 * causing unnecessary re-renders when a new array with same content is passed.
 *
 * Extracted logic — no React/browser dependency required.
 */

import assert from 'node:assert/strict';

// ── Extracted: areEqual from Board.jsx (with legalMoves comparison) ─────────

/**
 * Current areEqual — uses reference comparison for legalMoves.
 * BUG: Different reference but same content → returns false (re-render).
 */
function areEqualReference(prevProps, nextProps) {
  if (prevProps.gameOver !== nextProps.gameOver) return false;
  if (prevProps.winner !== nextProps.winner) return false;
  if (prevProps.turn !== nextProps.turn) return false;
  if (prevProps.selected?.[0] !== nextProps.selected?.[0] || prevProps.selected?.[1] !== nextProps.selected?.[1]) return false;
  if (prevProps.board !== nextProps.board) return false;
  if (prevProps.legalMoves !== nextProps.legalMoves) return false;
  if (prevProps.legalMoves?.length !== nextProps.legalMoves?.length) return false;
  if (prevProps.lastMove !== nextProps.lastMove) return false;
  if (prevProps.path !== nextProps.path) return false;
  if (prevProps.captures?.length !== nextProps.captures?.length) return false;
  if (prevProps.onCellClick !== nextProps.onCellClick) return false;
  return true;
}

/**
 * Fixed areEqual — uses content comparison for legalMoves.
 * Compares each move's from/to by value, not reference.
 */
function areEqualContent(prevProps, nextProps) {
  if (prevProps.gameOver !== nextProps.gameOver) return false;
  if (prevProps.winner !== nextProps.winner) return false;
  if (prevProps.turn !== nextProps.turn) return false;
  if (prevProps.selected?.[0] !== nextProps.selected?.[0] || prevProps.selected?.[1] !== nextProps.selected?.[1]) return false;
  if (prevProps.board !== nextProps.board) return false;
  // Content-based comparison for legalMoves
  if (!movesEqual(prevProps.legalMoves, nextProps.legalMoves)) return false;
  if (prevProps.lastMove !== nextProps.lastMove) return false;
  if (prevProps.path !== nextProps.path) return false;
  if (prevProps.captures?.length !== nextProps.captures?.length) return false;
  if (prevProps.onCellClick !== nextProps.onCellClick) return false;
  return true;
}

/**
 * Deep equality check for move arrays.
 */
function movesEqual(a, b) {
  if (a === b) return true; // same reference
  if (!a || !b) return a === b; // both null/undefined or one is
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ma = a[i];
    const mb = b[i];
    if (ma.from[0] !== mb.from[0] || ma.from[1] !== mb.from[1]) return false;
    if (ma.to[0] !== mb.to[0] || ma.to[1] !== mb.to[1]) return false;
  }
  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const noop = () => {};
const EMPTY_BOARD = [[null]];

function makeProps(overrides = {}) {
  return {
    gameOver: false,
    winner: null,
    turn: 'white',
    selected: null,
    board: EMPTY_BOARD,
    legalMoves: [],
    lastMove: null,
    path: null,
    captures: [],
    onCellClick: noop,
    ...overrides,
  };
}

function makeMove(from, to) {
  return { from: [...from], to: [...to] };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runLegalMovesMemoizationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Same reference — should be equal ──────────────────────────────────

  test('same legalMoves reference → areEqual returns true (both versions)', () => {
    const move = { from: [2, 3], to: [3, 4] };
    const moves = [move];
    const prev = makeProps({ legalMoves: moves });
    const next = makeProps({ legalMoves: moves });

    assert.equal(areEqualReference(prev, next), true, 'Reference version should match');
    assert.equal(areEqualContent(prev, next), true, 'Content version should match');
  });

  // ── BUG-009: Different reference, same content ───────────────────────

  test('different reference but same content → reference version returns FALSE (bug)', () => {
    // Create two separate arrays with same from/to values
    const moves1 = [{ from: [2, 3], to: [3, 4] }, { from: [2, 5], to: [3, 6] }];
    const moves2 = [{ from: [2, 3], to: [3, 4] }, { from: [2, 5], to: [3, 6] }];

    // They are different objects
    assert.notEqual(moves1, moves2, 'References should be different');
    assert.notEqual(moves1[0], moves2[0], 'Individual move objects should be different references');

    const prev = makeProps({ legalMoves: moves1 });
    const next = makeProps({ legalMoves: moves2 });

    // BUG: reference comparison returns false even though content is identical
    assert.equal(areEqualReference(prev, next), false,
      'BUG: reference version returns false for same-content different-reference');

    // FIX: content comparison returns true
    assert.equal(areEqualContent(prev, next), true,
      'FIX: content version should return true for identical content');
  });

  // ── Different content — should not be equal ───────────────────────────

  test('different content → both versions return false', () => {
    const moves1 = [makeMove([2, 3], [3, 4])];
    const moves2 = [makeMove([2, 3], [3, 4]), makeMove([2, 5], [3, 6])];

    const prev = makeProps({ legalMoves: moves1 });
    const next = makeProps({ legalMoves: moves2 });

    assert.equal(areEqualReference(prev, next), false);
    assert.equal(areEqualContent(prev, next), false);
  });

  test('different move destinations → both return false', () => {
    const moves1 = [makeMove([2, 3], [3, 4])];
    const moves2 = [makeMove([2, 3], [4, 5])];

    const prev = makeProps({ legalMoves: moves1 });
    const next = makeProps({ legalMoves: moves2 });

    assert.equal(areEqualReference(prev, next), false);
    assert.equal(areEqualContent(prev, next), false);
  });

  // ── Empty arrays ──────────────────────────────────────────────────────

  test('both empty arrays, different references → reference returns false, content returns true', () => {
    const empty1 = [];
    const empty2 = [];
    assert.notEqual(empty1, empty2, 'Different empty array references');
    const prev = makeProps({ legalMoves: empty1 });
    const next = makeProps({ legalMoves: empty2 });

    // Two different [] references → areEqualReference returns false (bug)
    assert.equal(areEqualReference(prev, next), false,
      'Reference version returns false for different empty array refs');
    assert.equal(areEqualContent(prev, next), true,
      'Content version should return true for two empty arrays');
  });

  // ── One null, one empty ──────────────────────────────────────────────

  test('null vs empty array → content version returns false', () => {
    const prev = makeProps({ legalMoves: null });
    const next = makeProps({ legalMoves: [] });

    assert.equal(areEqualContent(prev, next), false, 'null != empty array');
  });

  test('undefined vs empty array → content version returns false', () => {
    const prev = makeProps({ legalMoves: undefined });
    const next = makeProps({ legalMoves: [] });

    assert.equal(areEqualContent(prev, next), false, 'undefined != empty array');
  });

  // ── Many moves — content equality ─────────────────────────────────────

  test('large move arrays with same content → content version returns true', () => {
    const moves1 = [];
    const moves2 = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) {
          // Use shared from/to arrays to represent same coordinates
          const from = [r, c];
          const to = [r + 1, c + 1];
          moves1.push({ from, to });
          moves2.push({ from: [r, c], to: [r + 1, c + 1] });
        }
      }
    }

    const prev = makeProps({ legalMoves: moves1 });
    const next = makeProps({ legalMoves: moves2 });

    assert.equal(areEqualReference(prev, next), false, 'Different references');
    assert.equal(areEqualContent(prev, next), true, 'Same content should match');
  });

  // ── movesEqual helper directly ────────────────────────────────────────

  test('movesEqual: handles captures in moves', () => {
    const moves1 = [{ from: [2, 3], to: [4, 5], captures: [[3, 4]] }];
    const moves2 = [{ from: [2, 3], to: [4, 5], captures: [[3, 4]] }];

    // movesEqual only checks from/to, captures are ignored in comparison
    assert.equal(movesEqual(moves1, moves2), true);
  });

  test('movesEqual: same reference returns true immediately', () => {
    const moves = [makeMove([0, 0], [1, 1])];
    assert.equal(movesEqual(moves, moves), true);
  });

  // ── Run all tests ─────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
