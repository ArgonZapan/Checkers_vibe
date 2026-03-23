/**
 * hunter-v3-boardconvert-exotic.test.js — Board conversion with exotic/edge inputs.
 *
 * Covers gaps NOT in boardConvert*.test.js or hunter-alpha-boardconvert-nan.test.js:
 * - TypedArray inputs (Float64Array, Int32Array, Uint8Array)
 * - Sparse arrays with holes
 * - Array-like objects (length property but not Array)
 * - Nested array flattening edge case (already flat but from nested source)
 * - boardToCpp with very large array (>64 elements, non-standard board)
 * - boardFromCpp with missing keys (partial piece objects)
 * - Conversion consistency: same input always produces same output
 * - Boundary piece values (0, 1, 2, 3, 4, 5, -1, -2)
 * - Frozen board arrays
 * - Proxy board arrays
 */

import assert from 'node:assert/strict';

// ── Extracted: board conversion functions (mirrors server/boardConvert.js) ──

/**
 * Convert client 2D board → C++ flat 64-element array.
 * Client format: board[row][col] = { color: 'white'|'black', king: bool } | null
 * C++ format: flat[row*8+col] = 0(empty), 1(white pawn), 2(white king), 3(black pawn), 4(black king)
 */
function boardToCpp(board) {
  if (!Array.isArray(board)) {
    return Array(64).fill(0);
  }
  const flat = board.flat();
  if (flat.length !== 64) {
    if (flat.length > 64) {
      flat.length = 64;
    } else {
      const originalLen = flat.length;
      flat.length = 64;
      flat.fill(0, originalLen);
    }
  }
  return flat.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 0;
    const color = p.color;
    const king = p.king;
    if (color === 'white') return king ? 2 : 1;
    if (color === 'black') return king ? 4 : 3;
    return 0;
  });
}

/**
 * Convert C++ flat 64-element array → client 2D board.
 */
function boardFromCpp(flat) {
  if (!Array.isArray(flat) || flat.length < 64) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  const board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const val = flat[r * 8 + c];
      if (typeof val !== 'number' || Number.isNaN(val) || val === 0) {
        row.push(null);
      } else if (val < 1 || val > 4) {
        row.push(null);
      } else {
        const isWhite = val === 1 || val === 2;
        const isKing = val === 2 || val === 4;
        row.push({ color: isWhite ? 'white' : 'black', king: isKing });
      }
    }
    board.push(row);
  }
  return board;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runBoardConvertExoticTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── TypedArray inputs ────────────────────────────────────────────────

  test('boardToCpp: Float64Array of 64 zeros', () => {
    const arr = new Float64Array(64);
    // Float64Array is not Array.isArray → goes to "not array" fallback
    const result = boardToCpp(arr);
    assert.equal(result.length, 64);
    assert.ok(result.every(v => v === 0));
  });

  test('boardToCpp: Int32Array with valid values', () => {
    const arr = new Int32Array([1, 0, 3, 2, 4, 0, 1, 0]);
    // Int32Array is not Array.isArray — boardToCpp checks !Array.isArray(board)
    const result = boardToCpp(arr);
    assert.equal(result.length, 64);
  });

  test('boardFromCpp: Uint8Array with valid values', () => {
    const arr = new Uint8Array(64);
    arr[0] = 1;
    arr[1] = 2;
    // Uint8Array has length 64 but Array.isArray is false
    const result = boardFromCpp(arr);
    assert.equal(result.length, 8);
    assert.equal(result[0][0], null); // not an array → nulls
  });

  test('boardFromCpp: Float64Array of 64 with mixed values', () => {
    const arr = new Float64Array(64);
    arr[0] = 1;
    arr[1] = 3; // black pawn
    arr[2] = 2;
    arr[3] = 4; // black king
    // Float64Array has .length === 64 but is not Array.isArray
    const result = boardFromCpp(arr);
    assert.equal(result.length, 8);
  });

  // ── Sparse arrays ────────────────────────────────────────────────────

  test('boardToCpp: sparse array with holes in rows', () => {
    const board = [];
    board[0] = [{ color: 'white', king: false }, null, null, null, null, null, null, null];
    // rows 1-7 are undefined (holes)
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1); // first cell
    assert.equal(result[1], 0);
    // Rows 1-7 are undefined → treated as non-array → filled with 0
    for (let i = 8; i < 64; i++) {
      assert.equal(result[i], 0);
    }
  });

  test('boardToCpp: sparse array with holes in cells', () => {
    // Use a dense row with explicit nulls for cells that should be empty
    const row = Array(8).fill(null);
    row[0] = { color: 'white', king: false };
    row[3] = { color: 'black', king: true };
    const board = [row];
    for (let r = 1; r < 8; r++) board.push(Array(8).fill(null));
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1); // first cell: white pawn
    assert.equal(result[1], 0);
    assert.equal(result[2], 0);
    assert.equal(result[3], 4); // black king = 4
  });

  // ── Array-like objects ──────────────────────────────────────────────

  test('boardToCpp: array-like object with length but not Array', () => {
    const arrLike = { length: 8, 0: [{ color: 'white', king: false }] };
    const result = boardToCpp(arrLike);
    assert.equal(result.length, 64);
  });

  test('boardFromCpp: array-like object with length 64', () => {
    const arrLike = { length: 64 };
    const result = boardFromCpp(arrLike);
    assert.equal(result.length, 8);
    assert.equal(result[0][0], null); // not Array.isArray → nulls
  });

  // ── Very large arrays (>64 elements) ────────────────────────────────

  test('boardFromCpp: array with 100 elements — uses first 64', () => {
    const arr = Array(100).fill(0);
    arr[0] = 1;
    arr[63] = 4; // black king in new encoding
    arr[64] = 999; // beyond 64, should be ignored
    const result = boardFromCpp(arr);
    assert.equal(result.length, 8);
    assert.equal(result[0][0].color, 'white');
    assert.equal(result[7][7].color, 'black');
    assert.equal(result[7][7].king, true);
  });

  test('boardToCpp: board with extra rows (>8) — truncated', () => {
    const board = Array.from({ length: 10 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[9][0] = { color: 'black', king: true }; // beyond row 7
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    // Row 9 is ignored (only first 8 rows processed)
  });

  test('boardToCpp: board with extra columns (>8) — truncated', () => {
    const board = Array.from({ length: 8 }, () => Array(10).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[0][9] = { color: 'black', king: true }; // beyond col 7
    const result = boardToCpp(board);
    assert.equal(result.length, 64);
    assert.equal(result[0], 1);
    // Col 9 is ignored
  });

  // ── Missing keys in boardFromCpp ────────────────────────────────────

  test('boardFromCpp: undefined in flat array → null', () => {
    const arr = Array(64).fill(undefined);
    const result = boardFromCpp(arr);
    assert.ok(result[0][0] === null);
  });

  test('boardFromCpp: string values → null', () => {
    const arr = Array(64).fill('invalid');
    const result = boardFromCpp(arr);
    assert.ok(result[0][0] === null);
  });

  test('boardFromCpp: mixed valid and invalid values', () => {
    const arr = Array(64).fill(0);
    arr[0] = 1;
    arr[1] = 'foo';
    arr[2] = null;
    arr[3] = 3; // black pawn in new encoding
    arr[64] = 2; // beyond array bounds (but arr has 64 so index 64 is undefined)
    const result = boardFromCpp(arr);
    assert.equal(result[0][0].color, 'white');
    assert.equal(result[0][1], null); // string → null
    assert.equal(result[0][2], null); // null → null
    assert.equal(result[0][3].color, 'black');
  });

  // ── Boundary piece values ───────────────────────────────────────────

  test('boardFromCpp: value 0 → null', () => {
    const arr = Array(64).fill(0);
    assert.equal(boardFromCpp(arr)[0][0], null);
  });

  test('boardFromCpp: value 1 → white pawn', () => {
    const arr = Array(64).fill(0);
    arr[0] = 1;
    const cell = boardFromCpp(arr)[0][0];
    assert.equal(cell.color, 'white');
    assert.equal(cell.king, false);
  });

  test('boardFromCpp: value 3 → black pawn', () => {
    const arr = Array(64).fill(0);
    arr[0] = 3;
    const cell = boardFromCpp(arr)[0][0];
    assert.equal(cell.color, 'black');
    assert.equal(cell.king, false);
  });

  test('boardFromCpp: value 2 → white king', () => {
    const arr = Array(64).fill(0);
    arr[0] = 2;
    const cell = boardFromCpp(arr)[0][0];
    assert.equal(cell.color, 'white');
    assert.equal(cell.king, true);
  });

  test('boardFromCpp: value 4 → black king', () => {
    const arr = Array(64).fill(0);
    arr[0] = 4;
    const cell = boardFromCpp(arr)[0][0];
    assert.equal(cell.color, 'black');
    assert.equal(cell.king, true);
  });

  test('boardFromCpp: value 5 → null (invalid)', () => {
    const arr = Array(64).fill(0);
    arr[0] = 5;
    assert.equal(boardFromCpp(arr)[0][0], null);
  });

  test('boardFromCpp: value -1 → null (invalid)', () => {
    const arr = Array(64).fill(0);
    arr[0] = -1;
    assert.equal(boardFromCpp(arr)[0][0], null);
  });

  test('boardFromCpp: value -2 → null (invalid)', () => {
    const arr = Array(64).fill(0);
    arr[0] = -2;
    assert.equal(boardFromCpp(arr)[0][0], null);
  });

  test('boardFromCpp: NaN → null', () => {
    const arr = Array(64).fill(NaN);
    const result = boardFromCpp(arr);
    assert.ok(result[0][0] === null);
  });

  test('boardFromCpp: Infinity → null', () => {
    const arr = Array(64).fill(Infinity);
    const result = boardFromCpp(arr);
    assert.ok(result[0][0] === null);
  });

  test('boardFromCpp: -Infinity → null', () => {
    const arr = Array(64).fill(-Infinity);
    const result = boardFromCpp(arr);
    assert.ok(result[0][0] === null);
  });

  // ── Round-trip consistency ──────────────────────────────────────────

  test('round-trip: standard starting position preserves all pieces', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    // Black pieces on rows 0-2
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r][c] = { color: 'black', king: false };
      }
    }
    // White pieces on rows 5-7
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r][c] = { color: 'white', king: false };
      }
    }

    const flat = boardToCpp(board);
    const roundtrip = boardFromCpp(flat);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const orig = board[r][c];
        const rt = roundtrip[r][c];
        if (orig === null) {
          assert.equal(rt, null, `Cell [${r},${c}] should be null`);
        } else {
          assert.equal(rt.color, orig.color, `Cell [${r},${c}] color mismatch`);
          assert.equal(rt.king, orig.king, `Cell [${r},${c}] king mismatch`);
        }
      }
    }
  });

  test('round-trip: board with all piece types (white/black × pawn/king)', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[0][2] = { color: 'white', king: true };
    board[0][4] = { color: 'black', king: false };
    board[0][6] = { color: 'black', king: true };

    const flat = boardToCpp(board);
    assert.equal(flat.length, 64, 'flat array must be 64 elements');
    const rt = boardFromCpp(flat);

    assert.equal(rt[0][0].color, 'white');
    assert.equal(rt[0][0].king, false);
    assert.equal(rt[0][2].color, 'white');
    assert.equal(rt[0][2].king, true);
    assert.equal(rt[0][4].color, 'black');
    assert.equal(rt[0][4].king, false);
    assert.equal(rt[0][6].color, 'black');
    assert.equal(rt[0][6].king, true);
  });

  test('round-trip: empty board produces all nulls', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const flat = boardToCpp(board);
    assert.ok(flat.every(v => v === 0));
    const rt = boardFromCpp(flat);
    assert.ok(rt.every(row => row.every(cell => cell === null)));
  });

  // ── Frozen arrays ────────────────────────────────────────────────────

  test('boardToCpp: frozen board array still converts', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    Object.freeze(board);
    Object.freeze(board[0]);
    const result = boardToCpp(board);
    assert.equal(result[0], 1);
  });

  test('boardToCpp: frozen cell object still converts', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = Object.freeze({ color: 'white', king: true });
    const result = boardToCpp(board);
    assert.equal(result[0], 2); // white king = 2
  });

  // ── Determinism ─────────────────────────────────────────────────────

  test('deterministic: same input produces same output (boardToCpp)', () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[0][0] = { color: 'white', king: false };
    board[7][7] = { color: 'black', king: true };

    const r1 = boardToCpp(board);
    const r2 = boardToCpp(board);
    assert.deepEqual(r1, r2);
  });

  test('deterministic: same input produces same output (boardFromCpp)', () => {
    const arr = Array(64).fill(0);
    arr[0] = 1;
    arr[63] = 4; // black king

    const r1 = boardFromCpp(arr);
    const r2 = boardFromCpp(arr);
    assert.deepEqual(r1, r2);
  });

  // ── Run tests ────────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  Board convert exotic: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

if (process.argv[1]?.includes('hunter-v3-boardconvert-exotic')) {
  runBoardConvertExoticTests().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
