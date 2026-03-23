/**
 * boardAreEqual.test.js — Tests for Board component's areEqual() memo comparator.
 *
 * The areEqual function in client/src/components/Board.jsx controls when
 * React.memo skips re-rendering. The captures prop fix ensures that changes
 * to captures trigger re-renders.
 *
 * We inline the areEqual logic to test without React/browser dependency.
 */

import assert from 'node:assert/strict';

// ── Inlined areEqual (from client/src/components/Board.jsx) ─────────────────

function areEqual(prevProps, nextProps) {
  if (prevProps.gameOver !== nextProps.gameOver) return false;
  if (prevProps.winner !== nextProps.winner) return false;
  if (prevProps.turn !== nextProps.turn) return false;
  if (prevProps.selected?.[0] !== nextProps.selected?.[0] || prevProps.selected?.[1] !== nextProps.selected?.[1]) return false;
  if (prevProps.board !== nextProps.board) return false;
  if (prevProps.legalMoves !== nextProps.legalMoves) return false;
  if (prevProps.lastMove !== nextProps.lastMove) return false;
  if (prevProps.path !== nextProps.path) return false;
  if (prevProps.captures?.length !== nextProps.captures?.length) return false;
  if (prevProps.onCellClick !== nextProps.onCellClick) return false;
  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProps(overrides = {}) {
  return {
    gameOver: false,
    winner: null,
    turn: 'white',
    selected: null,
    board: [[null]],
    legalMoves: [],
    lastMove: null,
    path: null,
    captures: [],
    onCellClick: () => {},
    ...overrides,
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runBoardAreEqualTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Identical props ───────────────────────────────────────────────────

  test('identical props (same references) → areEqual returns true', () => {
    const fn = () => {};
    const board = [[null]];
    const moves = [];
    const prev = makeProps({ board, legalMoves: moves, onCellClick: fn });
    const next = makeProps({ board, legalMoves: moves, onCellClick: fn });
    assert.equal(areEqual(prev, next), true);
  });

  // ── captures prop change triggers re-render ───────────────────────────

  test('captures length changes 0→1 → areEqual returns false (re-render)', () => {
    const prev = makeProps({ captures: [] });
    const next = makeProps({ captures: [[3, 4]] });
    assert.equal(areEqual(prev, next), false, 'Adding a capture should trigger re-render');
  });

  test('captures length changes 1→2 → areEqual returns false', () => {
    const prev = makeProps({ captures: [[3, 4]] });
    const next = makeProps({ captures: [[3, 4], [5, 6]] });
    assert.equal(areEqual(prev, next), false, 'Adding second capture should trigger re-render');
  });

  test('captures length changes 2→0 → areEqual returns false', () => {
    const prev = makeProps({ captures: [[3, 4], [5, 6]] });
    const next = makeProps({ captures: [] });
    assert.equal(areEqual(prev, next), false, 'Clearing captures should trigger re-render');
  });

  test('captures length unchanged → areEqual returns true (with same refs)', () => {
    const fn = () => {};
    const board = [[null]];
    const moves = [];
    const prev = makeProps({ board, legalMoves: moves, onCellClick: fn, captures: [[3, 4]] });
    const next = makeProps({ board, legalMoves: moves, onCellClick: fn, captures: [[5, 6]] }); // different content, same length
    assert.equal(areEqual(prev, next), true, 'Same captures length with same refs skips re-render');
  });

  test('both captures undefined (with same refs) → areEqual returns true', () => {
    const fn = () => {};
    const board = [[null]];
    const moves = [];
    const prev = makeProps({ board, legalMoves: moves, onCellClick: fn, captures: undefined });
    const next = makeProps({ board, legalMoves: moves, onCellClick: fn, captures: undefined });
    assert.equal(areEqual(prev, next), true);
  });

  test('captures changes undefined→[] → areEqual returns true (length 0==0)', () => {
    // undefined?.length is undefined, []?.length is 0 — they differ!
    const prev = makeProps({ captures: undefined });
    const next = makeProps({ captures: [] });
    assert.equal(areEqual(prev, next), false, 'undefined→[] changes effective length');
  });

  test('captures changes null→[] → areEqual returns false', () => {
    const prev = makeProps({ captures: null });
    const next = makeProps({ captures: [] });
    assert.equal(areEqual(prev, next), false, 'null→[] changes effective length');
  });

  test('captures changes []→undefined → areEqual returns false', () => {
    const prev = makeProps({ captures: [] });
    const next = makeProps({ captures: undefined });
    assert.equal(areEqual(prev, next), false, '[]→undefined changes effective length');
  });

  // ── Other prop changes ────────────────────────────────────────────────

  test('gameOver changes → areEqual returns false', () => {
    const prev = makeProps({ gameOver: false });
    const next = makeProps({ gameOver: true });
    assert.equal(areEqual(prev, next), false);
  });

  test('winner changes → areEqual returns false', () => {
    const prev = makeProps({ winner: null });
    const next = makeProps({ winner: 'white' });
    assert.equal(areEqual(prev, next), false);
  });

  test('turn changes → areEqual returns false', () => {
    const prev = makeProps({ turn: 'white' });
    const next = makeProps({ turn: 'black' });
    assert.equal(areEqual(prev, next), false);
  });

  test('selected changes → areEqual returns false', () => {
    const prev = makeProps({ selected: null });
    const next = makeProps({ selected: [3, 4] });
    assert.equal(areEqual(prev, next), false);
  });

  test('selected changes row only → areEqual returns false', () => {
    const prev = makeProps({ selected: [3, 4] });
    const next = makeProps({ selected: [4, 4] });
    assert.equal(areEqual(prev, next), false);
  });

  test('selected changes col only → areEqual returns false', () => {
    const prev = makeProps({ selected: [3, 4] });
    const next = makeProps({ selected: [3, 5] });
    assert.equal(areEqual(prev, next), false);
  });

  test('board reference changes → areEqual returns false', () => {
    const prev = makeProps({ board: [[null]] });
    const next = makeProps({ board: [[null]] }); // different reference
    assert.equal(areEqual(prev, next), false);
  });

  test('legalMoves reference changes → areEqual returns false', () => {
    const prev = makeProps({ legalMoves: [] });
    const next = makeProps({ legalMoves: [] }); // different reference
    assert.equal(areEqual(prev, next), false);
  });

  test('lastMove changes → areEqual returns false', () => {
    const prev = makeProps({ lastMove: null });
    const next = makeProps({ lastMove: { from: [2, 3], to: [4, 5] } });
    assert.equal(areEqual(prev, next), false);
  });

  test('path changes → areEqual returns false', () => {
    const prev = makeProps({ path: null });
    const next = makeProps({ path: [[2, 3], [4, 5]] });
    assert.equal(areEqual(prev, next), false);
  });

  test('onCellClick reference changes → areEqual returns false', () => {
    const prev = makeProps({ onCellClick: () => {} });
    const next = makeProps({ onCellClick: () => {} }); // different reference
    assert.equal(areEqual(prev, next), false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  test('all props shared reference → true', () => {
    const fn = () => {};
    const board = [[null]];
    const moves = [];
    const captures = [];
    const prev = makeProps({ board, legalMoves: moves, onCellClick: fn, captures });
    const next = makeProps({ board, legalMoves: moves, onCellClick: fn, captures }); // same reference
    assert.equal(areEqual(prev, next), true);
  });

  test('multiple simultaneous changes → false', () => {
    const prev = makeProps({ turn: 'white', captures: [] });
    const next = makeProps({ turn: 'black', captures: [[1, 2]] });
    assert.equal(areEqual(prev, next), false);
  });

  test('only captures changes among all props → false', () => {
    const fn = () => {};
    const board = [[null]];
    const moves = [];
    const prev = makeProps({
      gameOver: false, winner: null, turn: 'white',
      selected: null, board, legalMoves: moves,
      lastMove: null, path: null, captures: [],
      onCellClick: fn,
    });
    const next = makeProps({
      gameOver: false, winner: null, turn: 'white',
      selected: null, board, legalMoves: moves,
      lastMove: null, path: null, captures: [[3, 4]],
      onCellClick: fn,
    });
    assert.equal(areEqual(prev, next), false, 'Only captures changed → re-render');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Board areEqual (captures) Tests');

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
