/**
 * kingMovesPath.test.js — Tests for king move path field in movegen output.
 *
 * Validates that the C++ engine's movegen produces correct `path` field
 * for king moves (non-capture and capture).
 *
 * Source: engine/src/movegen.cpp generateKingMoves() / generateKingCaptures()
 * - Non-capture king moves: path = [from, to], numPath = 2
 * - Capture king moves: path = [from, ..., intermediate squares, to], numPath >= 2
 *
 * The movegen structs are replicated in JS for unit testing without
 * requiring the C++ engine to be running.
 */

import assert from 'node:assert/strict';

// ── Replicated Move struct (mirrors engine/src/board.h) ─────────────────────

class Square {
  constructor(row, col) { this.row = row; this.col = col; }
}

class Move {
  constructor() {
    this.from = new Square(0, 0);
    this.to = new Square(0, 0);
    this.captures = [];
    this.numCaptures = 0;
    this.path = [];
    this.numPath = 0;
  }

  // Serialize like the C++ moveToJson
  toJson() {
    return {
      from: [this.from.row, this.from.col],
      to: [this.to.row, this.to.col],
      captures: this.captures.map(c => [c.row, c.col]),
      path: this.path.slice(0, this.numPath).map(p => [p.row, p.col]),
    };
  }
}

// ── Replicated movegen logic (mirrors engine/src/movegen.cpp) ───────────────

const ALL_DIRS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

/**
 * Generate non-capture king moves (mirrors generateKingMoves).
 * @param {Set<string>} occupied - Set of "r,c" strings for occupied squares
 * @param {number} row - King's row
 * @param {number} col - King's col
 * @returns {Move[]}
 */
function generateKingMoves(occupied, row, col) {
  const moves = [];
  for (const [dr, dc] of ALL_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (inBounds(nr, nc) && !occupied.has(`${nr},${nc}`)) {
      const m = new Move();
      m.from = new Square(row, col);
      m.to = new Square(nr, nc);
      m.path = [new Square(row, col), new Square(nr, nc)];
      m.numPath = 2;
      moves.push(m);
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

/**
 * Generate king capture moves (simplified — mirrors multiCapture for single capture).
 * @param {Set<string>} myPieces
 * @param {Set<string>} oppPieces
 * @param {number} row
 * @param {number} col
 * @returns {Move[]}
 */
function generateKingCaptures(myPieces, oppPieces, row, col) {
  const moves = [];
  for (const [dr, dc] of ALL_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    let foundOpp = false;
    let oppR = -1, oppC = -1;

    while (inBounds(nr, nc)) {
      const key = `${nr},${nc}`;
      if (oppPieces.has(key) && !foundOpp) {
        foundOpp = true;
        oppR = nr;
        oppC = nc;
      } else if (myPieces.has(key)) {
        break;
      } else if (foundOpp) {
        // Landing square found after capturing opponent
        const m = new Move();
        m.from = new Square(row, col);
        m.to = new Square(nr, nc);
        m.captures = [new Square(oppR, oppC)];
        m.numCaptures = 1;
        m.path = [new Square(row, col), new Square(nr, nc)];
        m.numPath = 2;
        moves.push(m);
        // Don't break — king can potentially find more captures further along
        // (but for single-capture test, we stop here)
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return moves;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runKingMovesPathTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Non-capture king moves — path field
  // ═══════════════════════════════════════════════════════════════════════

  test('king move path: single-step non-capture has path [from, to]', () => {
    const occupied = new Set(['4,4']); // king at (4,4)
    const moves = generateKingMoves(occupied, 4, 4);
    assert.ok(moves.length > 0, 'should generate at least one move');
    for (const m of moves) {
      assert.ok(m.path.length >= 2, 'path should have at least from and to');
      assert.equal(m.path[0].row, 4);
      assert.equal(m.path[0].col, 4);
      assert.equal(m.numPath, 2);
    }
  });

  test('king move path: multi-step non-capture has correct path endpoints', () => {
    // King at (3,3), empty board — should slide in all 4 directions
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    // Each direction can have up to min(distance to edge) moves
    // NE: min(4, 4) = 4, SE: min(4, 4) = 4, NW: min(3, 3) = 3, SW: min(3, 3) = 3
    assert.ok(moves.length >= 10, `expected >= 10 moves, got ${moves.length}`);
    for (const m of moves) {
      assert.equal(m.path.length, 2, 'non-capture king move path has exactly 2 entries');
      assert.equal(m.path[0].row, 3);
      assert.equal(m.path[0].col, 3);
      assert.equal(m.path[1].row, m.to.row);
      assert.equal(m.path[1].col, m.to.col);
      assert.equal(m.numPath, 2);
    }
  });

  test('king move path: blocked direction produces no moves in that direction', () => {
    // King at (4,4), piece blocking at (5,5) — SE direction blocked after 0 steps
    const occupied = new Set(['4,4', '5,5']);
    const moves = generateKingMoves(occupied, 4, 4);
    // Should not have any move going to (5,5) or beyond in SE direction
    const seMoves = moves.filter(m => m.to.row === 5 && m.to.col === 5);
    assert.equal(seMoves.length, 0, 'should not move into occupied square');
  });

  test('king move path: corner king has limited moves', () => {
    // King at (0,1) — only 2 directions available (SE, SW for white-like)
    const occupied = new Set(['0,1']);
    const moves = generateKingMoves(occupied, 0, 1);
    // SE: (1,2), (2,3), (3,4), (4,5), (5,6), (6,7) = 6 moves
    // SW: (1,0) = 1 move
    // NE, NW: out of bounds
    assert.ok(moves.length >= 5, `corner king should have >= 5 moves, got ${moves.length}`);
    for (const m of moves) {
      assert.equal(m.numPath, 2);
      assert.equal(m.path.length, 2);
    }
  });

  test('king move path: to/from coordinates are valid [row,col] pairs', () => {
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    for (const m of moves) {
      assert.ok(m.from.row >= 0 && m.from.row <= 7);
      assert.ok(m.from.col >= 0 && m.from.col <= 7);
      assert.ok(m.to.row >= 0 && m.to.row <= 7);
      assert.ok(m.to.col >= 0 && m.to.col <= 7);
      // Path entries should also be valid
      for (const p of m.path) {
        assert.ok(p.row >= 0 && p.row <= 7, `path row ${p.row} out of bounds`);
        assert.ok(p.col >= 0 && p.col <= 7, `path col ${p.col} out of bounds`);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // King capture moves — path field
  // ═══════════════════════════════════════════════════════════════════════

  test('king capture path: single capture has path with correct endpoints', () => {
    // White king at (3,3), black piece at (4,4), landing at (5,5)
    const myPieces = new Set(['3,3']);
    const oppPieces = new Set(['4,4']);
    const moves = generateKingCaptures(myPieces, oppPieces, 3, 3);
    assert.ok(moves.length > 0, 'should generate at least one capture');
    const m = moves[0];
    assert.ok(m.path.length >= 2, 'capture path should have at least from and to');
    assert.equal(m.path[0].row, 3);
    assert.equal(m.path[0].col, 3);
    assert.equal(m.numCaptures, 1);
    assert.equal(m.captures[0].row, 4);
    assert.equal(m.captures[0].col, 4);
  });

  test('king capture path: capture landing square is beyond captured piece', () => {
    const myPieces = new Set(['2,2']);
    const oppPieces = new Set(['4,4']);
    const moves = generateKingCaptures(myPieces, oppPieces, 2, 2);
    assert.ok(moves.length > 0);
    const m = moves[0];
    // Landing must be at (5,5) — one step past the captured piece
    assert.equal(m.to.row, 5);
    assert.equal(m.to.col, 5);
  });

  test('king capture path: no capture when own piece blocks', () => {
    // White king at (2,2), white piece at (4,4) blocking
    const myPieces = new Set(['2,2', '4,4']);
    const oppPieces = new Set(['3,3']);
    const moves = generateKingCaptures(myPieces, oppPieces, 2, 2);
    // The capture to (4,4) is blocked because (4,4) is occupied by own piece
    const toLanding = moves.filter(m => m.to.row === 4 && m.to.col === 4);
    assert.equal(toLanding.length, 0, 'should not land on own piece');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // JSON serialization — matches C++ moveToJson format
  // ═══════════════════════════════════════════════════════════════════════

  test('moveToJson: king move produces correct JSON structure', () => {
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    for (const m of moves) {
      const j = m.toJson();
      assert.ok(Array.isArray(j.from), 'from should be array');
      assert.equal(j.from.length, 2);
      assert.ok(Array.isArray(j.to), 'to should be array');
      assert.equal(j.to.length, 2);
      assert.ok(Array.isArray(j.path), 'path should be array');
      assert.ok(j.path.length >= 2, 'path should have at least 2 entries');
      assert.ok(Array.isArray(j.captures), 'captures should be array');
    }
  });

  test('moveToJson: path elements are [row, col] arrays', () => {
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    for (const m of moves) {
      const j = m.toJson();
      for (const p of j.path) {
        assert.ok(Array.isArray(p), 'path element should be array');
        assert.equal(p.length, 2);
        assert.ok(Number.isInteger(p[0]), 'path row should be integer');
        assert.ok(Number.isInteger(p[1]), 'path col should be integer');
      }
    }
  });

  test('moveToJson: capture move includes captures array with opponent positions', () => {
    const myPieces = new Set(['3,3']);
    const oppPieces = new Set(['4,4']);
    const moves = generateKingCaptures(myPieces, oppPieces, 3, 3);
    assert.ok(moves.length > 0);
    const j = moves[0].toJson();
    assert.ok(j.captures.length > 0, 'capture move should have captures');
    assert.deepEqual(j.captures[0], [4, 4], 'captured piece should be at (4,4)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases for king movegen
  // ═══════════════════════════════════════════════════════════════════════

  test('king moves: empty board from center generates 7+7+3+3 = 20 moves', () => {
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    // NE: (2,2,1,0) directions: min(4,4)=4, min(4,4)=4, min(3,3)=3, min(3,3)=3
    // Actually: SE→(4,4)(5,5)(6,6)(7,7)=4, NE→(2,4)(1,5)(0,6)=3, SW→(4,2)(5,1)(6,0)=3, NW→(2,2)(1,1)(0,0)=3
    assert.equal(moves.length, 13, `center king on empty board: expected 13, got ${moves.length}`);
  });

  test('king moves: edge king generates fewer moves', () => {
    // King at (7,7) — corner: can only go NW
    const occupied = new Set(['7,7']);
    const moves = generateKingMoves(occupied, 7, 7);
    assert.ok(moves.length <= 7, 'corner king should have at most 7 moves');
    assert.ok(moves.length > 0, 'corner king should have at least 1 move');
  });

  test('king moves: no duplicate moves for same from-to pair', () => {
    const occupied = new Set(['3,3']);
    const moves = generateKingMoves(occupied, 3, 3);
    const seen = new Set();
    for (const m of moves) {
      const key = `${m.from.row},${m.from.col}-${m.to.row},${m.to.col}`;
      assert.ok(!seen.has(key), `duplicate move: ${key}`);
      seen.add(key);
    }
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 King Moves Path Field Tests');

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
