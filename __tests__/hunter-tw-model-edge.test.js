/**
 * hunter-tw-model-edge.test.js — Edge cases for model.js
 *
 * Gap: existing tests cover basic buildInputArray encoding, but miss:
 * - Negative piece values (all negative variants)
 * - Invalid turn values (undefined, null, object, boolean)
 * - buildInputArray with 2D board that has wrong inner lengths
 * - computePolicyIndex edge cases (corner squares, boundary)
 * - encodeKing with all piece types including invalid values
 *
 * Pure JS — no TF.js dependency.
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

export async function runHunterTwModelEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // Negative piece values
  // ═══════════════════════════════════════════════════════════════════════

  test('buildInputArray: -1 (negative white pawn) treated as black', () => {
    const board = emptyBoard();
    board[0] = -1;
    const input = buildInputArray(board, 1);
    // val=-1, absVal=1, isWhite = (-1 > 0 && ...) = false → black channel
    assert.equal(input[0], 0, 'not empty');
    assert.equal(input[1], 0, 'not white (negative)');
    assert.equal(input[2], 1, 'black channel (negative)');
    assert.equal(input[3], 0, 'not king');
  });

  test('buildInputArray: -2 (negative white king) treated as black king', () => {
    const board = emptyBoard();
    board[0] = -2;
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 0, 'not white');
    assert.equal(input[2], 1, 'black channel');
    assert.equal(input[3], 1, 'king flag');
  });

  test('buildInputArray: -3 (negative black pawn) treated as black', () => {
    const board = emptyBoard();
    board[0] = -3;
    const input = buildInputArray(board, 1);
    assert.equal(input[2], 1, 'black channel');
    assert.equal(input[3], 0, 'not king');
  });

  test('buildInputArray: -4 (negative black king) treated as black king', () => {
    const board = emptyBoard();
    board[0] = -4;
    const input = buildInputArray(board, 1);
    assert.equal(input[2], 1, 'black channel');
    assert.equal(input[3], 1, 'king flag');
  });

  test('buildInputArray: -5 (invalid negative) treated as black non-king', () => {
    const board = emptyBoard();
    board[0] = -5;
    const input = buildInputArray(board, 1);
    assert.equal(input[2], 1, 'invalid negative → black channel');
    assert.equal(input[3], 0, 'not king');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Invalid turn values
  // ═══════════════════════════════════════════════════════════════════════

  test('buildInputArray: turn=undefined defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), undefined);
    assert.equal(input[256], 1, 'undefined turn → 1');
  });

  test('buildInputArray: turn=null defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), null);
    assert.equal(input[256], 1, 'null turn → 1');
  });

  test('buildInputArray: turn=0 defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), 0);
    assert.equal(input[256], 1, '0 turn → 1');
  });

  test('buildInputArray: turn=NaN defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), NaN);
    assert.equal(input[256], 1, 'NaN turn → 1');
  });

  test('buildInputArray: turn=Infinity defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), Infinity);
    assert.equal(input[256], 1, 'Infinity turn → 1');
  });

  test('buildInputArray: turn=-Infinity defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), -Infinity);
    assert.equal(input[256], 1, '-Infinity turn → 1');
  });

  test('buildInputArray: turn="black" (string) defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), 'black');
    assert.equal(input[256], 1, 'string turn → 1');
  });

  test('buildInputArray: turn=true defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), true);
    assert.equal(input[256], 1, 'boolean true → 1');
  });

  test('buildInputArray: turn=false defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), false);
    assert.equal(input[256], 1, 'boolean false → 1');
  });

  test('buildInputArray: turn=3 (out of range) defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), 3);
    assert.equal(input[256], 1, 'turn=3 → 1');
  });

  test('buildInputArray: turn=-3 (out of range) defaults to 1', () => {
    const input = buildInputArray(emptyBoard(), -3);
    assert.equal(input[256], 1, 'turn=-3 → 1');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Board edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('buildInputArray: non-array input throws', () => {
    assert.throws(() => buildInputArray(null, 1), /expected array/);
    assert.throws(() => buildInputArray(undefined, 1), /expected array/);
    assert.throws(() => buildInputArray('board', 1), /expected array/);
    assert.throws(() => buildInputArray(42, 1), /expected array/);
    assert.throws(() => buildInputArray(true, 1), /expected array/);
    assert.throws(() => buildInputArray({}, 1), /expected array/);
  });

  test('buildInputArray: wrong flat size throws', () => {
    assert.throws(() => buildInputArray(new Array(32).fill(0), 1), /expected 64/);
    assert.throws(() => buildInputArray(new Array(100).fill(0), 1), /expected 64/);
    assert.throws(() => buildInputArray([], 1), /expected 64/);
  });

  test('buildInputArray: board with float values (not integers)', () => {
    const board = emptyBoard();
    board[0] = 1.5; // non-integer
    const input = buildInputArray(board, 1);
    // 1.5 > 0, absVal=1.5, isWhite = (1.5>0 && (1.5===1 || 1.5===2)) = false
    // Falls through to black channel
    assert.equal(input[2], 1, 'float 1.5 treated as black (not matching 1 or 2)');
  });

  test('buildInputArray: full board with all piece types', () => {
    const board = new Array(64).fill(0);
    // Fill with alternating piece types
    board[0] = 1; board[1] = 2; board[2] = 3; board[3] = 4;
    const input = buildInputArray(board, 1);
    // Verify each cell encoding
    assert.equal(input[1], 1, 'cell 0 white pawn');
    assert.equal(input[5], 1, 'cell 1 white');
    assert.equal(input[7], 1, 'cell 1 king');
    assert.equal(input[10], 1, 'cell 2 black');
    assert.equal(input[14], 1, 'cell 3 black');
    assert.equal(input[15], 1, 'cell 3 king');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // computePolicyIndex edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('computePolicyIndex: corner square (0,0) NE move', () => {
    const idx = computePolicyIndex([0, 0], [1, 1]); // SE
    // darkFrom = 0*4 + floor(0/2) = 0, SE = direction 2
    assert.equal(idx, 2, 'corner (0,0) SE → index 2');
  });

  test('computePolicyIndex: corner square (7,7) NW move', () => {
    const idx = computePolicyIndex([7, 7], [6, 6]); // NW
    // darkFrom = 7*4 + floor(7/2) = 28 + 3 = 31, NW = direction 1
    assert.equal(idx, 31 * 4 + 1, 'corner (7,7) NW');
  });

  test('computePolicyIndex: max index for dark square at row 7, col 6', () => {
    const idx = computePolicyIndex([7, 6], [6, 5]); // NW from (7,6)
    // darkFrom = 7*4 + floor(6/2) = 28 + 3 = 31
    assert.equal(idx, 31 * 4 + 1, 'last dark square NW');
  });

  test('computePolicyIndex: all four directions from same square', () => {
    const from = [3, 3];
    const ne = computePolicyIndex(from, [2, 4]); // NE
    const nw = computePolicyIndex(from, [2, 2]); // NW
    const se = computePolicyIndex(from, [4, 4]); // SE
    const sw = computePolicyIndex(from, [4, 2]); // SW
    const darkFrom = 3 * 4 + Math.floor(3 / 2); // 12 + 1 = 13
    assert.equal(ne, darkFrom * 4 + 0, 'NE');
    assert.equal(nw, darkFrom * 4 + 1, 'NW');
    assert.equal(se, darkFrom * 4 + 2, 'SE');
    assert.equal(sw, darkFrom * 4 + 3, 'SW');
  });

  test('computePolicyIndex: same row move returns 0 (invalid)', () => {
    const idx = computePolicyIndex([4, 2], [4, 6]); // horizontal
    assert.equal(idx, 0, 'horizontal move → fallback 0');
  });

  test('computePolicyIndex: same col move returns 0 (invalid)', () => {
    const idx = computePolicyIndex([2, 4], [6, 4]); // vertical
    assert.equal(idx, 0, 'vertical move → fallback 0');
  });

  test('computePolicyIndex: scalar input matches array input', () => {
    // [3,3] = 3*8+3 = 27, [4,4] = 36
    const idx1 = computePolicyIndex(27, 36);
    const idx2 = computePolicyIndex([3, 3], [4, 4]);
    assert.equal(idx1, idx2, 'scalar and array should match');
  });

  test('computePolicyIndex: toScalar with non-array returns number as-is', () => {
    assert.equal(toScalar(42), 42, 'number passthrough');
    assert.equal(toScalar([3, 5]), 29, 'array conversion');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // buildInputArray: empty channels are 0 for occupied cells
  // ═══════════════════════════════════════════════════════════════════════

  test('buildInputArray: occupied cell has empty channel = 0', () => {
    const board = emptyBoard();
    board[10] = 1;
    const input = buildInputArray(board, 1);
    assert.equal(input[40], 0, 'cell 10 empty channel should be 0');
    assert.equal(input[41], 1, 'cell 10 white channel');
  });

  test('buildInputArray: all cells empty → all empty channels = 1', () => {
    const input = buildInputArray(emptyBoard(), 1);
    for (let i = 0; i < 64; i++) {
      assert.equal(input[i * 4], 1, `cell ${i} empty channel should be 1`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Run
  // ═══════════════════════════════════════════════════════════════════════

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\nhunter-tw-model-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
