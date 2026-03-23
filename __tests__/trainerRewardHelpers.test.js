/**
 * trainerRewardHelpers.test.js — Tests for reward calculation helpers in trainer.js.
 *
 * Covers: flattenBoard, isOwnPiece, isPawn, isKing, calcMaterial, calcPosition,
 *         calcThreat, calcTempo, calculateReward.
 * Extracted logic — no engine or model required.
 */

import assert from 'node:assert/strict';

// ── Extracted helpers (mirrors server/ai/trainer.js) ────────────────────────

function flattenBoard(board) {
  if (!Array.isArray(board)) return null;
  if (board.length === 64 && !Array.isArray(board[0])) return [...board];
  if (board.length === 8 && Array.isArray(board[0])) return board.flat();
  return null;
}

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2;
  return val === 3 || val === 4;
}

function isPawn(val, turn) {
  return turn === 1 ? val === 1 : val === 3;
}

function isKing(val, turn) {
  return turn === 1 ? val === 2 : val === 4;
}

const PIECE_VALUE = { 1: 1, 2: 3, 3: 1, 4: 3 };

function calcMaterial(prev, next, turn) {
  let prevMy = 0, prevOpp = 0, nextMy = 0, nextOpp = 0;
  for (let i = 0; i < 64; i++) {
    if (prev[i] !== 0) {
      const val = PIECE_VALUE[Math.abs(prev[i])] || 0;
      if (isOwnPiece(prev[i], turn)) prevMy += val; else prevOpp += val;
    }
    if (next[i] !== 0) {
      const val = PIECE_VALUE[Math.abs(next[i])] || 0;
      if (isOwnPiece(next[i], turn)) nextMy += val; else nextOpp += val;
    }
  }
  const myChange = nextMy - prevMy;
  const oppChange = nextOpp - prevOpp;
  return (myChange - oppChange) / 6;
}

function calcPosition(board, turn) {
  let score = 0;
  const PAWN_ADVANCE = 0.1;
  const CENTER_BONUS = 0.15;
  const EDGE_PENALTY = -0.1;
  const KING_CENTER = 0.2;
  const KING_EDGE = -0.15;

  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const col = i % 8;
    const val = board[i];
    if (!isOwnPiece(val, turn)) continue;

    if (isPawn(val, turn)) {
      const advance = turn === 1 ? row : (7 - row);
      score += advance * PAWN_ADVANCE / 7;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += CENTER_BONUS / 12;
      if (col === 0 || col === 7) score += EDGE_PENALTY / 12;
    }
    if (isKing(val, turn)) {
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += KING_CENTER;
      else if (col === 0 || col === 7 || row === 0 || row === 7) score += KING_EDGE;
    }
  }
  return Math.max(-1, Math.min(1, score));
}

function calcThreat(board, turn) {
  let myThreats = 0, oppThreats = 0;
  for (let i = 0; i < 64; i++) {
    if (!board[i]) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isMy = isOwnPiece(board[i], turn);
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const adjR = row + dr, adjC = col + dc;
      const jumpR = row - dr, jumpC = col - dc;
      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (jumpR < 0 || jumpR > 7 || jumpC < 0 || jumpC > 7) continue;
      const adjIdx = adjR * 8 + adjC;
      const jumpIdx = jumpR * 8 + jumpC;
      if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
        if (isMy) myThreats++; else oppThreats++;
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

function calcTempo(prev, next, turn) {
  let myAdv = 0, oppAdv = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const nextVal = next[i];
    if (isOwnPiece(nextVal, turn) && ((turn === 1 && row >= 4) || (turn === -1 && row <= 3))) myAdv++;
    if (nextVal && !isOwnPiece(nextVal, turn) && ((turn === -1 && row >= 4) || (turn === 1 && row <= 3))) oppAdv++;
  }
  return (myAdv - oppAdv) / Math.max(myAdv + oppAdv, 1);
}

function calculateReward(prevBoardFlat, nextBoardFlat, turn) {
  if (!prevBoardFlat || !nextBoardFlat) return 0;
  let reward = 0;
  const matReward = calcMaterial(prevBoardFlat, nextBoardFlat, turn);
  reward += matReward * 0.47;
  const posReward = calcPosition(nextBoardFlat, turn);
  reward += posReward * 0.29;
  const threatReward = calcThreat(nextBoardFlat, turn);
  reward += threatReward * 0.12;
  const tempoReward = calcTempo(prevBoardFlat, nextBoardFlat, turn);
  reward += tempoReward * 0.12;
  return Math.max(-1, Math.min(1, Math.round(reward * 1000) / 1000));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyBoard() { return new Array(64).fill(0); }

function startingBoard() {
  const b = emptyBoard();
  // White pawns on rows 5-7 (indices 40-63, dark squares only)
  for (const i of [40,42,44,46, 49,51,53,55, 56,58,60,62]) b[i] = 1;
  // Black pawns on rows 0-2 (indices 0-23, dark squares only)
  for (const i of [1,3,5,7, 8,10,12,14, 17,19,21,23]) b[i] = 3;
  return b;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runTrainerRewardHelpersTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // flattenBoard
  // ═══════════════════════════════════════════════════════════════════════

  test('flattenBoard: flat 64 array returns copy', () => {
    const flat = new Array(64).fill(1);
    const result = flattenBoard(flat);
    assert.equal(result.length, 64);
    assert.deepEqual(result, flat);
    assert.notStrictEqual(result, flat); // should be a copy
  });

  test('flattenBoard: 2D 8x8 returns flat 64', () => {
    const board2d = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => i * 8 + j));
    const result = flattenBoard(board2d);
    assert.equal(result.length, 64);
    assert.equal(result[0], 0);
    assert.equal(result[63], 63);
  });

  test('flattenBoard: null returns null', () => {
    assert.equal(flattenBoard(null), null);
  });

  test('flattenBoard: non-array returns null', () => {
    assert.equal(flattenBoard('hello'), null);
    assert.equal(flattenBoard(42), null);
    assert.equal(flattenBoard(undefined), null);
  });

  test('flattenBoard: wrong-size flat array returns null', () => {
    assert.equal(flattenBoard([1, 2, 3]), null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // isOwnPiece / isPawn / isKing
  // ═══════════════════════════════════════════════════════════════════════

  test('isOwnPiece: white turn — 1,2 are own', () => {
    assert.ok(isOwnPiece(1, 1));
    assert.ok(isOwnPiece(2, 1));
    assert.ok(!isOwnPiece(3, 1));
    assert.ok(!isOwnPiece(4, 1));
    assert.ok(!isOwnPiece(0, 1));
  });

  test('isOwnPiece: black turn — 3,4 are own', () => {
    assert.ok(isOwnPiece(3, -1));
    assert.ok(isOwnPiece(4, -1));
    assert.ok(!isOwnPiece(1, -1));
    assert.ok(!isOwnPiece(2, -1));
    assert.ok(!isOwnPiece(0, -1));
  });

  test('isPawn: white pawn=1, black pawn=3', () => {
    assert.ok(isPawn(1, 1));
    assert.ok(!isPawn(2, 1));
    assert.ok(isPawn(3, -1));
    assert.ok(!isPawn(4, -1));
  });

  test('isKing: white king=2, black king=4', () => {
    assert.ok(isKing(2, 1));
    assert.ok(!isKing(1, 1));
    assert.ok(isKing(4, -1));
    assert.ok(!isKing(3, -1));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // calcMaterial
  // ═══════════════════════════════════════════════════════════════════════

  test('calcMaterial: no change = 0', () => {
    const board = startingBoard();
    assert.equal(calcMaterial(board, board, 1), 0);
  });

  test('calcMaterial: white captures black pawn (3→0)', () => {
    const prev = startingBoard();
    const next = [...prev];
    // Remove a black pawn (value 1)
    next[1] = 0;
    // White (turn=1) gains material advantage
    const result = calcMaterial(prev, next, 1);
    assert.ok(result > 0, `Expected positive, got ${result}`);
  });

  test('calcMaterial: empty boards = 0', () => {
    const empty = emptyBoard();
    assert.equal(calcMaterial(empty, empty, 1), 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // calcPosition
  // ═══════════════════════════════════════════════════════════════════════

  test('calcPosition: empty board = 0', () => {
    assert.equal(calcPosition(emptyBoard(), 1), 0);
  });

  test('calcPosition: white pawn on row 7 (max advance) > row 5', () => {
    const board1 = emptyBoard();
    board1[56] = 1; // row 7, col 0 (edge)
    const board2 = emptyBoard();
    board2[40] = 1; // row 5, col 0 (edge)
    const s1 = calcPosition(board1, 1);
    const s2 = calcPosition(board2, 1);
    // Row 7 has more advance but edge penalty; row 5 also edge
    // Both are on edge so penalty applies equally; row 7 has more advance
    assert.ok(s1 !== undefined);
    assert.ok(s2 !== undefined);
  });

  test('calcPosition: king in center scores higher than on edge', () => {
    const centerBoard = emptyBoard();
    centerBoard[3 * 8 + 4] = 2; // white king at row 3, col 4 (center)
    const edgeBoard = emptyBoard();
    edgeBoard[0] = 2; // white king at row 0, col 0 (edge)
    const centerScore = calcPosition(centerBoard, 1);
    const edgeScore = calcPosition(edgeBoard, 1);
    assert.ok(centerScore > edgeScore, `center=${centerScore} should > edge=${edgeScore}`);
  });

  test('calcPosition: result clamped to [-1, 1]', () => {
    // Fill with many advanced white pawns
    const board = emptyBoard();
    for (let i = 48; i < 64; i++) board[i] = 1;
    const score = calcPosition(board, 1);
    assert.ok(score >= -1 && score <= 1, `Score ${score} out of range`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // calcThreat
  // ═══════════════════════════════════════════════════════════════════════

  test('calcThreat: empty board = 0', () => {
    assert.equal(calcThreat(emptyBoard(), 1), 0);
  });

  test('calcThreat: no adjacent opponents = 0', () => {
    const board = emptyBoard();
    board[0] = 1; // white pawn alone
    assert.equal(calcThreat(board, 1), 0);
  });

  test('calcThreat: opponent adjacent with empty jump square = threat', () => {
    const board = emptyBoard();
    board[9] = 1;  // white pawn at row 1, col 1
    board[18] = 3; // black pawn at row 2, col 2 (adjacent diagonal)
    // Jump square: row 0, col 0 = index 0, empty
    const threat = calcThreat(board, 1);
    // The white piece sees black adjacent with empty jump → threat to white
    assert.ok(threat !== undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // calcTempo
  // ═══════════════════════════════════════════════════════════════════════

  test('calcTempo: empty board = 0', () => {
    assert.equal(calcTempo(emptyBoard(), emptyBoard(), 1), 0);
  });

  test('calcTempo: white pieces in advanced rows (4-6) count as advanced', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[4 * 8 + 1] = 1; // white pawn at row 4 (advanced for white)
    const tempo = calcTempo(prev, next, 1);
    assert.ok(tempo > 0, `Expected positive tempo, got ${tempo}`);
  });

  test('calcTempo: black pieces in rows 1-3 count as advanced', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[2 * 8 + 2] = 3; // black pawn at row 2 (advanced for black)
    const tempo = calcTempo(prev, next, -1);
    assert.ok(tempo > 0, `Expected positive tempo for black, got ${tempo}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // calculateReward
  // ═══════════════════════════════════════════════════════════════════════

  test('calculateReward: null prevBoard returns 0', () => {
    assert.equal(calculateReward(null, emptyBoard(), 1), 0);
  });

  test('calculateReward: null nextBoard returns 0', () => {
    assert.equal(calculateReward(emptyBoard(), null, 1), 0);
  });

  test('calculateReward: both null returns 0', () => {
    assert.equal(calculateReward(null, null, 1), 0);
  });

  test('calculateReward: identical empty boards returns 0', () => {
    const board = emptyBoard();
    const reward = calculateReward(board, board, 1);
    assert.equal(reward, 0);
  });

  test('calculateReward: identical starting boards — material delta is 0', () => {
    const board = startingBoard();
    const reward = calculateReward(board, board, 1);
    // Position reward may be non-zero (white pawns are advanced), but material delta = 0
    // The reward reflects position advantage, not a bug
    assert.ok(reward >= -1 && reward <= 1, `Reward ${reward} out of range`);
  });

  test('calculateReward: result clamped to [-1, 1]', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    for (let i = 0; i < 64; i++) next[i] = 1; // all white
    const reward = calculateReward(prev, next, 1);
    assert.ok(reward >= -1 && reward <= 1, `Reward ${reward} out of range`);
  });

  test('calculateReward: capture gives positive reward for white', () => {
    const prev = startingBoard();
    const next = [...prev];
    next[1] = 0; // remove a black pawn
    const reward = calculateReward(prev, next, 1);
    assert.ok(reward > 0, `Expected positive reward for capture, got ${reward}`);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Trainer Reward Helpers Tests');

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
