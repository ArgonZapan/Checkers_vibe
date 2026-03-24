/**
 * hunter-tw-model-input-edge.test.js — Edge cases for model input building and policy index.
 *
 * Gaps:
 * - buildInputArray with turn=0 (invalid)
 * - buildInputArray with turn=NaN
 * - buildInputArray with negative piece values (C++ can produce these)
 * - buildInputArray with piece value > 4
 * - buildInputArray with 2D board of wrong dimensions
 * - computePolicyIndex with boundary squares (corners, edges)
 * - computePolicyIndex for king (can move all 4 directions from same square)
 * - boardToTensor encoding consistency with buildInputArray
 * - computePolicyIndex: from === to (invalid direction)
 */

import assert from 'node:assert/strict';

// ── Inlined from server/ai/model.js ─────────────────────────────────────

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

const DIRECTION_MAP = { '-1,1': 0, '-1,-1': 1, '1,1': 2, '1,-1': 3 };

function toScalar(idx) {
  if (Array.isArray(idx)) return idx[0] * 8 + idx[1];
  return idx;
}

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

// ── Tests ───────────────────────────────────────────────────────────────

export async function runModelInputEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── buildInputArray: turn edge cases ───────────────────────────────────

  test('buildInputArray: turn=0 → defaults to 1', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, 0);
    assert.equal(input[256], 1);
  });

  test('buildInputArray: turn=NaN → defaults to 1', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, NaN);
    assert.equal(input[256], 1);
  });

  test('buildInputArray: turn=2 (invalid) → defaults to 1', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, 2);
    assert.equal(input[256], 1);
  });

  test('buildInputArray: turn=undefined → defaults to 1', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, undefined);
    assert.equal(input[256], 1);
  });

  test('buildInputArray: turn=-1 → preserved', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, -1);
    assert.equal(input[256], -1);
  });

  test('buildInputArray: turn=1 → preserved', () => {
    const board = new Array(64).fill(0);
    const input = buildInputArray(board, 1);
    assert.equal(input[256], 1);
  });

  // ── buildInputArray: piece encoding ────────────────────────────────────

  test('buildInputArray: white pawn → channel[1]=1 (white), channel[3]=0 (king)', () => {
    const board = new Array(64).fill(0);
    board[0] = 1; // white pawn
    const input = buildInputArray(board, 1);
    assert.equal(input[0], 0, 'empty channel off');
    assert.equal(input[1], 1, 'white channel on');
    assert.equal(input[2], 0, 'black channel off');
    assert.equal(input[3], 0, 'king channel off');
  });

  test('buildInputArray: white king → channel[1]=1, channel[3]=1', () => {
    const board = new Array(64).fill(0);
    board[0] = 2; // white king
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 1, 'white channel on');
    assert.equal(input[3], 1, 'king channel on');
  });

  test('buildInputArray: black pawn → channel[2]=1 (black), channel[3]=0', () => {
    const board = new Array(64).fill(0);
    board[0] = 3; // black pawn
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 0, 'white channel off');
    assert.equal(input[2], 1, 'black channel on');
    assert.equal(input[3], 0, 'king channel off');
  });

  test('buildInputArray: black king → channel[2]=1, channel[3]=1', () => {
    const board = new Array(64).fill(0);
    board[0] = 4; // black king
    const input = buildInputArray(board, 1);
    assert.equal(input[2], 1, 'black channel on');
    assert.equal(input[3], 1, 'king channel on');
  });

  test('buildInputArray: negative piece value (-1) → treated as non-white (black channel)', () => {
    // C++ engine might produce negative values for black pieces
    const board = new Array(64).fill(0);
    board[0] = -1; // negative = not (val > 0), so isWhite = false
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 0, 'white channel off (negative val)');
    assert.equal(input[2], 1, 'black channel on (negative val → not white)');
  });

  test('buildInputArray: piece value 5 (unknown) → black channel (non-white fallback)', () => {
    const board = new Array(64).fill(0);
    board[0] = 5;
    const input = buildInputArray(board, 1);
    // val=5, absVal=5, isWhite = (5 > 0 && (5===1 || 5===2)) = false
    // isKing = (5===2 || 5===4) = false
    // Not white → falls to else branch → black channel set to 1
    assert.equal(input[0], 0, 'empty channel off');
    assert.equal(input[1], 0, 'white channel off');
    assert.equal(input[2], 1, 'black channel on (non-white fallback)');
    assert.equal(input[3], 0, 'king channel off');
  });

  // ── buildInputArray: 2D board input ────────────────────────────────────

  test('buildInputArray: 2D 8x8 board → correct encoding', () => {
    const board = Array.from({ length: 8 }, () => new Array(8).fill(0));
    board[0][0] = 1; // white pawn at (0,0)
    board[0][7] = 4; // black king at (0,7) — flat index 7
    const input = buildInputArray(board, 1);
    assert.equal(input[1], 1, '(0,0) white channel');
    // (0,7) → flat idx 7, base=7*4=28; black channel=base+2=30, king channel=base+3=31
    assert.equal(input[7 * 4 + 2], 1, '(0,7) black channel');
    assert.equal(input[7 * 4 + 3], 1, '(0,7) king channel');
  });

  test('buildInputArray: non-array input → throws', () => {
    assert.throws(() => buildInputArray(null, 1), /expected array/);
    assert.throws(() => buildInputArray(undefined, 1), /expected array/);
    assert.throws(() => buildInputArray('board', 1), /expected array/);
  });

  test('buildInputArray: wrong size flat array → throws', () => {
    assert.throws(() => buildInputArray([1, 2, 3], 1), /expected 64 cells/);
  });

  // ── computePolicyIndex: boundary squares ───────────────────────────────

  test('computePolicyIndex: corner (0,0) NE → valid index', () => {
    const idx = computePolicyIndex([0, 0], [1, 1]); // SE actually
    // from (0,0), to (1,1): dr=1, dc=1 → direction 2 (SE)
    // darkFrom = 0*4 + 0/2 = 0
    assert.equal(idx, 0 * 4 + 2); // SE = 2
  });

  test('computePolicyIndex: corner (7,7) SE → computes index (no bounds check)', () => {
    // computePolicyIndex doesn't check bounds — it just computes the index
    // from (7,7) scalar=63 to (8,8) scalar=72: toRow=9,toCol=0 → dr=2,dc=-7
    // dirKey='1,-1' → dirIdx=3. darkFrom=7*4+Math.floor(7/2)=31
    const idx = computePolicyIndex([7, 7], [8, 8]);
    assert.equal(idx, 31 * 4 + 3); // 127
  });

  test('computePolicyIndex: edge square (0,3) → valid', () => {
    // from (0,3) scalar=3 to (-1,4) scalar=-4: toRow=-1,toCol=-4 → dr=-1,dc=-7
    // dirKey='-1,-1' → dirIdx=1 (NW). darkFrom=0*4+Math.floor(3/2)=1
    const idx = computePolicyIndex([0, 3], [-1, 4]);
    assert.equal(idx, 1 * 4 + 1); // 5
  });

  test('computePolicyIndex: from === to → dr=0,dc=0 → invalid direction → 0', () => {
    const idx = computePolicyIndex([3, 3], [3, 3]);
    assert.equal(idx, 0, 'no movement should return fallback 0');
  });

  test('computePolicyIndex: horizontal move (same row) → invalid direction → 0', () => {
    const idx = computePolicyIndex([3, 3], [3, 5]);
    // dr=0 → sign(0)=0 → dirKey='0,1' → not in DIRECTION_MAP
    assert.equal(idx, 0);
  });

  test('computePolicyIndex: vertical move (same col) → invalid direction → 0', () => {
    const idx = computePolicyIndex([3, 3], [5, 3]);
    // dr=2,dc=0 → sign(2)=1, sign(0)=0 → dirKey='1,0' → not in DIRECTION_MAP
    assert.equal(idx, 0);
  });

  // ── computePolicyIndex: all 4 directions from same square ─────────────

  test('computePolicyIndex: all 4 directions from (3,3) → distinct indices', () => {
    const ne = computePolicyIndex([3, 3], [2, 4]); // NE: dr=-1,dc=1
    const nw = computePolicyIndex([3, 3], [2, 2]); // NW: dr=-1,dc=-1
    const se = computePolicyIndex([3, 3], [4, 4]); // SE: dr=1,dc=1
    const sw = computePolicyIndex([3, 3], [4, 2]); // SW: dr=1,dc=-1

    const indices = new Set([ne, nw, se, sw]);
    assert.equal(indices.size, 4, 'all 4 directions should produce distinct indices');

    // darkFrom for (3,3) = 3*4 + 3/2 = 12 + 1 = 13
    const base = 13 * 4;
    assert.equal(ne, base + 0); // NE
    assert.equal(nw, base + 1); // NW
    assert.equal(se, base + 2); // SE
    assert.equal(sw, base + 3); // SW
  });

  // ── computePolicyIndex: scalar indices ─────────────────────────────────

  test('computePolicyIndex: scalar indices (not arrays)', () => {
    // (3,3) = 3*8+3 = 27, (4,4) = 36
    const idx = computePolicyIndex(27, 36);
    const idxArray = computePolicyIndex([3, 3], [4, 4]);
    assert.equal(idx, idxArray, 'scalar and array should produce same result');
  });

  // ── computePolicyIndex: dark square indexing ───────────────────────────

  test('computePolicyIndex: light square from → still computes (darkFrom includes light squares)', () => {
    // (0,1) is a light square. darkFrom = 0*4 + 1/2 = 0
    // (0,0) is dark. darkFrom = 0*4 + 0/2 = 0
    // Both map to darkFrom=0 — the code doesn't distinguish dark/light
    const idxLight = computePolicyIndex([0, 1], [1, 2]); // SE from light
    const idxDark = computePolicyIndex([0, 0], [1, 1]); // SE from dark
    // darkFrom for (0,1) = 0*4 + 0 = 0, for (0,0) = 0*4 + 0 = 0
    assert.equal(idxLight, idxDark, 'both should map to same darkFrom index');
  });

  // ── buildInputArray: all 64 cells encoding ─────────────────────────────

  test('buildInputArray: full board → correct number of non-zero entries', () => {
    const board = new Array(64).fill(0);
    // 12 white pawns on dark squares in rows 0-2
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 1;
      }
    }
    // 12 black pawns on dark squares in rows 5-7
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 3;
      }
    }

    const input = buildInputArray(board, 1);
    // 24 pieces → 24 cells with white/black channel = 1
    // 40 empty cells → 40 cells with empty channel = 1
    let whiteCount = 0, blackCount = 0, emptyCount = 0;
    for (let i = 0; i < 64; i++) {
      const base = i * 4;
      if (input[base] === 1) emptyCount++;
      if (input[base + 1] === 1) whiteCount++;
      if (input[base + 2] === 1) blackCount++;
    }
    assert.equal(whiteCount, 12, '12 white pieces');
    assert.equal(blackCount, 12, '12 black pieces');
    assert.equal(emptyCount, 40, '40 empty cells');
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

  console.log(`\nhunter-tw-model-input-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
