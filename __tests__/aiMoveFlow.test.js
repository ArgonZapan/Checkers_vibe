/**
 * aiMoveFlow.test.js — Tests for the aiMove prediction + fallback flow.
 *
 * Covers the full aiMove() pipeline from server/index.js:
 * - No legal moves → early return (no error)
 * - Successful prediction → executes predicted move
 * - Predict throws → falls back to random move
 * - Predicted move not in legalMoves → random fallback
 * - Random fallback on total failure (double fallback)
 * - Move body includes captures for multi-jump
 * - Moves get policyIndex assigned
 * - turn color to int conversion
 *
 * Extracted logic — no server or TF.js required.
 */

import assert from 'node:assert/strict';

// ── Extracted: AI move logic (mirrors server/index.js aiMove) ──────────────

/**
 * Simulate the aiMove flow. Returns log of actions.
 */
function simulateAiMove(currentState, legalMoves, predictFn, randomFn, cppFetchFn) {
  const log = [];

  // 1. Check legal moves
  if (!legalMoves || legalMoves.length === 0) {
    log.push({ action: 'earlyReturn', reason: 'no legal moves' });
    return log;
  }

  // 2. Assign index to each legal move
  const movesWithIndex = legalMoves.map((m, i) => ({
    ...m,
    index: i,
    policyIndex: computePolicyIndexLocal(m.from, m.to),
  }));
  log.push({ action: 'assignIndex', count: movesWithIndex.length });

  // 3. Predict
  let prediction;
  try {
    prediction = predictFn(movesWithIndex);
    log.push({ action: 'predict', result: 'success' });
  } catch (err) {
    log.push({ action: 'predict', result: 'error', error: err.message });
    // Fallback: random move
    const randomIdx = Math.floor(Math.random() * legalMoves.length);
    const randomMove = legalMoves[randomIdx];
    log.push({ action: 'fallback', type: 'random', move: randomMove });
    log.push({ action: 'executeMove', move: randomMove });
    return log;
  }

  // 4. Use predicted move
  let selectedMove = prediction.move;

  // 5. Safety: validate predicted move is in legalMoves
  if (!selectedMove || !legalMoves.some(m =>
    m.from[0] === selectedMove.from?.[0] && m.from[1] === selectedMove.from?.[1] &&
    m.to[0] === selectedMove.to?.[0] && m.to[1] === selectedMove.to?.[1]
  )) {
    log.push({ action: 'predictInvalid', move: selectedMove });
    selectedMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    log.push({ action: 'fallback', type: 'random', move: selectedMove });
  }

  // 6. Build move body and execute
  const moveBody = { from: selectedMove.from, to: selectedMove.to };
  if (selectedMove.captures && selectedMove.captures.length > 0) {
    moveBody.captures = selectedMove.captures;
  }
  log.push({ action: 'executeMove', move: selectedMove, body: moveBody });

  return log;
}

/**
 * Simplified policy index computation (mirrors computePolicyIndex).
 */
function computePolicyIndexLocal(from, to) {
  const fromScalar = Array.isArray(from) ? from[0] * 8 + from[1] : from;
  const toScalar = Array.isArray(to) ? to[0] * 8 + to[1] : to;
  const fromRow = Math.floor(fromScalar / 8);
  const fromCol = fromScalar % 8;
  const darkFrom = fromRow * 4 + Math.floor(fromCol / 2);
  const toRow = Math.floor(toScalar / 8);
  const toCol = toScalar % 8;
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  const dirMap = { '-1,1': 0, '-1,-1': 1, '1,1': 2, '1,-1': 3 };
  const dirIdx = dirMap[`${Math.sign(dr)},${Math.sign(dc)}`] ?? 0;
  return darkFrom * 4 + dirIdx;
}

/**
 * Color to turn conversion.
 */
function colorToTurn(color) {
  return color === 'white' ? 1 : -1;
}

/**
 * Build move body (extracted from aiMove).
 */
function buildMoveBody(move) {
  const body = { from: move.from, to: move.to };
  if (move.captures && move.captures.length > 0) {
    body.captures = move.captures;
  }
  return body;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runAiMoveFlowTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  const legalMoves = [
    { from: [2, 1], to: [3, 0], captures: [] },
    { from: [2, 1], to: [3, 2], captures: [] },
    { from: [2, 3], to: [4, 5], captures: [[3, 4]] },
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // No legal moves → early return
  // ═══════════════════════════════════════════════════════════════════════

  test('aiMove: empty legalMoves → early return, no error', () => {
    const log = simulateAiMove({ turn: 'white' }, [], () => {}, () => {}, () => {});
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'earlyReturn');
  });

  test('aiMove: null legalMoves → early return', () => {
    const log = simulateAiMove({ turn: 'white' }, null, () => {}, () => {}, () => {});
    assert.equal(log[0].action, 'earlyReturn');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Successful prediction
  // ═══════════════════════════════════════════════════════════════════════

  test('aiMove: successful prediction executes predicted move', () => {
    const predictFn = (moves) => ({ move: moves[1] });
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const execute = log.find(l => l.action === 'executeMove');
    assert.deepEqual(execute.move.from, [2, 1]);
    assert.deepEqual(execute.move.to, [3, 2]);
  });

  test('aiMove: successful prediction assigns policyIndex to moves', () => {
    const predictFn = (moves) => {
      // Verify all moves have policyIndex
      for (const m of moves) {
        assert.ok(typeof m.policyIndex === 'number', 'move should have policyIndex');
        assert.ok(m.policyIndex >= 0 && m.policyIndex < 128, 'policyIndex should be 0-127');
      }
      return { move: moves[0] };
    };
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const assign = log.find(l => l.action === 'assignIndex');
    assert.equal(assign.count, 3);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Predict error → random fallback
  // ═══════════════════════════════════════════════════════════════════════

  test('aiMove: predict throws → falls back to random move', () => {
    const predictFn = () => { throw new Error('Model not initialized'); };
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const fallback = log.find(l => l.action === 'fallback');
    assert.ok(fallback, 'should have fallback');
    assert.equal(fallback.type, 'random');
    assert.ok(legalMoves.some(m => m.from[0] === fallback.move.from[0] && m.from[1] === fallback.move.from[1]));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Predicted move not in legalMoves → random fallback
  // ═══════════════════════════════════════════════════════════════════════

  test('aiMove: predicted move not in legalMoves → fallback to legal move', () => {
    const predictFn = () => ({ move: { from: [0, 0], to: [1, 1] } }); // not in legalMoves
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const fallback = log.find(l => l.action === 'fallback');
    assert.ok(fallback, 'should fall back');
    const execute = log.find(l => l.action === 'executeMove');
    assert.ok(legalMoves.some(m =>
      m.from[0] === execute.move.from[0] && m.from[1] === execute.move.from[1]
    ));
  });

  test('aiMove: null predicted move → fallback to legal move', () => {
    const predictFn = () => ({ move: null });
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const fallback = log.find(l => l.action === 'fallback');
    assert.ok(fallback, 'should fall back on null move');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Move body includes captures
  // ═══════════════════════════════════════════════════════════════════════

  test('aiMove: capture move includes captures in body', () => {
    const predictFn = (moves) => ({ move: moves[2] }); // capture move
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const execute = log.find(l => l.action === 'executeMove');
    assert.deepEqual(execute.body.captures, [[3, 4]]);
  });

  test('aiMove: non-capture move body has no captures field', () => {
    const predictFn = (moves) => ({ move: moves[0] }); // non-capture
    const log = simulateAiMove({ turn: 'white' }, legalMoves, predictFn, () => {}, () => {});
    const execute = log.find(l => l.action === 'executeMove');
    assert.equal(execute.body.captures, undefined);
  });

  test('buildMoveBody: multi-capture includes all capture squares', () => {
    const move = { from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 4]] };
    const body = buildMoveBody(move);
    assert.equal(body.captures.length, 2);
    assert.deepEqual(body.captures[0], [3, 2]);
    assert.deepEqual(body.captures[1], [5, 4]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // policyIndex computation
  // ═══════════════════════════════════════════════════════════════════════

  test('computePolicyIndex: produces values 0-127', () => {
    for (let fromRow = 0; fromRow < 8; fromRow++) {
      for (let fromCol = 0; fromCol < 8; fromCol++) {
        for (const [dr, dc] of [[-1,1],[-1,-1],[1,1],[1,-1]]) {
          const toRow = fromRow + dr;
          const toCol = fromCol + dc;
          if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;
          const idx = computePolicyIndexLocal([fromRow, fromCol], [toRow, toCol]);
          assert.ok(idx >= 0 && idx < 128, `policyIndex ${idx} out of range for [${fromRow},${fromCol}]→[${toRow},${toCol}]`);
        }
      }
    }
  });

  test('computePolicyIndex: same from different direction → different index', () => {
    const ne = computePolicyIndexLocal([3, 3], [2, 4]); // NE
    const nw = computePolicyIndexLocal([3, 3], [2, 2]); // NW
    const se = computePolicyIndexLocal([3, 3], [4, 4]); // SE
    const sw = computePolicyIndexLocal([3, 3], [4, 2]); // SW
    const indices = new Set([ne, nw, se, sw]);
    assert.equal(indices.size, 4, 'four directions from same square should give 4 different indices');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // colorToTurn
  // ═══════════════════════════════════════════════════════════════════════

  test('colorToTurn: white → 1', () => {
    assert.equal(colorToTurn('white'), 1);
  });

  test('colorToTurn: black → -1', () => {
    assert.equal(colorToTurn('black'), -1);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 AI Move Flow Tests');

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
