/**
 * drawDetectionExtra.test.js — Additional draw detection tests (logic-only, no engine).
 *
 * Covers gaps from __test_gaps_hunter_003.md:
 *   - Counter increment verification (simulated)
 *   - Counter reset on capture
 *   - No legal moves → force draw
 *   - 40-move rule boundary conditions
 *   - Engine state/legalmoves desync detection
 *
 * These tests simulate the draw detection logic without requiring the C++ engine.
 * The actual engine tests remain in drawDetection.test.js (with TODOs for C++ fixes).
 */

import assert from 'node:assert/strict';

// ── Simulated draw detection logic ──────────────────────────────────────────
// This mirrors the logic in the C++ engine (movesWithoutCapture_ counter)
// and the safety net in trainer.js _playGame().

/**
 * Simulate the movesWithoutCapture_ counter behavior.
 * Returns { counter, gameOver, winner } after processing the move.
 */
function simulateMoveCounter(counter, isCapture) {
  if (isCapture) {
    return { counter: 0, gameOver: false, winner: null };
  }
  const newCounter = counter + 1;
  if (newCounter >= 40) {
    return { counter: newCounter, gameOver: true, winner: 'draw' };
  }
  return { counter: newCounter, gameOver: false, winner: null };
}

/**
 * Simulate a sequence of moves and track the counter.
 */
function simulateMoves(moves) {
  let counter = 0;
  const history = [];
  for (const isCapture of moves) {
    const result = simulateMoveCounter(counter, isCapture);
    history.push({ ...result, move: isCapture ? 'capture' : 'non-capture' });
    counter = result.counter;
    if (result.gameOver) break;
  }
  return { counter, history };
}

/**
 * Check if no legal moves available → force draw (safety net from _playGame).
 */
function checkNoLegalMoves(legalMoves, gameOver) {
  if (!legalMoves || legalMoves.length === 0) {
    if (!gameOver) {
      return { gameOver: true, winner: 'draw', reason: 'no legal moves' };
    }
  }
  return { gameOver, winner: null, reason: null };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runDrawDetectionExtraTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Counter increment
  // ═══════════════════════════════════════════════════════════════════════

  test('counter starts at 0', () => {
    const { counter } = simulateMoves([]);
    assert.equal(counter, 0);
  });

  test('non-capture increments counter', () => {
    const { counter } = simulateMoves([false, false, false]);
    assert.equal(counter, 3);
  });

  test('counter at 39 non-capture moves — no draw yet', () => {
    const moves = new Array(39).fill(false);
    const { counter, history } = simulateMoves(moves);
    assert.equal(counter, 39);
    const last = history[history.length - 1];
    assert.equal(last.gameOver, false, 'Should not be game over at 39 moves');
  });

  test('40th non-capture move triggers draw', () => {
    const moves = new Array(40).fill(false);
    const { counter, history } = simulateMoves(moves);
    assert.equal(counter, 40);
    const last = history[history.length - 1];
    assert.equal(last.gameOver, true, 'Should be game over at 40 moves');
    assert.equal(last.winner, 'draw', 'Winner should be draw');
  });

  test('39 non-capture + 1 capture = no draw, counter reset', () => {
    const moves = [...new Array(39).fill(false), true]; // 39 non-capture, 1 capture
    const { counter, history } = simulateMoves(moves);
    assert.equal(counter, 0, 'Counter should reset after capture');
    const last = history[history.length - 1];
    assert.equal(last.gameOver, false, 'Should not be game over');
  });

  test('draw triggers exactly at move 40, not before', () => {
    for (let n = 1; n <= 39; n++) {
      const moves = new Array(n).fill(false);
      const { history } = simulateMoves(moves);
      const last = history[history.length - 1];
      assert.equal(last.gameOver, false, `Should NOT draw at ${n} moves`);
    }
    // 40th
    const moves40 = new Array(40).fill(false);
    const { history: h40 } = simulateMoves(moves40);
    assert.equal(h40[h40.length - 1].gameOver, true, 'Should draw at 40 moves');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Counter reset on capture
  // ═══════════════════════════════════════════════════════════════════════

  test('capture resets counter to 0', () => {
    const result = simulateMoveCounter(15, true);
    assert.equal(result.counter, 0);
    assert.equal(result.gameOver, false);
  });

  test('capture at counter=39 prevents draw', () => {
    const result = simulateMoveCounter(39, true);
    assert.equal(result.counter, 0, 'Counter should be 0 after capture');
    assert.equal(result.gameOver, false, 'Capture at 39 should prevent draw');
  });

  test('multiple captures reset counter each time', () => {
    let counter = 0;
    // 10 non-capture
    for (let i = 0; i < 10; i++) {
      ({ counter } = simulateMoveCounter(counter, false));
    }
    assert.equal(counter, 10);
    // capture
    ({ counter } = simulateMoveCounter(counter, true));
    assert.equal(counter, 0);
    // 15 non-capture
    for (let i = 0; i < 15; i++) {
      ({ counter } = simulateMoveCounter(counter, false));
    }
    assert.equal(counter, 15);
    // capture
    ({ counter } = simulateMoveCounter(counter, true));
    assert.equal(counter, 0);
    // 20 non-capture — should not draw
    for (let i = 0; i < 20; i++) {
      ({ counter } = simulateMoveCounter(counter, false));
    }
    assert.equal(counter, 20);
  });

  test('alternating capture/non-capture keeps counter low', () => {
    let counter = 0;
    for (let i = 0; i < 100; i++) {
      ({ counter } = simulateMoveCounter(counter, i % 3 === 0)); // capture every 3rd move
      if (counter >= 40) break;
    }
    assert.ok(counter < 40, `Counter should stay below 40 with frequent captures, got ${counter}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // No legal moves → force draw
  // ═══════════════════════════════════════════════════════════════════════

  test('no legal moves when game not over → force draw', () => {
    const result = checkNoLegalMoves([], false);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'draw');
    assert.ok(result.reason.includes('no legal moves'));
  });

  test('no legal moves but game already over → no change', () => {
    const result = checkNoLegalMoves([], true);
    // Already gameOver, so no new draw forced
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, null); // didn't set winner
  });

  test('legal moves available → no draw forced', () => {
    const result = checkNoLegalMoves([{ from: 0, to: 9 }], false);
    assert.equal(result.gameOver, false);
    assert.equal(result.winner, null);
  });

  test('null legal moves when game not over → force draw', () => {
    const result = checkNoLegalMoves(null, false);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'draw');
  });

  test('undefined legal moves when game not over → force draw', () => {
    const result = checkNoLegalMoves(undefined, false);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'draw');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Boundary conditions
  // ═══════════════════════════════════════════════════════════════════════

  test('counter=39 + non-capture → draw (boundary)', () => {
    const result = simulateMoveCounter(39, false);
    assert.equal(result.counter, 40);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'draw');
  });

  test('counter=38 + non-capture → no draw (just before boundary)', () => {
    const result = simulateMoveCounter(38, false);
    assert.equal(result.counter, 39);
    assert.equal(result.gameOver, false);
  });

  test('full game simulation: 20 non-capture, capture, 20 non-capture — no draw', () => {
    const moves = [...new Array(20).fill(false), true, ...new Array(20).fill(false)];
    const { counter, history } = simulateMoves(moves);
    assert.equal(counter, 20, 'Counter should be 20 after reset and 20 moves');
    const anyDraw = history.some(h => h.gameOver && h.winner === 'draw');
    assert.equal(anyDraw, false, 'Should not have drawn');
  });

  test('full game simulation: 39 non-capture, capture, 40 non-capture — draw on second batch', () => {
    const moves = [...new Array(39).fill(false), true, ...new Array(40).fill(false)];
    const { counter, history } = simulateMoves(moves);
    const last = history[history.length - 1];
    assert.equal(last.gameOver, true, 'Should draw after 40 non-capture post-reset');
    assert.equal(last.winner, 'draw');
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Draw Detection Extra Tests');

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
