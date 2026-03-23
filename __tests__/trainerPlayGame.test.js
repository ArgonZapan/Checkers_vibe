/**
 * trainerPlayGame.test.js — Tests for trainer._playGame logic.
 *
 * Tests:
 * - gameOver detection (winner field, draw handling, max moves)
 * - turnColor assignment (turn === 1 → 'white', turn === -1 → 'black')
 * - Mock predict() for deterministic move selection
 * - Sample creation and result assignment
 *
 * No C++ engine or tf.js required — all mocked.
 */

import assert from 'node:assert/strict';

// ── Extracted logic from server/ai/trainer.js ───────────────────────────────

/**
 * Simulate the gameOver handling block from _playGame().
 * Returns { result, winnerStat } based on winner.
 */
function handleGameOver(winner) {
  let result = 0;
  let winnerStat;
  if (winner === 1 || winner === 'white') {
    result = 1;
    winnerStat = 'whiteWins';
  } else if (winner === -1 || winner === 'black') {
    result = -1;
    winnerStat = 'blackWins';
  } else {
    winnerStat = 'draws';
  }
  return { result, winnerStat };
}

/**
 * Simulate terminal result assignment to samples.
 */
function assignResults(samples, result) {
  const winnerTurn = result;
  for (const s of samples) {
    s.result = s.turn === winnerTurn ? 1 : winnerTurn === 0 ? 0 : -1;
  }
  if (samples.length > 0) {
    samples[samples.length - 1].done = true;
  }
  return samples;
}

/**
 * Simulate turnColor assignment from newState.turn.
 * Mirrors: turnColor = newState.turn === 1 || newState.turn === 'white' ? 'white' : 'black'
 */
function getTurnColor(turnValue) {
  return turnValue === 1 || turnValue === 'white' ? 'white' : 'black';
}

/**
 * Simulate the max moves safety check.
 */
function checkMaxMoves(moveCount, MAX_MOVES = 300) {
  return moveCount >= MAX_MOVES;
}

/**
 * Mock predict() — returns a deterministic move from legalMoves.
 * Always picks the first legal move for determinism in tests.
 */
function mockPredict(legalMoves) {
  if (!legalMoves || legalMoves.length === 0) {
    return { move: null, probabilities: {}, value: 0 };
  }
  const move = legalMoves[0];
  return {
    move,
    probabilities: { [move.index ?? 0]: 1.0 },
    value: 0.5,
  };
}

/**
 * Simulate the epsilon-greedy move selection.
 */
function selectMove(legalMoves, epsilon, predictFn) {
  if (!legalMoves || legalMoves.length === 0) return null;

  if (Math.random() < epsilon) {
    // Random legal move
    const idx = Math.floor(Math.random() * legalMoves.length);
    return legalMoves[idx];
  }
  const pred = predictFn(legalMoves);
  return pred.move;
}

/**
 * Simulate the sample creation for a single move.
 */
function createSample(board, legalMoves, chosenMove, turn) {
  return {
    board: Array.isArray(board) ? (Array.isArray(board[0]) ? board.flat() : board) : board,
    legalMoves,
    chosenMove,
    turn,
    result: 0,
    reward: 0,
    nextState: null,
    done: false,
  };
}

/**
 * Simulate empty legalMoves detection (issue #121 fix).
 */
function hasLegalMoves(legalMoves) {
  return legalMoves && legalMoves.length > 0;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runTrainerPlayGameTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // gameOver detection
  // ═══════════════════════════════════════════════════════════════════════

  test('gameOver: white wins (winner=1)', () => {
    const { result, winnerStat } = handleGameOver(1);
    assert.equal(result, 1, 'result is 1');
    assert.equal(winnerStat, 'whiteWins', 'stat is whiteWins');
  });

  test('gameOver: black wins (winner=-1)', () => {
    const { result, winnerStat } = handleGameOver(-1);
    assert.equal(result, -1, 'result is -1');
    assert.equal(winnerStat, 'blackWins', 'stat is blackWins');
  });

  test('gameOver: draw (winner=0)', () => {
    const { result, winnerStat } = handleGameOver(0);
    assert.equal(result, 0, 'result is 0');
    assert.equal(winnerStat, 'draws', 'stat is draws');
  });

  test('gameOver: white wins (winner="white")', () => {
    const { result, winnerStat } = handleGameOver('white');
    assert.equal(result, 1, 'result is 1');
    assert.equal(winnerStat, 'whiteWins', 'stat is whiteWins');
  });

  test('gameOver: black wins (winner="black")', () => {
    const { result, winnerStat } = handleGameOver('black');
    assert.equal(result, -1, 'result is -1');
    assert.equal(winnerStat, 'blackWins', 'stat is blackWins');
  });

  test('gameOver: draw (winner="draw")', () => {
    const { result, winnerStat } = handleGameOver('draw');
    assert.equal(result, 0, 'result is 0');
    assert.equal(winnerStat, 'draws', 'stat is draws');
  });

  test('gameOver: draw (winner=null)', () => {
    const { result, winnerStat } = handleGameOver(null);
    assert.equal(result, 0, 'result is 0');
    assert.equal(winnerStat, 'draws', 'stat is draws');
  });

  test('gameOver: draw (winner=undefined)', () => {
    const { result, winnerStat } = handleGameOver(undefined);
    assert.equal(result, 0, 'result is 0');
    assert.equal(winnerStat, 'draws', 'stat is draws');
  });

  test('gameOver: max moves forces draw', () => {
    const isOver = checkMaxMoves(300, 300);
    assert.equal(isOver, true, '300 >= 300 triggers game over');
  });

  test('gameOver: under max moves continues', () => {
    const isOver = checkMaxMoves(299, 300);
    assert.equal(isOver, false, '299 < 300 continues');
  });

  test('gameOver: way over max moves triggers', () => {
    const isOver = checkMaxMoves(500, 300);
    assert.equal(isOver, true, '500 >= 300 triggers');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // turnColor assignment
  // ═══════════════════════════════════════════════════════════════════════

  test('turnColor: turn=1 → "white"', () => {
    assert.equal(getTurnColor(1), 'white');
  });

  test('turnColor: turn=-1 → "black"', () => {
    assert.equal(getTurnColor(-1), 'black');
  });

  test('turnColor: turn="white" → "white"', () => {
    assert.equal(getTurnColor('white'), 'white');
  });

  test('turnColor: turn="black" → "black"', () => {
    assert.equal(getTurnColor('black'), 'black');
  });

  test('turnColor: turn=0 → "black" (not 1, not "white")', () => {
    assert.equal(getTurnColor(0), 'black');
  });

  test('turnColor: turn=2 → "black" (not 1)', () => {
    assert.equal(getTurnColor(2), 'black');
  });

  test('turnColor: turn=null → "black"', () => {
    assert.equal(getTurnColor(null), 'black');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Mock predict() — deterministic moves
  // ═══════════════════════════════════════════════════════════════════════

  test('mockPredict: returns first legal move', () => {
    const legalMoves = [
      { from: 8, to: 12, captures: [], index: 0 },
      { from: 9, to: 13, captures: [], index: 1 },
    ];
    const pred = mockPredict(legalMoves);
    assert.equal(pred.move.from, 8, 'Returns first move');
    assert.equal(pred.move.to, 12);
  });

  test('mockPredict: returns null for empty legalMoves', () => {
    const pred = mockPredict([]);
    assert.equal(pred.move, null, 'null move for empty legalMoves');
  });

  test('mockPredict: returns null for null legalMoves', () => {
    const pred = mockPredict(null);
    assert.equal(pred.move, null, 'null move for null legalMoves');
  });

  test('selectMove: epsilon=0 always uses predict (deterministic)', () => {
    const legalMoves = [
      { from: 8, to: 12, captures: [], index: 0 },
      { from: 9, to: 13, captures: [], index: 1 },
    ];
    // With epsilon=0, always uses predict → always returns first move
    for (let i = 0; i < 10; i++) {
      const move = selectMove(legalMoves, 0, mockPredict);
      assert.equal(move.from, 8, `Iteration ${i}: deterministic first move`);
    }
  });

  test('selectMove: epsilon=1 always random', () => {
    const legalMoves = [
      { from: 8, to: 12, captures: [], index: 0 },
      { from: 9, to: 13, captures: [], index: 1 },
    ];
    // With epsilon=1, always random — just verify it returns a valid move
    for (let i = 0; i < 20; i++) {
      const move = selectMove(legalMoves, 1, mockPredict);
      assert.ok(move !== null, `Iteration ${i}: move is not null`);
      assert.ok(
        legalMoves.some(m => m.from === move.from && m.to === move.to),
        `Iteration ${i}: move is from legalMoves`
      );
    }
  });

  test('selectMove: null legalMoves returns null', () => {
    const move = selectMove(null, 0, mockPredict);
    assert.equal(move, null, 'null legalMoves → null move');
  });

  test('selectMove: empty legalMoves returns null', () => {
    const move = selectMove([], 0, mockPredict);
    assert.equal(move, null, 'empty legalMoves → null move');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Empty legalMoves detection (issue #121)
  // ═══════════════════════════════════════════════════════════════════════

  test('hasLegalMoves: [] → false', () => {
    assert.equal(hasLegalMoves([]), false);
  });

  test('hasLegalMoves: null → falsy', () => {
    assert.ok(!hasLegalMoves(null), 'null is falsy');
  });

  test('hasLegalMoves: undefined → falsy', () => {
    assert.ok(!hasLegalMoves(undefined), 'undefined is falsy');
  });

  test('hasLegalMoves: [move] → true', () => {
    assert.equal(hasLegalMoves([{ from: 0, to: 1 }]), true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Sample creation and result assignment
  // ═══════════════════════════════════════════════════════════════════════

  test('createSample: creates sample with correct structure', () => {
    const board = new Array(64).fill(0);
    const legalMoves = [{ from: 8, to: 12, captures: [], index: 0 }];
    const chosenMove = legalMoves[0];

    const sample = createSample(board, legalMoves, chosenMove, 1);

    assert.ok(Array.isArray(sample.board), 'board is array');
    assert.equal(sample.board.length, 64, 'board has 64 cells');
    assert.equal(sample.turn, 1, 'turn is 1');
    assert.equal(sample.result, 0, 'result is 0 (placeholder)');
    assert.equal(sample.done, false, 'done is false');
    assert.equal(sample.chosenMove.from, 8, 'chosenMove correct');
  });

  test('createSample: flattens 2D board', () => {
    const board2d = [];
    for (let r = 0; r < 8; r++) board2d.push(new Array(8).fill(0));
    const legalMoves = [{ from: 0, to: 1, index: 0 }];
    const sample = createSample(board2d, legalMoves, legalMoves[0], -1);

    assert.equal(sample.board.length, 64, '2D board flattened to 64');
    assert.equal(sample.turn, -1, 'turn is -1');
  });

  test('assignResults: white wins', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
      { turn: 1, result: 0, done: false },
    ];

    assignResults(samples, 1); // white wins

    assert.equal(samples[0].result, 1, 'white move → +1');
    assert.equal(samples[1].result, -1, 'black move → -1');
    assert.equal(samples[2].result, 1, 'white move → +1');
    assert.equal(samples[2].done, true, 'last sample marked done');
  });

  test('assignResults: black wins', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignResults(samples, -1); // black wins

    assert.equal(samples[0].result, -1, 'white move → -1');
    assert.equal(samples[1].result, 1, 'black move → +1');
    assert.equal(samples[1].done, true, 'last sample done');
  });

  test('assignResults: draw', () => {
    const samples = [
      { turn: 1, result: 0, done: false },
      { turn: -1, result: 0, done: false },
    ];

    assignResults(samples, 0); // draw

    assert.equal(samples[0].result, 0, 'white move → 0');
    assert.equal(samples[1].result, 0, 'black move → 0');
    assert.equal(samples[1].done, true, 'last sample done');
  });

  test('assignResults: empty samples', () => {
    const samples = [];
    assignResults(samples, 1);
    assert.equal(samples.length, 0, 'no crash on empty');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Trainer _playGame Tests (gameOver, turnColor, mock predict)');

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
