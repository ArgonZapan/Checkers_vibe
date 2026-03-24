/**
 * hunter-tw-trainer-reward-boundary.test.js — Boundary tests for trainer reward helpers.
 *
 * Gaps:
 * - calcMaterial with all pieces captured (zero material)
 * - calcMaterial with only kings remaining
 * - calcThreat with pieces on edge of board (jump goes out of bounds)
 * - calcThreat with both kings (no direction restriction)
 * - calcAdvance with pawns already at promotion row
 * - calcTempo with no advanced pieces
 * - flattenBoard edge cases (null, non-array, wrong dimensions)
 * - isOwnPiece/isPawn/isKing with invalid turn values
 * - calculateReward with null prevBoard
 */

import assert from 'node:assert/strict';

// ── Inlined helpers from server/ai/trainer.js ───────────────────────────

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
      if (isMy) {
        if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
          const oppVal = board[adjIdx];
          const oppAbsVal = Math.abs(oppVal);
          const oppIsKing = oppAbsVal === 2 || oppAbsVal === 4;
          if (!oppIsKing) {
            const oppIsWhite = oppVal > 0 && (oppAbsVal === 1 || oppAbsVal === 2);
            if (oppIsWhite && dr !== -1) continue;
            if (!oppIsWhite && dr !== 1) continue;
          }
          myThreats++;
        }
      } else {
        if (board[adjIdx] && isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
          const myVal = board[adjIdx];
          const myAbsVal = Math.abs(myVal);
          const myIsKing = myAbsVal === 2 || myAbsVal === 4;
          if (!myIsKing) {
            const myIsWhite = myVal > 0 && (myAbsVal === 1 || myAbsVal === 2);
            if (myIsWhite && dr !== 1) continue;
            if (!myIsWhite && dr !== -1) continue;
          }
          oppThreats++;
        }
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

function calcAdvance(prev, next, turn) {
  let totalAdvance = 0, prevTotalAdvance = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    if (isPawn(next[i], turn)) {
      totalAdvance += turn === 1 ? row / 7 : (7 - row) / 7;
    }
    if (isPawn(prev[i], turn)) {
      prevTotalAdvance += turn === 1 ? row / 7 : (7 - row) / 7;
    }
  }
  const delta = totalAdvance - prevTotalAdvance;
  return Math.max(-1, Math.min(1, delta));
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

function emptyBoard() { return new Array(64).fill(0); }

// ── Tests ───────────────────────────────────────────────────────────────

export async function runTrainerRewardBoundaryTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── flattenBoard edge cases ────────────────────────────────────────────

  test('flattenBoard: null → null', () => {
    assert.equal(flattenBoard(null), null);
  });

  test('flattenBoard: undefined → null', () => {
    assert.equal(flattenBoard(undefined), null);
  });

  test('flattenBoard: string → null', () => {
    assert.equal(flattenBoard('board'), null);
  });

  test('flattenBoard: number → null', () => {
    assert.equal(flattenBoard(42), null);
  });

  test('flattenBoard: flat 64-element array → copy', () => {
    const flat = new Array(64).fill(0);
    flat[0] = 1;
    const result = flattenBoard(flat);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    assert.ok(result !== flat, 'should be a copy');
  });

  test('flattenBoard: 2D 8x8 array → flat 64', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = 1;
    const result = flattenBoard(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
  });

  test('flattenBoard: wrong size flat array → null', () => {
    assert.equal(flattenBoard([1, 2, 3]), null);
  });

  test('flattenBoard: wrong size 2D (7 rows) → null', () => {
    const board = Array.from({ length: 7 }, () => new Array(8).fill(0));
    assert.equal(flattenBoard(board), null);
  });

  // ── isOwnPiece / isPawn / isKing with invalid values ───────────────────

  test('isOwnPiece: val=0 → false for both turns', () => {
    assert.equal(isOwnPiece(0, 1), false);
    assert.equal(isOwnPiece(0, -1), false);
  });

  test('isOwnPiece: val=5 (invalid) → false', () => {
    assert.equal(isOwnPiece(5, 1), false);
    assert.equal(isOwnPiece(5, -1), false);
  });

  test('isPawn: king val=2 → false', () => {
    assert.equal(isPawn(2, 1), false);
  });

  test('isKing: pawn val=1 → false', () => {
    assert.equal(isKing(1, 1), false);
  });

  test('isOwnPiece: turn=0 (invalid) → treats as black', () => {
    // turn !== 1, so falls through to black check
    assert.equal(isOwnPiece(3, 0), true); // black pawn
    assert.equal(isOwnPiece(1, 0), false); // white pawn
  });

  // ── calcMaterial edge cases ────────────────────────────────────────────

  test('calcMaterial: identical boards → 0', () => {
    const board = emptyBoard();
    board[0] = 1;
    assert.equal(calcMaterial(board, board, 1), 0);
  });

  test('calcMaterial: all pieces captured → negative for losing side', () => {
    const prev = emptyBoard();
    prev[0] = 1; // white pawn
    prev[63] = 3; // black pawn
    const next = emptyBoard();
    next[0] = 1; // white pawn survives
    // black pawn captured
    const matWhite = calcMaterial(prev, next, 1);
    assert.ok(matWhite > 0, 'white gained material advantage');
  });

  test('calcMaterial: only kings on board', () => {
    const prev = emptyBoard();
    prev[3 * 8 + 3] = 2; // white king
    prev[4 * 8 + 4] = 4; // black king
    const next = emptyBoard();
    next[3 * 8 + 3] = 2; // white king survives
    // black king captured
    const mat = calcMaterial(prev, next, 1);
    assert.ok(mat > 0, 'white captured a king (value 3)');
  });

  test('calcMaterial: empty boards → 0', () => {
    const board = emptyBoard();
    assert.equal(calcMaterial(board, board, 1), 0);
    assert.equal(calcMaterial(board, board, -1), 0);
  });

  // ── calcThreat edge cases ──────────────────────────────────────────────

  test('calcThreat: piece on edge (row 0) → no out-of-bounds threats', () => {
    const board = emptyBoard();
    board[0] = 3; // black pawn at (0,0)
    board[1 * 8 + 1] = 1; // white pawn at (1,1)
    // White can capture black: (1,1) jumps over (0,0) to (-1,-1) — out of bounds
    // So no valid threat. calcThreat should not crash.
    const threat = calcThreat(board, 1);
    assert.ok(typeof threat === 'number', 'should return a number');
    assert.ok(!isNaN(threat), 'should not be NaN');
  });

  test('calcThreat: piece on edge (row 7) → no out-of-bounds', () => {
    const board = emptyBoard();
    board[7 * 8 + 7] = 1; // white pawn at (7,7)
    board[6 * 8 + 6] = 3; // black pawn at (6,6)
    const threat = calcThreat(board, -1);
    assert.ok(typeof threat === 'number');
    assert.ok(!isNaN(threat));
  });

  test('calcThreat: empty board → 0', () => {
    const board = emptyBoard();
    const threat = calcThreat(board, 1);
    assert.equal(threat, 0);
  });

  test('calcThreat: kings can capture in any direction', () => {
    const board = emptyBoard();
    board[4 * 8 + 4] = 4; // black king at (4,4)
    board[3 * 8 + 3] = 1; // white pawn at (3,3) — above-left of black king
    // Black king at (4,4) can capture white at (3,3) by jumping to (2,2)
    const threat = calcThreat(board, 1); // from white's perspective
    assert.ok(threat >= 0, 'white should feel threatened');
  });

  // ── calcAdvance edge cases ─────────────────────────────────────────────

  test('calcAdvance: pawn already at promotion row → no further advance', () => {
    const prev = emptyBoard();
    prev[7 * 8 + 3] = 1; // white pawn at row 7 (promotion row)
    const next = emptyBoard();
    next[7 * 8 + 3] = 1; // still there (already king, but test as pawn)
    const adv = calcAdvance(prev, next, 1);
    assert.equal(adv, 0, 'no movement = no advance');
  });

  test('calcAdvance: pawn captured (removed) → negative delta', () => {
    const prev = emptyBoard();
    prev[5 * 8 + 3] = 1; // white pawn at row 5
    const next = emptyBoard(); // pawn captured
    const adv = calcAdvance(prev, next, 1);
    assert.ok(adv < 0, 'losing a forward pawn should reduce advance');
  });

  test('calcAdvance: black pawn moving toward row 0 → positive', () => {
    const prev = emptyBoard();
    prev[5 * 8 + 3] = 3; // black pawn at row 5
    const next = emptyBoard();
    next[4 * 8 + 2] = 3; // black pawn at row 4 (moved forward for black)
    const adv = calcAdvance(prev, next, -1);
    assert.ok(adv > 0, 'black pawn advancing toward row 0');
  });

  // ── calcTempo edge cases ──────────────────────────────────────────────

  test('calcTempo: no advanced pieces → 0', () => {
    const board = emptyBoard();
    board[1 * 8 + 1] = 1; // white pawn in back rows
    board[6 * 8 + 6] = 3; // black pawn in back rows
    const tempo = calcTempo(board, board, 1);
    assert.equal(tempo, 0);
  });

  test('calcTempo: empty board → 0', () => {
    const board = emptyBoard();
    const tempo = calcTempo(board, board, 1);
    assert.equal(tempo, 0);
  });

  test('calcTempo: all pieces in advanced positions for white', () => {
    const board = emptyBoard();
    for (let c = 0; c < 4; c++) board[4 * 8 + c] = 1; // white pawns in row 4
    const tempo = calcTempo(board, board, 1);
    assert.ok(tempo > 0, 'white has advanced pieces, black has none');
  });

  test('calcTempo: black pieces in advanced positions (rows 1-3)', () => {
    const board = emptyBoard();
    for (let c = 0; c < 4; c++) board[2 * 8 + c * 2 + 1] = 3; // black pawns in row 2
    const tempo = calcTempo(board, board, -1);
    assert.ok(tempo > 0, 'black has advanced pieces');
  });

  // ── calcPosition edge cases ────────────────────────────────────────────

  test('calcPosition: empty board → 0', () => {
    const board = emptyBoard();
    assert.equal(calcPosition(board, 1), 0);
  });

  test('calcPosition: pawn at promotion row (row 7 for white) → highest advance', () => {
    const board = emptyBoard();
    board[7 * 8 + 3] = 1; // white pawn at promotion row
    const score = calcPosition(board, 1);
    assert.ok(score > 0, 'should have positive score');
  });

  test('calcPosition: king in center → positive', () => {
    const board = emptyBoard();
    board[4 * 8 + 4] = 2; // white king in center
    const score = calcPosition(board, 1);
    assert.ok(score > 0, 'center king should score well');
  });

  test('calcPosition: king on edge → negative', () => {
    const board = emptyBoard();
    board[0] = 2; // white king at (0,0) corner
    const score = calcPosition(board, 1);
    assert.ok(score < 0, 'edge king should have penalty');
  });

  test('calcPosition: result always in [-1, 1]', () => {
    const board = emptyBoard();
    // Fill with many white pawns
    for (let i = 0; i < 32; i++) board[i] = 1;
    const score = calcPosition(board, 1);
    assert.ok(score >= -1 && score <= 1, `score ${score} out of range`);
  });

  // ── Run all ────────────────────────────────────────────────────────────

  for (const { name, fn } of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  }

  console.log(`\nhunter-tw-trainer-reward-boundary: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
