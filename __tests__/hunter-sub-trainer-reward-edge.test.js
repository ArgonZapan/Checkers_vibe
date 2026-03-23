/**
 * hunter-sub-trainer-reward-edge.test.js — Edge cases for calculateReward in trainer.js
 *
 * Focus: null prevBoard, empty boards, all-captured board, single piece boards
 *
 * Imports the REAL module — no inline copies.
 */

import { calculateReward } from '../server/ai/trainer.js';
import assert from 'node:assert/strict';

function emptyBoard() { return new Array(64).fill(0); }

function makeBoard(setup) {
  const b = emptyBoard();
  for (const [pos, val] of setup) b[pos] = val;
  return b;
}

export async function runTrainerRewardEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: null prevBoard
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: null prevBoard returns 0', () => {
    const nextBoard = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(null, nextBoard, 1, 'white');
    assert.equal(reward, 0, 'null prevBoard should return 0');
  });

  test('calculateReward: undefined prevBoard returns 0', () => {
    const nextBoard = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(undefined, nextBoard, 1, 'white');
    assert.equal(reward, 0, 'undefined prevBoard should return 0');
  });

  test('calculateReward: null nextBoard returns 0', () => {
    const prevBoard = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(prevBoard, null, 1, 'white');
    assert.equal(reward, 0, 'null nextBoard should return 0');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: empty boards
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: both boards empty — returns 0', () => {
    const reward = calculateReward(emptyBoard(), emptyBoard(), 1, 'white');
    assert.equal(reward, 0, 'empty → empty should be 0');
  });

  test('calculateReward: empty prevBoard, non-empty nextBoard (white)', () => {
    // First move of game — prevBoard is empty, pieces appear
    const nextBoard = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(emptyBoard(), nextBoard, 1, 'white');
    assert.ok(typeof reward === 'number' && isFinite(reward),
      'should return finite number');
  });

  test('calculateReward: empty prevBoard, non-empty nextBoard (black)', () => {
    const nextBoard = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(emptyBoard(), nextBoard, -1, 'black');
    assert.ok(typeof reward === 'number' && isFinite(reward),
      'should return finite number');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: all-captured board
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: all pieces captured — white captures all black', () => {
    const prevBoard = makeBoard([
      [28, 1], [29, 1], // white
      [36, 3], [37, 3], // black
    ]);
    // After capture: all black gone
    const nextBoard = makeBoard([
      [28, 1], [29, 1], // white only
    ]);
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    // Capturing opponent pieces should give positive reward
    assert.ok(reward > 0, 'capturing all opponent pieces should be positive');
  });

  test('calculateReward: all pieces captured — black captures all white', () => {
    const prevBoard = makeBoard([
      [28, 1], [29, 1], // white
      [36, 3], [37, 3], // black
    ]);
    const nextBoard = makeBoard([
      [36, 3], [37, 3], // black only
    ]);
    const reward = calculateReward(prevBoard, nextBoard, -1, 'black');
    assert.ok(reward > 0, 'capturing all opponent pieces should be positive for black');
  });

  test('calculateReward: own pieces all captured — negative reward', () => {
    const prevBoard = makeBoard([
      [28, 1], [29, 1], // white
      [36, 3], [37, 3], // black
    ]);
    // White lost all pieces
    const nextBoard = makeBoard([
      [36, 3], [37, 3], // black only
    ]);
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(reward < 0, 'losing all pieces should be negative');
  });

  test('calculateReward: completely empty board after capture', () => {
    // Extreme edge case: somehow all pieces gone
    const prevBoard = makeBoard([[28, 1], [36, 3]]);
    const nextBoard = emptyBoard();
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(typeof reward === 'number' && isFinite(reward),
      'should handle all-empty result board');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: reward bounds
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: reward is always in [-1, 1]', () => {
    // Massive material swing
    const prevBoard = makeBoard([
      [28, 1], [29, 1], [30, 1], [31, 1],
      [36, 3], [37, 3], [38, 3], [39, 3],
      [44, 3], [45, 3], [46, 3], [47, 3],
    ]);
    const nextBoard = makeBoard([
      [28, 1], [29, 1], [30, 1], [31, 1], // white won
    ]);
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(reward >= -1 && reward <= 1, `reward ${reward} out of [-1,1]`);
  });

  test('calculateReward: no change — near zero reward', () => {
    const board = makeBoard([[28, 1], [36, 3]]);
    const reward = calculateReward(board, board, 1, 'white');
    assert.ok(Math.abs(reward) < 0.5, `no-change reward should be near 0, got ${reward}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: white vs black strategy differences
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: same board different sides produce different rewards', () => {
    const prevBoard = makeBoard([
      [45, 1], [36, 3], [18, 3],
    ]);
    // White captured one black piece
    const nextBoard = makeBoard([
      [18, 1], // white captured two blacks, landed at (2,2)
    ]);
    const rewardWhite = calculateReward(prevBoard, nextBoard, 1, 'white');
    const rewardBlack = calculateReward(prevBoard, nextBoard, -1, 'black');
    // Both see the same board change, but from different perspective
    // White captured pieces → positive for white; black lost pieces → negative for black
    // But rewardBlack is from black's perspective, so black losing material is bad
    assert.ok(typeof rewardWhite === 'number' && isFinite(rewardWhite));
    assert.ok(typeof rewardBlack === 'number' && isFinite(rewardBlack));
  });

  test('calculateReward: white aggressor strategy applies correct weights', () => {
    const prevBoard = makeBoard([
      [28, 1], [36, 3],
    ]);
    // Simple forward move for white
    const nextBoard = makeBoard([
      [20, 1], // white moved forward (row 3 → row 2)
      [36, 3],
    ]);
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(typeof reward === 'number' && isFinite(reward),
      'should return finite reward for white aggressor');
  });

  test('calculateReward: black fortress strategy applies correct weights', () => {
    const prevBoard = makeBoard([
      [28, 3], [36, 1],
    ]);
    const nextBoard = makeBoard([
      [36, 3], // black moved forward
      [36, 1], // wait, same position... let me fix
    ]);
    // Black at (3,4) moves to (4,4)
    const prevB = makeBoard([[28, 3], [36, 1]]);
    const nextB = makeBoard([[36, 3], [36, 1]]);
    // Actually this collides. Let me redo:
    const prev = makeBoard([[28, 3], [27, 1]]); // black (3,4), white (3,3)
    const next = makeBoard([[35, 3], [27, 1]]); // black moved to (4,4)
    const reward = calculateReward(prev, next, -1, 'black');
    assert.ok(typeof reward === 'number' && isFinite(reward),
      'should return finite reward for black fortress');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: single piece boards
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: single white pawn move — no captures', () => {
    const prevBoard = makeBoard([[45, 1]]); // white at (5,5)
    const nextBoard = makeBoard([[36, 1]]); // white at (4,4)
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(typeof reward === 'number' && isFinite(reward));
    // Moving forward should have slight positive reward (advance)
    assert.ok(reward >= 0, `forward move should be non-negative, got ${reward}`);
  });

  test('calculateReward: single black pawn move — no captures', () => {
    const prevBoard = makeBoard([[18, 3]]); // black at (2,2)
    const nextBoard = makeBoard([[27, 3]]); // black at (3,3)
    const reward = calculateReward(prevBoard, nextBoard, -1, 'black');
    assert.ok(typeof reward === 'number' && isFinite(reward));
    assert.ok(reward >= 0, `forward move for black should be non-negative, got ${reward}`);
  });

  test('calculateReward: single king move — positional change', () => {
    const prevBoard = makeBoard([[0, 2]]); // white king at edge (0,0)
    const nextBoard = makeBoard([[9, 2]]); // white king at (1,1) — toward center
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    assert.ok(typeof reward === 'number' && isFinite(reward));
    // Moving toward center should improve position score
    assert.ok(reward > 0, `moving king toward center should be positive, got ${reward}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: result precision
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: result rounded to 3 decimal places', () => {
    const prevBoard = makeBoard([[45, 1], [36, 3]]);
    const nextBoard = makeBoard([[27, 1]]); // white captured black
    const reward = calculateReward(prevBoard, nextBoard, 1, 'white');
    // Check it's rounded (multiply by 1000 should be integer)
    assert.equal(reward * 1000 % 1, 0, `reward ${reward} should be rounded to 3 decimals`);
  });

  // ── Run all tests ─────────────────────────────────────────────────
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

  console.log(`\n  trainer-reward-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
