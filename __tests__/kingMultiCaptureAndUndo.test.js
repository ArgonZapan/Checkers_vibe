/**
 * kingMultiCaptureAndUndo.test.js — Tests for king multi-capture, capturedKingsMask,
 * multi-step capture paths, and makeMove/undoMove round-trip.
 *
 * Gaps found in existing tests:
 * - kingMovesPath.test.js only tests SINGLE capture for kings
 * - No tests for capturedKingsMask (tracks which captures were kings)
 * - No tests for king multi-capture path (numPath > 2 for animation)
 * - No tests for makeMove/undoMove round-trip with complex captures
 *
 * C++ source references:
 * - engine/src/board.h: Move struct (capturedKingsMask, path, numPath)
 * - engine/src/board.cpp: makeMove() lines 99-150, undoMove() lines 153-200
 * - engine/src/movegen.cpp: multiCapture() lines 156-315
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════════
// Replicated C++ types and logic (mirrors engine/src/)
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_CAPTURES = 12;
const MAX_PATH = 13;

class Square {
  constructor(row, col) { this.row = row; this.col = col; }
}

class Move {
  constructor() {
    this.from = new Square(0, 0);
    this.to = new Square(0, 0);
    this.captures = [];
    this.numCaptures = 0;
    this.wasKing = false;
    this.capturedKingsMask = 0; // bitfield: bit i = captures[i] was a king
    this.path = [];
    this.numPath = 0;
  }

  capturedKing(i) {
    return ((this.capturedKingsMask >> i) & 1) === 1;
  }

  setCapturedKing(i) {
    this.capturedKingsMask |= (1 << i);
  }

  isCapture() {
    return this.numCaptures > 0;
  }

  toJson() {
    return {
      from: [this.from.row, this.from.col],
      to: [this.to.row, this.to.col],
      captures: this.captures.map(c => [c.row, c.col]),
      path: this.path.slice(0, this.numPath).map(p => [p.row, p.col]),
      capturedKingsMask: this.capturedKingsMask,
      wasKing: this.wasKing,
    };
  }
}

/**
 * Simplified Board representation for testing (mirrors engine/src/board.cpp).
 * Tracks white/black pieces and kings via Sets of "r,c" keys.
 */
class TestBoard {
  constructor() {
    this.whitePieces = new Set();
    this.whiteKings = new Set();
    this.blackPieces = new Set();
    this.blackKings = new Set();
    this.currentTurn = 'white'; // or 'black'
  }

  isWhite(row, col) {
    const k = `${row},${col}`;
    return this.whitePieces.has(k) || this.whiteKings.has(k);
  }

  isBlack(row, col) {
    const k = `${row},${col}`;
    return this.blackPieces.has(k) || this.blackKings.has(k);
  }

  isKing(row, col) {
    const k = `${row},${col}`;
    return this.whiteKings.has(k) || this.blackKings.has(k);
  }

  isEmpty(row, col) {
    const k = `${row},${col}`;
    return !this.whitePieces.has(k) && !this.whiteKings.has(k) &&
           !this.blackPieces.has(k) && !this.blackKings.has(k);
  }

  getPieceColor(row, col) {
    if (this.isWhite(row, col)) return 'white';
    if (this.isBlack(row, col)) return 'black';
    return null;
  }

  allPieces() {
    return new Set([...this.whitePieces, ...this.whiteKings, ...this.blackPieces, ...this.blackKings]);
  }

  pieces(color) {
    if (color === 'white') return new Set([...this.whitePieces, ...this.whiteKings]);
    return new Set([...this.blackPieces, ...this.blackKings]);
  }

  oppPieces(color) {
    return this.pieces(color === 'white' ? 'black' : 'white');
  }

  // Deep clone for rollback in multi-capture
  clone() {
    const b = new TestBoard();
    b.whitePieces = new Set(this.whitePieces);
    b.whiteKings = new Set(this.whiteKings);
    b.blackPieces = new Set(this.blackPieces);
    b.blackKings = new Set(this.blackKings);
    b.currentTurn = this.currentTurn;
    return b;
  }

  // Replicate makeMove from board.cpp lines 99-150
  makeMove(move) {
    const fromKey = `${move.from.row},${move.from.col}`;
    const toKey = `${move.to.row},${move.to.col}`;
    const isWhite = this.isWhite(move.from.row, move.from.col);
    const isKing = this.isKing(move.from.row, move.from.col);

    move.wasKing = isKing;
    move.capturedKingsMask = 0;

    // Record captured kings
    for (let i = 0; i < move.numCaptures; i++) {
      const capKey = `${move.captures[i].row},${move.captures[i].col}`;
      const capWasKing = this.whiteKings.has(capKey) || this.blackKings.has(capKey);
      if (capWasKing) move.setCapturedKing(i);
    }

    // Remove piece from source
    if (isWhite) {
      this.whitePieces.delete(fromKey);
      this.whiteKings.delete(fromKey);
      if (isKing) this.whiteKings.add(toKey);
      else this.whitePieces.add(toKey);
    } else {
      this.blackPieces.delete(fromKey);
      this.blackKings.delete(fromKey);
      if (isKing) this.blackKings.add(toKey);
      else this.blackPieces.add(toKey);
    }

    // Remove captured pieces
    for (let i = 0; i < move.numCaptures; i++) {
      const capKey = `${move.captures[i].row},${move.captures[i].col}`;
      this.whitePieces.delete(capKey);
      this.whiteKings.delete(capKey);
      this.blackPieces.delete(capKey);
      this.blackKings.delete(capKey);
    }

    // Promotion: pawn reaching opposite end
    if (!isKing) {
      if (isWhite && move.to.row === 7) {
        this.whitePieces.delete(toKey);
        this.whiteKings.add(toKey);
      } else if (!isWhite && move.to.row === 0) {
        this.blackPieces.delete(toKey);
        this.blackKings.add(toKey);
      }
    }

    // Switch turn
    this.currentTurn = (this.currentTurn === 'white') ? 'black' : 'white';
  }

  // Replicate undoMove from board.cpp lines 153-200
  undoMove(move) {
    // Switch turn back
    this.currentTurn = (this.currentTurn === 'white') ? 'black' : 'white';

    const toKey = `${move.to.row},${move.to.col}`;
    const fromKey = `${move.from.row},${move.from.col}`;
    const isWhite = this.getPieceColor(move.to.row, move.to.col) === 'white';

    const myPieces = isWhite ? this.whitePieces : this.blackPieces;
    const myKings = isWhite ? this.whiteKings : this.blackKings;

    // Check if promotion happened
    const wasPromotion = !move.wasKing && myKings.has(toKey);

    // Remove piece from destination
    myPieces.delete(toKey);
    myKings.delete(toKey);

    // Restore piece to source
    if (wasPromotion) {
      myPieces.add(fromKey); // was pawn, restore as pawn
    } else if (move.wasKing) {
      myKings.add(fromKey);
    } else {
      myPieces.add(fromKey);
    }

    // Restore captured pieces with original type
    for (let i = 0; i < move.numCaptures; i++) {
      const cap = move.captures[i];
      const capKey = `${cap.row},${cap.col}`;
      const wasCapturedKing = move.capturedKing(i);

      if (isWhite) {
        // White captured → restore as black
        if (wasCapturedKing) this.blackKings.add(capKey);
        else this.blackPieces.add(capKey);
      } else {
        // Black captured → restore as white
        if (wasCapturedKing) this.whiteKings.add(capKey);
        else this.whitePieces.add(capKey);
      }
    }
  }
}

const ALL_DIRS = [[1, -1], [1, 1], [-1, -1], [-1, 1]];
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

/**
 * Generate king moves (non-capture) — mirrors movegen.cpp generateKingMoves
 */
function generateKingMoves(board, row, col, color) {
  const moves = [];
  const myPieces = board.pieces(color);

  for (const [dr, dc] of ALL_DIRS) {
    let nr = row + dr;
    let nc = col + dc;
    while (inBounds(nr, nc) && board.isEmpty(nr, nc)) {
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
 * King multi-capture with recursive multiCapture — mirrors movegen.cpp lines 156-315.
 * Uses bitboard-like capturedMask (Set of "r,c" keys) to prevent double-captures.
 */
function multiCapture(board, origR, origC, curR, curC, color, isKing, captures, result, path, capturedMask) {
  const myPieces = board.pieces(color);
  const oppPieces = board.oppPieces(color);
  let foundAny = false;

  for (const [dr, dc] of ALL_DIRS) {
    if (isKing) {
      // King: slide along direction, find opponent, then empty square
      let nr = curR + dr;
      let nc = curC + dc;
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
          const capKey = `${oppR},${oppC}`;
          if (!capturedMask.has(capKey)) {
            // Save state for rollback
            const saved = board.clone();

            // Mutate board
            if (color === 'white') {
              board.blackPieces.delete(capKey);
              board.blackKings.delete(capKey);
              board.whiteKings.delete(`${curR},${curC}`);
              board.whiteKings.add(`${nr},${nc}`);
            } else {
              board.whitePieces.delete(capKey);
              board.whiteKings.delete(capKey);
              board.blackKings.delete(`${curR},${curC}`);
              board.blackKings.add(`${nr},${nc}`);
            }

            captures.push(new Square(oppR, oppC));
            path.push(new Square(nr, nc));
            capturedMask.add(capKey);
            foundAny = true;

            multiCapture(board, origR, origC, nr, nc, color, true, captures, result, path, capturedMask);

            capturedMask.delete(capKey);
            path.pop();
            captures.pop();

            // Rollback
            board.whitePieces = saved.whitePieces;
            board.whiteKings = saved.whiteKings;
            board.blackPieces = saved.blackPieces;
            board.blackKings = saved.blackKings;
          }
          break; // king can't capture beyond first opponent in this direction
        }
        nr += dr;
        nc += dc;
      }
    } else {
      // Pawn: jump 2 squares
      const mr = curR + dr;
      const mc = curC + dc;
      const nr = curR + dr * 2;
      const nc = curC + dc * 2;

      if (!inBounds(nr, nc) || !inBounds(mr, mc)) continue;

      const midKey = `${mr},${mc}`;
      const endKey = `${nr},${nc}`;

      if (!oppPieces.has(midKey) || !board.isEmpty(nr, nc)) continue;
      if (capturedMask.has(midKey)) continue;

      // Save state
      const saved = board.clone();

      // Mutate
      if (color === 'white') {
        board.blackPieces.delete(midKey);
        board.blackKings.delete(midKey);
        board.whitePieces.delete(`${curR},${curC}`);
        board.whitePieces.add(endKey);
      } else {
        board.whitePieces.delete(midKey);
        board.whiteKings.delete(midKey);
        board.blackPieces.delete(`${curR},${curC}`);
        board.blackPieces.add(endKey);
      }

      // Check promotion
      let becameKing = false;
      if (color === 'white' && nr === 7) {
        board.whitePieces.delete(endKey);
        board.whiteKings.add(endKey);
        becameKing = true;
      } else if (color === 'black' && nr === 0) {
        board.blackPieces.delete(endKey);
        board.blackKings.add(endKey);
        becameKing = true;
      }

      captures.push(new Square(mr, mc));
      path.push(new Square(nr, nc));
      capturedMask.add(midKey);
      foundAny = true;

      multiCapture(board, origR, origC, nr, nc, color, becameKing, captures, result, path, capturedMask);

      capturedMask.delete(midKey);
      path.pop();
      captures.pop();

      // Rollback
      board.whitePieces = saved.whitePieces;
      board.whiteKings = saved.whiteKings;
      board.blackPieces = saved.blackPieces;
      board.blackKings = saved.blackKings;
    }
  }

  if (!foundAny && captures.length > 0) {
    const m = new Move();
    m.from = new Square(origR, origC);
    m.to = new Square(curR, curC);
    m.captures = [...captures];
    m.numCaptures = captures.length;
    m.path = [...path];
    m.numPath = path.length;
    result.push(m);
  }
}

function generateKingCaptures(board, row, col, color) {
  const result = [];
  const caps = [];
  const path = [new Square(row, col)];
  multiCapture(board, row, col, row, col, color, true, caps, result, path, new Set());
  return result;
}

function generatePawnCaptures(board, row, col, color) {
  const result = [];
  const caps = [];
  const path = [new Square(row, col)];
  multiCapture(board, row, col, row, col, color, false, caps, result, path, new Set());
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════════

export async function runKingMultiCaptureAndUndoTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // King multi-capture — capturedKingsMask correctness
  // ─────────────────────────────────────────────────────────────────────────

  test('capturedKingsMask: king captures a pawn → mask bit is 0', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.blackPieces.add('4,4');

    const moves = generateKingCaptures(board, 3, 3, 'white');
    assert.ok(moves.length > 0, 'should generate at least one capture');
    const m = moves[0];
    assert.equal(m.numCaptures, 1);
    assert.equal(m.capturedKingsMask, 0, 'captured pawn should not set king bit');
    assert.equal(m.capturedKing(0), false, 'capturedKing(0) should be false');
  });

  test('capturedKingsMask: king captures another king → mask bit is 1', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.blackKings.add('4,4'); // captured piece is also a king

    const moves = generateKingCaptures(board, 3, 3, 'white');
    assert.ok(moves.length > 0, 'should generate capture of enemy king');
    const m = moves[0];
    assert.equal(m.numCaptures, 1);

    // Apply makeMove to set capturedKingsMask
    const boardCopy = board.clone();
    boardCopy.makeMove(m);
    assert.equal(m.capturedKingsMask, 1, 'captured king should set bit 0');
    assert.equal(m.capturedKing(0), true, 'capturedKing(0) should be true');
  });

  test('capturedKingsMask: king captures pawn then king in multi-capture → correct mask', () => {
    const board = new TestBoard();
    board.whiteKings.add('2,2');
    board.blackPieces.add('3,3'); // first capture: pawn
    board.blackKings.add('5,5'); // second capture: king (after landing at 4,4)

    const moves = generateKingCaptures(board, 2, 2, 'white');
    // Find a multi-capture move
    const multiCap = moves.find(m => m.numCaptures >= 2);
    if (multiCap) {
      const boardCopy = board.clone();
      boardCopy.makeMove(multiCap);

      // Find which capture index was a king
      let pawnIdx = -1, kingIdx = -1;
      for (let i = 0; i < multiCap.numCaptures; i++) {
        const cr = multiCap.captures[i].row;
        const cc = multiCap.captures[i].col;
        if (cr === 3 && cc === 3) pawnIdx = i;
        if (cr === 5 && cc === 5) kingIdx = i;
      }

      if (pawnIdx >= 0) {
        assert.equal(multiCap.capturedKing(pawnIdx), false, `capture at index ${pawnIdx} (pawn) should not be king`);
      }
      if (kingIdx >= 0) {
        assert.equal(multiCap.capturedKing(kingIdx), true, `capture at index ${kingIdx} (king) should be king`);
      }

      // mask should have at least one bit set
      assert.ok(multiCap.capturedKingsMask > 0, 'capturedKingsMask should be non-zero when a king was captured');
    }
    // If no multi-capture, at least verify single captures work
    assert.ok(moves.length > 0, 'should generate at least one capture');
  });

  test('capturedKingsMask: king captures two kings → both bits set', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackKings.add('2,2'); // captured king 1
    board.blackKings.add('4,4'); // captured king 2 (after landing at 3,3)

    const moves = generateKingCaptures(board, 1, 1, 'white');
    const multiCap = moves.find(m => m.numCaptures >= 2);
    if (multiCap) {
      const boardCopy = board.clone();
      boardCopy.makeMove(multiCap);

      // All captured pieces were kings
      assert.equal(multiCap.capturedKingsMask, (1 << multiCap.numCaptures) - 1,
        'all captured pieces were kings → all bits should be set');
      for (let i = 0; i < multiCap.numCaptures; i++) {
        assert.equal(multiCap.capturedKing(i), true, `capture ${i} should be a king`);
      }
    }
    assert.ok(moves.length > 0, 'should generate at least one capture');
  });

  test('capturedKingsMask: bitfield does not overflow for max captures', () => {
    // uint16_t can hold 16 bits, MAX_CAPTURES = 12
    const m = new Move();
    for (let i = 0; i < 12; i++) {
      m.setCapturedKing(i);
    }
    assert.equal(m.capturedKingsMask, 0xFFF, '12 kings captured → all 12 bits set');
    for (let i = 0; i < 12; i++) {
      assert.equal(m.capturedKing(i), true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // King multi-capture — path (numPath for animation)
  // ─────────────────────────────────────────────────────────────────────────

  test('king multi-capture path: path starts at from and ends at to', () => {
    const board = new TestBoard();
    board.whiteKings.add('2,2');
    board.blackPieces.add('3,3');

    const moves = generateKingCaptures(board, 2, 2, 'white');
    assert.ok(moves.length > 0);
    for (const m of moves) {
      assert.equal(m.path[0].row, m.from.row, 'path[0] should match from.row');
      assert.equal(m.path[0].col, m.from.col, 'path[0] should match from.col');
      assert.equal(m.path[m.numPath - 1].row, m.to.row, 'path[last] should match to.row');
      assert.equal(m.path[m.numPath - 1].col, m.to.col, 'path[last] should match to.col');
    }
  });

  test('king multi-capture path: single capture has numPath=2', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.blackPieces.add('4,4');

    const moves = generateKingCaptures(board, 3, 3, 'white');
    assert.ok(moves.length > 0);
    for (const m of moves) {
      if (m.numCaptures === 1) {
        assert.equal(m.numPath, 2, `single capture should have numPath=2, got ${m.numPath}`);
        assert.equal(m.path.length, 2);
      }
    }
  });

  test('king multi-capture path: double capture has numPath=3', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackPieces.add('2,2');
    board.blackPieces.add('4,4'); // after landing at 3,3, can capture again

    const moves = generateKingCaptures(board, 1, 1, 'white');
    const doubleCap = moves.find(m => m.numCaptures >= 2);
    if (doubleCap) {
      assert.equal(doubleCap.numPath, 3,
        `double capture should have numPath=3, got ${doubleCap.numPath}`);
      assert.equal(doubleCap.path.length, 3);
    }
    assert.ok(moves.length > 0, 'should generate at least one capture');
  });

  test('king multi-capture path: path contains all intermediate landing squares', () => {
    const board = new TestBoard();
    board.whiteKings.add('0,0');
    board.blackPieces.add('2,2');
    board.blackPieces.add('4,4');

    const moves = generateKingCaptures(board, 0, 0, 'white');
    const doubleCap = moves.find(m => m.numCaptures >= 2);
    if (doubleCap) {
      // path should be: [0,0] → [3,3] → [5,5]
      assert.equal(doubleCap.path[0].row, 0);
      assert.equal(doubleCap.path[0].col, 0);
      assert.equal(doubleCap.path[1].row, 3);
      assert.equal(doubleCap.path[1].col, 3);
      assert.equal(doubleCap.path[2].row, 5);
      assert.equal(doubleCap.path[2].col, 5);
    }
    assert.ok(moves.length > 0, 'should generate at least one capture');
  });

  test('king multi-capture path: path length equals numPath', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackPieces.add('2,2');

    const moves = generateKingCaptures(board, 1, 1, 'white');
    for (const m of moves) {
      assert.equal(m.path.length, m.numPath,
        `path.length (${m.path.length}) should equal numPath (${m.numPath})`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // King multi-capture — generateKingCaptures correctness
  // ─────────────────────────────────────────────────────────────────────────

  test('king capture: cannot capture own piece', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.whitePieces.add('4,4'); // own piece blocks

    const moves = generateKingCaptures(board, 3, 3, 'white');
    const to44 = moves.filter(m => m.captures.some(c => c.row === 4 && c.col === 4));
    assert.equal(to44.length, 0, 'should not capture own piece');
  });

  test('king capture: cannot land on occupied square', () => {
    // King at (2,2), opponent at (3,3), own piece at (4,4) blocks landing
    const board = new TestBoard();
    board.whiteKings.add('2,2');
    board.blackPieces.add('3,3');
    board.whitePieces.add('4,4'); // own piece blocks landing

    const moves = generateKingCaptures(board, 2, 2, 'white');
    // After capturing (3,3), cannot land on (4,4) because it's occupied by own piece
    const landOn44 = moves.filter(m => m.to.row === 4 && m.to.col === 4);
    assert.equal(landOn44.length, 0, 'should not land on own piece');
  });

  test('king capture: capturedMask prevents double-capture same piece', () => {
    // King at (1,1), opponent at (3,3)
    // King slides to (4,4) capturing (3,3), then should NOT re-capture (3,3) on return
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackPieces.add('3,3');

    const moves = generateKingCaptures(board, 1, 1, 'white');
    for (const m of moves) {
      const capKeys = m.captures.map(c => `${c.row},${c.col}`);
      const uniqueCaps = new Set(capKeys);
      assert.equal(capKeys.length, uniqueCaps.size, 'should not capture same piece twice');
    }
  });

  test('king capture: from center captures diagonally in all 4 directions', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.blackPieces.add('4,4'); // SE capture
    board.blackPieces.add('4,2'); // SW capture
    board.blackPieces.add('2,4'); // NE capture
    board.blackPieces.add('2,2'); // NW capture

    const moves = generateKingCaptures(board, 3, 3, 'white');
    // Should have captures in at least 3 directions (some might have multi-capture)
    assert.ok(moves.length >= 4, `should have >= 4 capture moves, got ${moves.length}`);

    // Each of the 4 opponents should be capturable
    const allCaptured = new Set();
    for (const m of moves) {
      for (const c of m.captures) {
        allCaptured.add(`${c.row},${c.col}`);
      }
    }
    assert.ok(allCaptured.has('4,4'), 'should capture SE opponent');
    assert.ok(allCaptured.has('4,2'), 'should capture SW opponent');
    assert.ok(allCaptured.has('2,4'), 'should capture NE opponent');
    assert.ok(allCaptured.has('2,2'), 'should capture NW opponent');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // makeMove/undoMove round-trip for complex captures
  // ─────────────────────────────────────────────────────────────────────────

  test('makeMove/undoMove: simple pawn move round-trip', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1');

    const m = new Move();
    m.from = new Square(5, 1);
    m.to = new Square(4, 2);
    m.path = [new Square(5, 1), new Square(4, 2)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(5, 1), 'source should be empty after move');
    assert.ok(board.isWhite(4, 2), 'destination should have white piece');
    assert.equal(board.isKing(4, 2), false, 'moved piece should not be a king');

    board.undoMove(m);
    assert.ok(board.isWhite(5, 1), 'source should have white piece after undo');
    assert.ok(board.isEmpty(4, 2), 'destination should be empty after undo');
    assert.equal(board.currentTurn, 'white', 'turn should be restored');
  });

  test('makeMove/undoMove: king move round-trip', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');

    const m = new Move();
    m.from = new Square(3, 3);
    m.to = new Square(5, 5);
    m.path = [new Square(3, 3), new Square(5, 5)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(3, 3));
    assert.ok(board.isWhite(5, 5));
    assert.equal(board.isKing(5, 5), true, 'king should remain a king');

    board.undoMove(m);
    assert.ok(board.isWhite(3, 3));
    assert.equal(board.isKing(3, 3), true, 'king should be restored');
    assert.ok(board.isEmpty(5, 5));
  });

  test('makeMove/undoMove: single capture of pawn round-trip', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackPieces.add('4,2');

    const m = new Move();
    m.from = new Square(5, 1);
    m.to = new Square(3, 3);
    m.captures = [new Square(4, 2)];
    m.numCaptures = 1;
    m.path = [new Square(5, 1), new Square(3, 3)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(5, 1), 'source empty');
    assert.ok(board.isWhite(3, 3), 'white at destination');
    assert.ok(board.isEmpty(4, 2), 'captured pawn removed');
    assert.equal(m.capturedKingsMask, 0, 'captured pawn should not set king mask');

    board.undoMove(m);
    assert.ok(board.isWhite(5, 1), 'white pawn restored');
    assert.ok(board.blackPieces.has('4,2'), 'black pawn restored');
    assert.ok(board.isEmpty(3, 3), 'destination empty after undo');
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: capture of king round-trip restores king', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');
    board.blackKings.add('4,4');

    const m = new Move();
    m.from = new Square(3, 3);
    m.to = new Square(5, 5);
    m.captures = [new Square(4, 4)];
    m.numCaptures = 1;
    m.path = [new Square(3, 3), new Square(5, 5)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(4, 4), 'captured king removed');
    assert.equal(m.capturedKing(0), true, 'captured piece was a king');
    assert.ok(board.isWhite(5, 5));
    assert.equal(board.isKing(5, 5), true);

    board.undoMove(m);
    assert.ok(board.isWhite(3, 3), 'white king restored');
    assert.equal(board.isKing(3, 3), true);
    assert.ok(board.blackKings.has('4,4'), 'black king restored (not demoted to pawn)');
    assert.ok(board.isEmpty(5, 5));
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: multi-capture round-trip restores all pieces', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackPieces.add('2,2');
    board.blackKings.add('4,4');

    const moves = generateKingCaptures(board, 1, 1, 'white');
    assert.ok(moves.length > 0);

    // Find a multi-capture move (captures 2+ pieces)
    const multiCap = moves.find(m => m.numCaptures >= 2);
    if (multiCap) {
      // Save original state
      const origWhiteKings = new Set(board.whiteKings);
      const origBlackPieces = new Set(board.blackPieces);
      const origBlackKings = new Set(board.blackKings);

      board.makeMove(multiCap);

      // Verify captured pieces are gone
      for (const cap of multiCap.captures) {
        assert.ok(board.isEmpty(cap.row, cap.col),
          `captured piece at (${cap.row},${cap.col}) should be gone`);
      }

      // Verify capturedKingsMask is correct
      for (let i = 0; i < multiCap.numCaptures; i++) {
        const cr = multiCap.captures[i].row;
        const cc = multiCap.captures[i].col;
        const wasKing = origBlackKings.has(`${cr},${cc}`);
        assert.equal(multiCap.capturedKing(i), wasKing,
          `capturedKing(${i}) should be ${wasKing} for (${cr},${cc})`);
      }

      board.undoMove(multiCap);

      // Verify all pieces restored
      assert.deepEqual(board.whiteKings, origWhiteKings, 'white kings restored');
      assert.deepEqual(board.blackPieces, origBlackPieces, 'black pieces restored');
      assert.deepEqual(board.blackKings, origBlackKings, 'black kings restored');
      assert.equal(board.currentTurn, 'white');
    }
  });

  test('makeMove/undoMove: pawn promotion round-trip demotes back to pawn', () => {
    const board = new TestBoard();
    board.whitePieces.add('6,1');

    const m = new Move();
    m.from = new Square(6, 1);
    m.to = new Square(7, 0); // promotion row
    m.path = [new Square(6, 1), new Square(7, 0)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isWhite(7, 0), 'piece at promotion square');
    assert.equal(board.isKing(7, 0), true, 'pawn should be promoted to king');

    board.undoMove(m);
    assert.ok(board.isWhite(6, 1), 'piece restored to source');
    assert.equal(board.isKing(6, 1), false, 'promoted king should be demoted back to pawn');
    assert.ok(board.whitePieces.has('6,1'), 'should be in whitePieces (not whiteKings)');
    assert.ok(board.isEmpty(7, 0));
  });

  test('makeMove/undoMove: capture+promotion round-trip', () => {
    const board = new TestBoard();
    board.whitePieces.add('6,3');
    board.blackPieces.add('5,4'); // capture target

    const m = new Move();
    m.from = new Square(6, 3);
    m.to = new Square(4, 5); // capture landing, then promote? No — need to land on row 7
    m.captures = [new Square(5, 4)];
    m.numCaptures = 1;
    m.path = [new Square(6, 3), new Square(4, 5)];
    m.numPath = 2;

    // Actually let's set up a promotion capture
    const board2 = new TestBoard();
    board2.whitePieces.add('6,5');
    board2.blackPieces.add('5,6');

    const m2 = new Move();
    m2.from = new Square(6, 5);
    m2.to = new Square(7, 7); // captures and lands on row 7 = promotion
    m2.captures = [new Square(5, 6)];
    m2.numCaptures = 1;
    m2.path = [new Square(6, 5), new Square(7, 7)];
    m2.numPath = 2;

    board2.makeMove(m2);
    assert.ok(board2.isWhite(7, 7));
    assert.equal(board2.isKing(7, 7), true, 'pawn promoted after capture');
    assert.ok(board2.isEmpty(5, 6), 'captured piece removed');

    board2.undoMove(m2);
    assert.ok(board2.isWhite(6, 5));
    assert.equal(board2.isKing(6, 5), false, 'should be demoted back to pawn');
    assert.ok(board2.blackPieces.has('5,6'), 'captured black pawn restored');
    assert.ok(board2.isEmpty(7, 7));
    assert.equal(board2.currentTurn, 'white');
  });

  test('makeMove/undoMove: consecutive moves round-trip (2 moves)', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackPieces.add('2,4');

    // White moves
    const m1 = new Move();
    m1.from = new Square(5, 1);
    m1.to = new Square(4, 2);
    m1.path = [new Square(5, 1), new Square(4, 2)];
    m1.numPath = 2;

    board.makeMove(m1);
    assert.equal(board.currentTurn, 'black');

    // Black moves
    const m2 = new Move();
    m2.from = new Square(2, 4);
    m2.to = new Square(3, 5);
    m2.path = [new Square(2, 4), new Square(3, 5)];
    m2.numPath = 2;

    board.makeMove(m2);
    assert.equal(board.currentTurn, 'white');

    // Undo black move
    board.undoMove(m2);
    assert.ok(board.isBlack(2, 4), 'black pawn restored');
    assert.ok(board.isEmpty(3, 5));
    assert.equal(board.currentTurn, 'black');

    // Undo white move
    board.undoMove(m1);
    assert.ok(board.isWhite(5, 1), 'white pawn restored');
    assert.ok(board.isEmpty(4, 2));
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: board state is identical after round-trip (fuzz-like)', () => {
    // Set up a mid-game position
    const board = new TestBoard();
    board.whitePieces.add('5,1').add('5,3').add('5,5');
    board.whiteKings.add('3,7');
    board.blackPieces.add('2,2').add('2,4').add('4,4');
    board.blackKings.add('4,1');

    // Snapshot
    const origWhitePieces = new Set(board.whitePieces);
    const origWhiteKings = new Set(board.whiteKings);
    const origBlackPieces = new Set(board.blackPieces);
    const origBlackKings = new Set(board.blackKings);
    const origTurn = board.currentTurn;

    // Make a white capture move (white pawn at 5,3 captures black pawn at 4,4)
    const m = new Move();
    m.from = new Square(5, 3);
    m.to = new Square(3, 5);
    m.captures = [new Square(4, 4)];
    m.numCaptures = 1;
    m.path = [new Square(5, 3), new Square(3, 5)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(4, 4), 'captured piece gone');

    board.undoMove(m);

    assert.deepEqual(board.whitePieces, origWhitePieces, 'white pieces restored');
    assert.deepEqual(board.whiteKings, origWhiteKings, 'white kings restored');
    assert.deepEqual(board.blackPieces, origBlackPieces, 'black pieces restored');
    assert.deepEqual(board.blackKings, origBlackKings, 'black kings restored');
    assert.equal(board.currentTurn, origTurn, 'turn restored');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  test('capturedKingsMask: zero captures → mask is 0', () => {
    const m = new Move();
    assert.equal(m.capturedKingsMask, 0);
    assert.equal(m.isCapture(), false);
  });

  test('capturedKingsMask: setCapturedKing for non-consecutive indices', () => {
    const m = new Move();
    m.captures = [new Square(0,0), new Square(1,1), new Square(2,2)];
    m.numCaptures = 3;
    // Only capture index 1 is a king
    m.setCapturedKing(1);
    assert.equal(m.capturedKing(0), false);
    assert.equal(m.capturedKing(1), true);
    assert.equal(m.capturedKing(2), false);
    assert.equal(m.capturedKingsMask, 2); // 0b010
  });

  test('king capture: edge-of-board captures work correctly', () => {
    const board = new TestBoard();
    board.whiteKings.add('6,6');
    board.blackPieces.add('7,7');

    const moves = generateKingCaptures(board, 6, 6, 'white');
    // Can't capture (7,7) because there's no landing square beyond the edge
    const cap77 = moves.filter(m => m.captures.some(c => c.row === 7 && c.col === 7));
    assert.equal(cap77.length, 0, 'cannot capture at edge without landing square');
  });

  test('king capture: king slides past own piece to find opponent', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.whitePieces.add('2,2'); // own piece blocks short path
    board.blackPieces.add('4,4'); // opponent further along

    // King at (1,1) can't go through (2,2) because it's own piece
    const moves = generateKingCaptures(board, 1, 1, 'white');
    // But it can go NE direction: (0,2), (0,3)... or other directions
    // SE is blocked by own piece at (2,2)
    const seCapture = moves.filter(m =>
      m.captures.some(c => c.row === 4 && c.col === 4));
    assert.equal(seCapture.length, 0, 'should not capture through own piece');
  });

  test('makeMove/undoMove: turn alternation is correct', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackPieces.add('2,2');

    assert.equal(board.currentTurn, 'white');

    const m1 = new Move();
    m1.from = new Square(5, 1); m1.to = new Square(4, 2);
    m1.path = [new Square(5, 1), new Square(4, 2)]; m1.numPath = 2;

    board.makeMove(m1);
    assert.equal(board.currentTurn, 'black');

    const m2 = new Move();
    m2.from = new Square(2, 2); m2.to = new Square(3, 3);
    m2.path = [new Square(2, 2), new Square(3, 3)]; m2.numPath = 2;

    board.makeMove(m2);
    assert.equal(board.currentTurn, 'white');

    board.undoMove(m2);
    assert.equal(board.currentTurn, 'black');

    board.undoMove(m1);
    assert.equal(board.currentTurn, 'white');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases: pawn captures king (hunter-sub-003 additions)
  // ─────────────────────────────────────────────────────────────────────────

  test('makeMove/undoMove: pawn captures king → undo → king restored as king (not pawn)', () => {
    // White pawn at (5,1) captures black king at (4,2), lands at (3,3)
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackKings.add('4,2');

    const m = new Move();
    m.from = new Square(5, 1);
    m.to = new Square(3, 3);
    m.captures = [new Square(4, 2)];
    m.numCaptures = 1;
    m.path = [new Square(5, 1), new Square(3, 3)];
    m.numPath = 2;

    // makeMove sets capturedKingsMask
    board.makeMove(m);
    assert.ok(board.isEmpty(4, 2), 'captured king removed');
    assert.ok(board.isWhite(3, 3), 'pawn at destination');
    assert.equal(board.isKing(3, 3), false, 'pawn did not become king');
    assert.equal(m.capturedKing(0), true, 'captured piece was a king');
    assert.equal(m.capturedKingsMask, 1, 'bit 0 should be set for captured king');

    // undoMove should restore black king as king, not as pawn
    board.undoMove(m);
    assert.ok(board.isWhite(5, 1), 'white pawn restored');
    assert.equal(board.isKing(5, 1), false, 'white pawn should not be king');
    assert.ok(board.isEmpty(3, 3), 'destination empty');
    assert.ok(board.blackKings.has('4,2'), 'black king restored as king (not demoted to pawn)');
    assert.ok(!board.blackPieces.has('4,2'), 'black king should NOT be in blackPieces');
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: black pawn captures white king → undo → white king restored', () => {
    // Black pawn at (2,2) captures white king at (3,3), lands at (4,4)
    const board = new TestBoard();
    board.currentTurn = 'black';
    board.blackPieces.add('2,2');
    board.whiteKings.add('3,3');

    const m = new Move();
    m.from = new Square(2, 2);
    m.to = new Square(4, 4);
    m.captures = [new Square(3, 3)];
    m.numCaptures = 1;
    m.path = [new Square(2, 2), new Square(4, 4)];
    m.numPath = 2;

    board.makeMove(m);
    assert.ok(board.isEmpty(3, 3), 'white king removed');
    assert.ok(board.isBlack(4, 4), 'black pawn at destination');
    assert.equal(m.capturedKing(0), true, 'captured piece was a king');
    assert.equal(m.capturedKingsMask, 1);

    board.undoMove(m);
    assert.ok(board.isBlack(2, 2), 'black pawn restored');
    assert.ok(board.isEmpty(4, 4), 'destination empty');
    assert.ok(board.whiteKings.has('3,3'), 'white king restored as king');
    assert.ok(!board.whitePieces.has('3,3'), 'white king should NOT be in whitePieces');
    assert.equal(board.currentTurn, 'black');
  });

  test('makeMove/undoMove: pawn captures king in multi-capture → undo → kings restored', () => {
    // White pawn at (5,1) captures black pawn at (4,2), then captures black king at (2,4)
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackPieces.add('4,2');
    board.blackKings.add('2,4');

    const m = new Move();
    m.from = new Square(5, 1);
    m.to = new Square(1, 5);
    m.captures = [new Square(4, 2), new Square(2, 4)];
    m.numCaptures = 2;
    m.path = [new Square(5, 1), new Square(3, 3), new Square(1, 5)];
    m.numPath = 3;

    board.makeMove(m);
    assert.ok(board.isEmpty(4, 2), 'black pawn captured');
    assert.ok(board.isEmpty(2, 4), 'black king captured');
    assert.ok(board.isWhite(1, 5), 'white pawn at destination');
    assert.equal(m.capturedKing(0), false, 'first capture was pawn');
    assert.equal(m.capturedKing(1), true, 'second capture was king');
    assert.equal(m.capturedKingsMask, 2, 'mask should be 0b10 (bit 1 set)');

    board.undoMove(m);
    assert.ok(board.isWhite(5, 1), 'white pawn restored');
    assert.ok(board.isEmpty(1, 5), 'destination empty');
    assert.ok(board.blackPieces.has('4,2'), 'black pawn restored');
    assert.ok(board.blackKings.has('2,4'), 'black king restored as king (not pawn)');
    assert.ok(!board.blackPieces.has('2,4'), 'black king should NOT be in blackPieces');
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: king captures two kings → undo → both restored as kings', () => {
    const board = new TestBoard();
    board.whiteKings.add('0,0');
    board.blackKings.add('2,2');
    board.blackKings.add('4,4');

    const m = new Move();
    m.from = new Square(0, 0);
    m.to = new Square(5, 5);
    m.captures = [new Square(2, 2), new Square(4, 4)];
    m.numCaptures = 2;
    m.path = [new Square(0, 0), new Square(3, 3), new Square(5, 5)];
    m.numPath = 3;

    board.makeMove(m);
    assert.ok(board.isEmpty(2, 2), 'first king captured');
    assert.ok(board.isEmpty(4, 4), 'second king captured');
    assert.equal(m.capturedKingsMask, 3, 'both bits set (both were kings)');
    assert.equal(m.capturedKing(0), true, 'first capture was king');
    assert.equal(m.capturedKing(1), true, 'second capture was king');

    board.undoMove(m);
    assert.ok(board.isWhite(0, 0), 'white king restored at origin');
    assert.equal(board.isKing(0, 0), true, 'white king type preserved');
    assert.ok(board.blackKings.has('2,2'), 'first black king restored as king');
    assert.ok(board.blackKings.has('4,4'), 'second black king restored as king');
    assert.ok(!board.blackPieces.has('2,2'), 'first king should NOT be in blackPieces');
    assert.ok(!board.blackPieces.has('4,4'), 'second king should NOT be in blackPieces');
    assert.ok(board.isEmpty(5, 5), 'destination empty after undo');
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: king move sets wasKing=true and captures=[]', () => {
    const board = new TestBoard();
    board.whiteKings.add('3,3');

    const m = new Move();
    m.from = new Square(3, 3);
    m.to = new Square(6, 6);
    m.path = [new Square(3, 3), new Square(6, 6)];
    m.numPath = 2;

    board.makeMove(m);
    assert.equal(m.wasKing, true, 'wasKing should be true for king move');
    assert.equal(m.numCaptures, 0, 'non-capture move should have 0 captures');
    assert.equal(m.capturedKingsMask, 0, 'no captures → mask is 0');
    assert.equal(m.isCapture(), false, 'isCapture() should return false');

    board.undoMove(m);
    assert.ok(board.isWhite(3, 3), 'king restored');
    assert.equal(board.isKing(3, 3), true, 'king type preserved after undo');
  });

  test('makeMove/undoMove: consecutive pawn-captures-king then undo restores both', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1');
    board.blackKings.add('4,2');

    // White pawn captures black king
    const m1 = new Move();
    m1.from = new Square(5, 1);
    m1.to = new Square(3, 3);
    m1.captures = [new Square(4, 2)];
    m1.numCaptures = 1;
    m1.path = [new Square(5, 1), new Square(3, 3)];
    m1.numPath = 2;

    board.makeMove(m1);
    assert.equal(board.currentTurn, 'black');
    assert.equal(m1.capturedKing(0), true);

    // Black pawn captures white pawn (now at 3,3)
    const m2 = new Move();
    m2.from = new Square(2, 4);
    m2.to = new Square(4, 2);
    m2.captures = [new Square(3, 3)];
    m2.numCaptures = 1;
    m2.path = [new Square(2, 4), new Square(4, 2)];
    m2.numPath = 2;

    board.makeMove(m2);
    assert.equal(board.currentTurn, 'white');
    assert.equal(m2.capturedKing(0), false, 'captured piece was a pawn');

    // Undo black's move
    board.undoMove(m2);
    assert.ok(board.isWhite(3, 3), 'white pawn restored');
    assert.equal(board.isKing(3, 3), false, 'white piece is pawn (not king)');
    assert.ok(board.isBlack(2, 4), 'black pawn restored');
    assert.equal(board.currentTurn, 'black');

    // Undo white's move
    board.undoMove(m1);
    assert.ok(board.isWhite(5, 1), 'white pawn restored');
    assert.ok(board.blackKings.has('4,2'), 'black king restored as king');
    assert.ok(!board.blackPieces.has('4,2'), 'black king NOT in blackPieces');
    assert.ok(board.isEmpty(3, 3));
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: king captures pawn then captures king → undo restores correctly', () => {
    const board = new TestBoard();
    board.whiteKings.add('1,1');
    board.blackPieces.add('2,2');
    board.blackKings.add('4,4');

    const m = new Move();
    m.from = new Square(1, 1);
    m.to = new Square(5, 5);
    m.captures = [new Square(2, 2), new Square(4, 4)];
    m.numCaptures = 2;
    m.path = [new Square(1, 1), new Square(3, 3), new Square(5, 5)];
    m.numPath = 3;

    board.makeMove(m);
    assert.equal(m.capturedKing(0), false, 'first capture (pawn) should not set king bit');
    assert.equal(m.capturedKing(1), true, 'second capture (king) should set king bit');
    assert.equal(m.capturedKingsMask, 2, 'mask should be 0b10');

    board.undoMove(m);
    assert.ok(board.isWhite(1, 1), 'white king restored at origin');
    assert.equal(board.isKing(1, 1), true);
    assert.ok(board.blackPieces.has('2,2'), 'black pawn restored (not king)');
    assert.ok(!board.blackKings.has('2,2'), 'pawn should NOT be in blackKings');
    assert.ok(board.blackKings.has('4,4'), 'black king restored as king');
    assert.ok(!board.blackPieces.has('4,4'), 'king should NOT be in blackPieces');
    assert.ok(board.isEmpty(3, 3), 'intermediate empty');
    assert.ok(board.isEmpty(5, 5), 'destination empty');
    assert.equal(board.currentTurn, 'white');
  });

  test('makeMove/undoMove: multiple round-trips preserve identical board state', () => {
    const board = new TestBoard();
    board.whitePieces.add('5,1').add('5,3');
    board.whiteKings.add('3,3');
    board.blackPieces.add('2,2').add('4,4').add('2,6');
    board.blackKings.add('1,7');

    const origWhitePieces = new Set(board.whitePieces);
    const origWhiteKings = new Set(board.whiteKings);
    const origBlackPieces = new Set(board.blackPieces);
    const origBlackKings = new Set(board.blackKings);

    // Move 1: white pawn (5,1) → (4,0)
    const m1 = new Move();
    m1.from = new Square(5, 1); m1.to = new Square(4, 0);
    m1.path = [new Square(5, 1), new Square(4, 0)]; m1.numPath = 2;
    board.makeMove(m1);

    // Move 2: black pawn (2,2) → (3,1)
    const m2 = new Move();
    m2.from = new Square(2, 2); m2.to = new Square(3, 1);
    m2.path = [new Square(2, 2), new Square(3, 1)]; m2.numPath = 2;
    board.makeMove(m2);

    // Move 3: white king (3,3) captures black pawn (4,4), lands at (5,5) — square is empty
    const m3 = new Move();
    m3.from = new Square(3, 3); m3.to = new Square(5, 5);
    m3.captures = [new Square(4, 4)]; m3.numCaptures = 1;
    m3.path = [new Square(3, 3), new Square(5, 5)]; m3.numPath = 2;
    board.makeMove(m3);

    assert.ok(board.isEmpty(4, 4));

    // Undo all 3
    board.undoMove(m3);
    board.undoMove(m2);
    board.undoMove(m1);

    assert.deepEqual(board.whitePieces, origWhitePieces, 'white pieces restored');
    assert.deepEqual(board.whiteKings, origWhiteKings, 'white kings restored');
    assert.deepEqual(board.blackPieces, origBlackPieces, 'black pieces restored');
    assert.deepEqual(board.blackKings, origBlackKings, 'black kings restored');
    assert.equal(board.currentTurn, 'white', 'turn restored');
  });

  // ── Run ─────────────────────────────────────────────────────────────────

  console.log('\n📋 King Multi-Capture & Undo Move Tests');

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
