/**
 * hunter-alpha-model-tensor.test.js — Tests for boardToTensor / buildInputArray edge cases
 *
 * Gap: buildInputArray had minimal dedicated tests. These cover boundary values,
 * invalid inputs, encoding correctness for all piece types.
 *
 * Pure JS — no TF.js dependency (we test buildInputArray, not boardToTensor which needs tf).
 */

import assert from 'node:assert/strict';

// ── Inline buildInputArray from server/ai/model.js ──────────────────────

function buildInputArray(boardArray, turn) {
  if (!Array.isArray(boardArray)) {
    throw new Error(`buildInputArray: expected array, got ${typeof boardArray}`);
  }
  let board = boardArray;
  if (board.length === 64 && !Array.isArray(board[0])) {
    const wrapped = [];
    for (let r = 0; r < 8; r++) {
      wrapped.push(board.slice(r * 8, r * 8 + 8));
    }
    board = wrapped;
  }
  const flat = board.flat();
  if (flat.length !== 64) {
    throw new Error(`buildInputArray: expected 64 cells, got ${flat.length}`);
  }

  const input = new Float32Array(257);
  for (let i = 0; i < 64; i++) {
    const val = flat[i];
    const base = i * 4;
    if (val === 0) {
      input[base] = 1;
    } else {
      const absVal = Math.abs(val);
      const isWhite = val > 0 && (absVal === 1 || absVal === 2);
      const isKing = absVal === 2 || absVal === 4;
      if (isWhite) {
        input[base + 1] = 1;
      } else {
        input[base + 2] = 1;
      }
      if (isKing) {
        input[base + 3] = 1;
      }
    }
  }
  input[256] = (turn === 1 || turn === -1) ? turn : 1;
  return input;
}

// ── computePolicyIndex from server/ai/model.js ─────────────────────────

function toScalar(idx) {
  if (Array.isArray(idx)) return idx[0] * 8 + idx[1];
  return idx;
}

const DIRECTION_MAP = { '-1,1': 0, '-1,-1': 1, '1,1': 2, '1,-1': 3 };

function computePolicyIndex(fromSquare, toSquare) {
  const from = toScalar(fromSquare);
  const to = toScalar(toSquare);
  const fromRow = Math.floor(from / 8);
  const fromCol = from % 8;
  const darkFrom = fromRow * 4 + Math.floor(fromCol / 2);
  const toRow = Math.floor(to / 8);
  const toCol = to % 8;
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  const dirKey = `${Math.sign(dr)},${Math.sign(dc)}`;
  const dirIdx = DIRECTION_MAP[dirKey];
  if (dirIdx === undefined) return 0;
  return darkFrom * 4 + dirIdx;
}

function emptyBoard() { return new Array(64).fill(0); }

export async function runHunterAlphaModelTensorTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: buildInputArray encoding
  // ═══════════════════════════════════════════════════════════════════════

  test('buildInputArray: empty board — all cells encoded as empty', () => {
    const input = buildInputArray(emptyBoard(), 1);
    // First cell (index 0): empty channel should be 1
    assert.equal(input[0], 1, 'cell 0 empty channel');
    // White/black/king channels should be 0
    assert.equal(input[1], 0, 'cell 0 white channel');
    assert.equal(input[2], 0, 'cell 0 black channel');
    assert.equal(input[3], 0, 'cell 0 king channel');
    // Turn channel
    assert.equal(input[256], 1, 'turn=1');
  });

  test('buildInputArray: white pawn encoding', () => {
    const board = emptyBoard();
    board[0] = 1; // white pawn at index 0
    const input = buildInputArray(board, 1);
    assert.equal(input[0], 0, 'not empty');
    assert.equal(input[1], 1, 'white channel');
    assert.equal(input[2], 0, 'not black');
    assert.equal(input[3], 0, 'not king');
  });

  test('buildInputArray: white king encoding', () => {
    const board = emptyBoard();
    board[0] = 2; // white king
    const input = buildInputArray(board, 1);
    assert.equal(input[0], 0);
    assert.equal(input[1], 1, 'white');
    assert.equal(input[3], 1, 'king flag');
  });

  test('buildInputArray: black pawn encoding', () => {
    const board = emptyBoard();
    board[0] = 3; // black pawn
    const input = buildInputArray(board, 1);
    assert.equal(input[0], 0);
    assert.equal(input[1], 0, 'not white');
    assert.equal(input[2], 1, 'black channel');
    assert.equal(input[3], 0, 'not king');
  });

  test('buildInputArray: black king encoding', () => {
    const board = emptyBoard();
    board[0] = 4; // black king
    const input = buildInputArray(board, 1);
    assert.equal(input[0], 0);
    assert.equal(input[2], 1, 'black');
    assert.equal(input[3], 1, 'king');
  });

  test('buildInputArray: negative values treated as black', () => {
    // Some engines use negative for black pieces
    const board = emptyBoard();
    board[0] = -3; // negative black pawn
    const input = buildInputArray(board, 1);
    // val < 0 → isWhite = false → black channel
    assert.equal(input[2], 1, 'negative value → black channel');
  });

  test('buildInputArray: turn = -1', () => {
    const input = buildInputArray(emptyBoard(), -1);
    assert.equal(input[256], -1, 'turn=-1');
  });

  test('buildInputArray: invalid turn defaults to 1', () => {
    const input1 = buildInputArray(emptyBoard(), 0);
    assert.equal(input1[256], 1, 'turn=0 → default 1');
    const input2 = buildInputArray(emptyBoard(), NaN);
    assert.equal(input2[256], 1, 'turn=NaN → default 1');
    const input3 = buildInputArray(emptyBoard(), 2);
    assert.equal(input3[256], 1, 'turn=2 → default 1');
    const input4 = buildInputArray(emptyBoard(), 'white');
    assert.equal(input4[256], 1, 'turn=string → default 1');
  });

  test('buildInputArray: 2D board input', () => {
    const board2D = Array.from({ length: 8 }, () => Array(8).fill(0));
    board2D[0][0] = 1;
    const input = buildInputArray(board2D, 1);
    assert.equal(input[1], 1, '2D board should work');
  });

  test('buildInputArray: flat board input', () => {
    const board = emptyBoard();
    board[0] = 2;
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 1, 'flat board should work');
    assert.equal(input[3], 1, 'king flag');
  });

  test('buildInputArray: output size is 257', () => {
    const input = buildInputArray(emptyBoard(), 1);
    assert.equal(input.length, 257, 'output should have 257 elements');
  });

  test('buildInputArray: invalid input throws', () => {
    assert.throws(() => buildInputArray(null, 1), /expected array/);
    assert.throws(() => buildInputArray(undefined, 1), /expected array/);
    assert.throws(() => buildInputArray('board', 1), /expected array/);
    assert.throws(() => buildInputArray(42, 1), /expected array/);
  });

  test('buildInputArray: wrong board size throws', () => {
    assert.throws(() => buildInputArray(new Array(32).fill(0), 1), /expected 64/);
    assert.throws(() => buildInputArray(new Array(100).fill(0), 1), /expected 64/);
  });

  test('buildInputArray: last cell encoding', () => {
    const board = emptyBoard();
    board[63] = 4; // black king at last position
    const input = buildInputArray(board, 1);
    // Cell 63 channels start at 63*4 = 252
    assert.equal(input[252], 0, 'not empty');
    assert.equal(input[253], 0, 'not white');
    assert.equal(input[254], 1, 'black');
    assert.equal(input[255], 1, 'king');
  });

  test('buildInputArray: all 4 piece types at different positions', () => {
    const board = emptyBoard();
    board[0] = 1;  // white pawn
    board[1] = 2;  // white king
    board[2] = 3;  // black pawn
    board[3] = 4;  // black king
    const input = buildInputArray(board, 1);
    // Cell 0: white pawn
    assert.equal(input[1], 1); assert.equal(input[3], 0);
    // Cell 1: white king
    assert.equal(input[5], 1); assert.equal(input[7], 1);
    // Cell 2: black pawn
    assert.equal(input[10], 1); assert.equal(input[11], 0);
    // Cell 3: black king
    assert.equal(input[14], 1); assert.equal(input[15], 1);
  });

  test('buildInputArray: unknown piece value (>4) encoded as black non-king', () => {
    const board = emptyBoard();
    board[0] = 5; // invalid piece code
    const input = buildInputArray(board, 1);
    // val=5 → absVal=5, isWhite = (5>0 && (5===1 || 5===2)) = false
    // isKing = (5===2 || 5===4) = false
    // Falls through to: input[base+2] = 1 (black channel)
    // This is a data quality issue — invalid codes silently become black pawns.
    assert.equal(input[0], 0, 'empty channel not set');
    assert.equal(input[1], 0, 'not white');
    assert.equal(input[2], 1, 'BUG: invalid code 5 treated as black pawn');
    assert.equal(input[3], 0, 'not king');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: computePolicyIndex
  // ═══════════════════════════════════════════════════════════════════════

  test('computePolicyIndex: NE direction (dr=-1, dc=1)', () => {
    const idx = computePolicyIndex([5, 5], [4, 6]); // (5,5) → (4,6) = NE
    const darkFrom = 5 * 4 + Math.floor(5 / 2); // 20 + 2 = 22
    assert.equal(idx, darkFrom * 4 + 0, 'NE = direction 0');
  });

  test('computePolicyIndex: NW direction (dr=-1, dc=-1)', () => {
    const idx = computePolicyIndex([5, 5], [4, 4]);
    const darkFrom = 5 * 4 + 2;
    assert.equal(idx, darkFrom * 4 + 1, 'NW = direction 1');
  });

  test('computePolicyIndex: SE direction (dr=1, dc=1)', () => {
    const idx = computePolicyIndex([2, 2], [3, 3]);
    const darkFrom = 2 * 4 + 1;
    assert.equal(idx, darkFrom * 4 + 2, 'SE = direction 2');
  });

  test('computePolicyIndex: SW direction (dr=1, dc=-1)', () => {
    const idx = computePolicyIndex([2, 2], [3, 1]);
    const darkFrom = 2 * 4 + 1;
    assert.equal(idx, darkFrom * 4 + 3, 'SW = direction 3');
  });

  test('computePolicyIndex: scalar input', () => {
    const idx1 = computePolicyIndex(45, 36); // (5,5) → (4,4)
    const idx2 = computePolicyIndex([5, 5], [4, 4]);
    assert.equal(idx1, idx2, 'scalar and array should give same result');
  });

  test('computePolicyIndex: invalid direction returns 0', () => {
    // Same row (dr=0) → invalid direction
    const idx = computePolicyIndex([4, 4], [4, 6]);
    assert.equal(idx, 0, 'horizontal move → fallback 0');
  });

  test('computePolicyIndex: range 0-127 for valid diagonal moves', () => {
    // Test a few valid moves
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if ((r + c) % 2 === 0) continue; // only dark squares
        const idx = computePolicyIndex([r, c], [r + 1, c + 1]);
        assert.ok(idx >= 0 && idx < 128, `policy index ${idx} out of range for (${r},${c})→(${r+1},${c+1})`);
      }
    }
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

  console.log(`\n  model-tensor: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
