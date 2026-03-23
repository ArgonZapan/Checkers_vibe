/**
 * hunter-alpha-trainer-helpers-boundary.test.js — Boundary tests for trainer.js helpers.
 *
 * Gaps identified:
 * - flattenBoard with wrong-size 2D arrays (rows != 8, cols != 8)
 * - isOwnPiece/isPawn/isKing with values outside 1-4 (0, -1, 5, NaN)
 * - PIECE_VALUE lookup with unknown values
 * - calcMaterial: both boards empty, only kings present
 * - calcPosition: all pieces on edges, all pieces in center
 * - calcAdvance: no pawns (only kings), all pawns promoted
 * - calcTempo: no pieces in advanced positions
 * - calculateReward: null prevBoard, prevBoard = nextBoard
 * - validateMove: captures with NaN coordinates
 * - isMoveLegal: move with string from/to
 */
import assert from 'node:assert/strict';

// ── Inline helpers (same logic as trainer.js) ────────────────────────────

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

function calcAdvance(prev, next, turn) {
  let totalAdvance = 0;
  let prevTotalAdvance = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    if (isPawn(next[i], turn)) {
      const adv = turn === 1 ? (7 - row) / 7 : row / 7;
      totalAdvance += adv;
    }
    if (isPawn(prev[i], turn)) {
      const adv = turn === 1 ? (7 - row) / 7 : row / 7;
      prevTotalAdvance += adv;
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

// ── validateMove inline ──────────────────────────────────────────────

function validateMove(move) {
  if (!move || typeof move !== 'object') return { valid: false, reason: 'null' };
  if (!('from' in move) || !('to' in move)) return { valid: false, reason: 'missing' };
  let { from, to } = move;
  if (Array.isArray(from)) {
    if (from.length !== 2 || !Number.isInteger(from[0]) || !Number.isInteger(from[1])) return { valid: false, reason: 'from array' };
    from = from[0] * 8 + from[1];
  }
  if (Array.isArray(to)) {
    if (to.length !== 2 || !Number.isInteger(to[0]) || !Number.isInteger(to[1])) return { valid: false, reason: 'to array' };
    to = to[0] * 8 + to[1];
  }
  if (typeof from !== 'number' || typeof to !== 'number') return { valid: false, reason: 'not numbers' };
  if (!Number.isInteger(from) || !Number.isInteger(to)) return { valid: false, reason: 'not int' };
  if (from < 0 || from > 63 || to < 0 || to > 63) return { valid: false, reason: 'out of range' };
  if (from === to) return { valid: false, reason: 'no-op' };
  if (move.captures != null) {
    if (!Array.isArray(move.captures)) return { valid: false, reason: 'captures not array' };
    for (let i = 0; i < move.captures.length; i++) {
      const c = move.captures[i];
      if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])
        || c[0] < 0 || c[0] > 7 || c[1] < 0 || c[1] > 7) return { valid: false, reason: `capture ${i}` };
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

// ── Empty board helper ───────────────────────────────────────────────

function emptyBoard() { return new Array(64).fill(0); }

export async function runHunterAlphaTrainerHelpersBoundaryTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── flattenBoard boundary ──────────────────────────────────────────

  test('flattenBoard: 2D 8x7 (wrong col count) returns 56-element flat (no validation)', () => {
    // Note: actual flattenBoard does NOT validate row lengths — it just calls board.flat()
    const board = Array.from({ length: 8 }, () => new Array(7).fill(0));
    const result = flattenBoard(board);
    assert.equal(result.length, 56); // 8 * 7 = 56, not null
  });

  test('flattenBoard: 2D 9x8 (wrong row count) returns null', () => {
    const board = Array.from({ length: 9 }, () => new Array(8).fill(0));
    assert.equal(flattenBoard(board), null);
  });

  test('flattenBoard: 2D with mixed row lengths returns non-64 flat (no validation)', () => {
    // Note: actual flattenBoard does NOT validate row lengths
    const board = [[0,0],[0,0,0],[0],[0,0,0,0,0,0,0,0],[0,0],[0,0,0,0],[0,0,0],[0]];
    const result = flattenBoard(board);
    assert.notEqual(result.length, 64); // mixed lengths produce wrong-size output
  });

  test('flattenBoard: empty string returns null', () => {
    assert.equal(flattenBoard(''), null);
  });

  test('flattenBoard: object returns null', () => {
    assert.equal(flattenBoard({ length: 64 }), null);
  });

  // ── isOwnPiece / isPawn / isKing with out-of-range values ──────────

  test('isOwnPiece: value 0 returns false for both turns', () => {
    assert.equal(isOwnPiece(0, 1), false);
    assert.equal(isOwnPiece(0, -1), false);
  });

  test('isOwnPiece: value 5 returns false for both turns', () => {
    assert.equal(isOwnPiece(5, 1), false);
    assert.equal(isOwnPiece(5, -1), false);
  });

  test('isOwnPiece: negative values return false', () => {
    assert.equal(isOwnPiece(-1, 1), false);
    assert.equal(isOwnPiece(-1, -1), false);
    assert.equal(isOwnPiece(-2, -1), false);
  });

  test('isOwnPiece: NaN returns false', () => {
    assert.equal(isOwnPiece(NaN, 1), false);
    assert.equal(isOwnPiece(NaN, -1), false);
  });

  test('isPawn: value 0 returns false for both turns', () => {
    assert.equal(isPawn(0, 1), false);
    assert.equal(isPawn(0, -1), false);
  });

  test('isPawn: king values return false', () => {
    assert.equal(isPawn(2, 1), false); // white king
    assert.equal(isPawn(4, -1), false); // black king
  });

  test('isKing: value 0 returns false for both turns', () => {
    assert.equal(isKing(0, 1), false);
    assert.equal(isKing(0, -1), false);
  });

  test('isKing: pawn values return false', () => {
    assert.equal(isKing(1, 1), false);
    assert.equal(isKing(3, -1), false);
  });

  // ── PIECE_VALUE with unknown keys ──────────────────────────────────

  test('PIECE_VALUE: unknown key 5 returns undefined', () => {
    assert.equal(PIECE_VALUE[5], undefined);
  });

  test('PIECE_VALUE: unknown key 0 returns undefined', () => {
    assert.equal(PIECE_VALUE[0], undefined);
  });

  // ── calcMaterial: edge cases ───────────────────────────────────────

  test('calcMaterial: both boards empty returns 0', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    assert.equal(calcMaterial(prev, next, 1), 0);
    assert.equal(calcMaterial(prev, next, -1), 0);
  });

  test('calcMaterial: only kings present', () => {
    const prev = emptyBoard();
    prev[0] = 2; // white king (value 3)
    prev[63] = 4; // black king (value 3)
    const next = emptyBoard();
    next[0] = 2; // white king still there
    // black king captured
    const result = calcMaterial(prev, next, 1); // white's perspective
    // white mat unchanged (3-3=0), opponent lost 3, so (0 - (-3)) / 6 = 0.5
    assert.equal(result, 0.5);
  });

  test('calcMaterial: capturing opponent pawn', () => {
    const prev = emptyBoard();
    prev[0] = 1; // white pawn
    prev[9] = 3; // black pawn
    const next = emptyBoard();
    next[18] = 1; // white pawn moved and captured black pawn
    const result = calcMaterial(prev, next, 1);
    // white unchanged (1→1), opponent lost 1 pawn, so (0 - (-1)) / 6 = ~0.167
    assert.ok(Math.abs(result - 1/6) < 0.001, `expected ~0.167, got ${result}`);
  });

  // ── calcPosition: boundary positions ───────────────────────────────

  test('calcPosition: pawn at promotion row (row 0 for white)', () => {
    const board = emptyBoard();
    board[0] = 1; // white pawn at row 0 (should be promoted, but testing calc)
    const result = calcPosition(board, 1);
    // advance = 0/7 = 0, col=0 so edge penalty applies
    assert.ok(result < 0, 'pawn at row 0 edge should have negative position score');
  });

  test('calcPosition: king at exact center (row 3-4, col 3-4)', () => {
    const board = emptyBoard();
    board[3 * 8 + 3] = 2; // white king at [3][3]
    board[4 * 8 + 4] = 2; // white king at [4][4]
    const result = calcPosition(board, 1);
    assert.ok(result > 0, 'kings in center should have positive position score');
  });

  test('calcPosition: king at corner [0][0]', () => {
    const board = emptyBoard();
    board[0] = 2; // white king at corner
    const result = calcPosition(board, 1);
    // KING_EDGE = -0.15
    assert.equal(result, -0.15);
  });

  test('calcPosition: score is clamped to [-1, 1]', () => {
    const board = emptyBoard();
    // Fill entire board with white pawns
    for (let i = 0; i < 64; i++) board[i] = 1;
    const result = calcPosition(board, 1);
    assert.ok(result >= -1 && result <= 1, `result ${result} not in [-1, 1]`);
  });

  // ── calcAdvance: no pawns ──────────────────────────────────────────

  test('calcAdvance: only kings, no pawns → 0 delta', () => {
    const prev = emptyBoard();
    prev[10] = 2; // white king
    const next = emptyBoard();
    next[18] = 2; // white king moved
    assert.equal(calcAdvance(prev, next, 1), 0);
  });

  test('calcAdvance: pawns captured → negative delta', () => {
    const prev = emptyBoard();
    prev[40] = 1; // white pawn at row 5
    const next = emptyBoard();
    // pawn captured (not present)
    const result = calcAdvance(prev, next, 1);
    assert.ok(result < 0, 'losing a pawn should give negative advance');
  });

  test('calcAdvance: result clamped to [-1, 1]', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    // All pawns in back row
    for (let c = 0; c < 8; c++) next[7 * 8 + c] = 1; // white pawns at row 7
    const result = calcAdvance(prev, next, 1);
    assert.ok(result >= -1 && result <= 1);
  });

  // ── calcTempo: edge cases ──────────────────────────────────────────

  test('calcTempo: no pieces in advanced positions returns 0', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[0] = 1; // white pawn at row 0 (not advanced for white)
    next[63] = 3; // black pawn at row 7 (not advanced for black)
    assert.equal(calcTempo(prev, next, 1), 0);
  });

  test('calcTempo: only my pieces in advanced positions', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[4 * 8 + 0] = 1; // white pawn at row 4 (advanced for white)
    next[5 * 8 + 0] = 1; // white pawn at row 5
    const result = calcTempo(prev, next, 1);
    // myAdv=2, oppAdv=0 → 2/2=1
    assert.equal(result, 1);
  });

  test('calcTempo: both sides in advanced positions', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[4 * 8 + 0] = 1; // white pawn at row 4
    next[2 * 8 + 0] = 3; // black pawn at row 2 (advanced for black)
    const result = calcTempo(prev, next, 1);
    // myAdv=1, oppAdv=1 → 0
    assert.equal(result, 0);
  });

  test('calcTempo: opponent has more advanced pieces', () => {
    const prev = emptyBoard();
    const next = emptyBoard();
    next[4 * 8 + 0] = 1; // 1 white in advanced
    next[2 * 8 + 0] = 3; // 3 black in advanced
    next[2 * 8 + 2] = 3;
    next[2 * 8 + 4] = 3;
    const result = calcTempo(prev, next, 1);
    // myAdv=1, oppAdv=3 → (1-3)/4 = -0.5
    assert.equal(result, -0.5);
  });

  // ── validateMove: edge cases ───────────────────────────────────────

  test('validateMove: captures with out-of-range coordinate', () => {
    const move = { from: [3, 3], to: [5, 5], captures: [[4, 4], [9, 9]] };
    assert.equal(validateMove(move).valid, false);
  });

  test('validateMove: captures with NaN coordinate', () => {
    const move = { from: [3, 3], to: [5, 5], captures: [[NaN, 4]] };
    assert.equal(validateMove(move).valid, false);
  });

  test('validateMove: from as float [3.5, 2]', () => {
    const move = { from: [3.5, 2], to: [4, 3] };
    assert.equal(validateMove(move).valid, false);
  });

  test('validateMove: valid simple move', () => {
    const move = { from: [2, 1], to: [3, 2] };
    const result = validateMove(move);
    assert.equal(result.valid, true);
  });

  test('validateMove: valid move with captures', () => {
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    assert.equal(validateMove(move).valid, true);
  });

  test('validateMove: null captures array is ok', () => {
    const move = { from: [2, 1], to: [3, 2], captures: null };
    assert.equal(validateMove(move).valid, true);
  });

  // ── isMoveLegal: edge cases ────────────────────────────────────────

  test('isMoveLegal: empty legalMoves returns false', () => {
    const move = { from: [2, 1], to: [3, 2] };
    assert.equal(isMoveLegal(move, []), false);
  });

  test('isMoveLegal: null move returns false', () => {
    assert.equal(isMoveLegal(null, [{ from: [0, 0], to: [1, 1] }]), false);
  });

  test('isMoveLegal: move with string from/to matches if legal move also uses strings', () => {
    const move = { from: 'a1', to: 'b2' };
    const legalMoves = [{ from: 'a1', to: 'b2' }];
    assert.equal(isMoveLegal(move, legalMoves), true);
  });

  test('isMoveLegal: captures must match exactly', () => {
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    const legalMoves = [{ from: [2, 1], to: [4, 3], captures: [[3, 2]] }];
    assert.equal(isMoveLegal(move, legalMoves), true);
  });

  test('isMoveLegal: captures length mismatch returns false', () => {
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 2], [5, 4]] };
    const legalMoves = [{ from: [2, 1], to: [4, 3], captures: [[3, 2]] }];
    assert.equal(isMoveLegal(move, legalMoves), false);
  });

  test('isMoveLegal: legal move has captures but move does not', () => {
    const move = { from: [2, 1], to: [4, 3] };
    const legalMoves = [{ from: [2, 1], to: [4, 3], captures: [[3, 2]] }];
    assert.equal(isMoveLegal(move, legalMoves), true); // move without captures still matches
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Trainer Helpers Boundary');

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
