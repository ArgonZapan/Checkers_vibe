/**
 * boardLogicExtended.test.js — Extended board logic tests for Checkers game rules.
 *
 * Covers gaps NOT in existing tests (kingMovesPath, drawDetection, etc.):
 * - Pawn promotion to king (row 7 for white, row 0 for black)
 * - Mandatory capture rule enforcement
 * - Game over detection (no legal moves = loss)
 * - Piece counting and board state analysis
 * - Multi-capture path validation
 * - King vs pawn movement differences
 * - Edge cases: corner pieces, double promotion, board full
 *
 * Extracted logic — no server or engine required.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// Board representation helpers (mirrors C++ encoding)
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY = 0, WHITE_PAWN = 1, WHITE_KING = 2, BLACK_PAWN = 3, BLACK_KING = 4;

function createEmptyBoard() {
  return new Array(64).fill(0);
}

function setPiece(board, row, col, val) {
  board[row * 8 + col] = val;
  return board;
}

function getPiece(board, row, col) {
  return board[row * 8 + col];
}

function createBoardFromTemplate(rows) {
  const board = createEmptyBoard();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (rows[r] && rows[r][c]) {
        board[r * 8 + c] = rows[r][c];
      }
    }
  }
  return board;
}

// ═══════════════════════════════════════════════════════════════════════════
// Simplified legal move generator (mirrors C++ engine movegen)
// ═══════════════════════════════════════════════════════════════════════════

const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function isOwnPiece(val, turn) {
  if (turn === 1) return val === WHITE_PAWN || val === WHITE_KING;
  return val === BLACK_PAWN || val === BLACK_KING;
}

function isOppPiece(val, turn) {
  if (turn === 1) return val === BLACK_PAWN || val === BLACK_KING;
  return val === WHITE_PAWN || val === WHITE_KING;
}

function isKing(val) {
  return val === WHITE_KING || val === BLACK_KING;
}

/**
 * Generate legal moves for a given board and turn.
 * Returns { captures: Move[], nonCaptures: Move[] }.
 * Mandatory capture: if captures exist, only captures are legal.
 */
function generateLegalMoves(board, turn) {
  const captures = [];
  const nonCaptures = [];

  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (!isOwnPiece(val, turn)) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const pieceIsKing = isKing(val);

    for (const [dr, dc] of DIAGONALS) {
      // Pawns: white moves +row (dr=+1), black moves -row (dr=-1)
      if (!pieceIsKing) {
        if (turn === 1 && dr < 0) continue; // white pawns only move down
        if (turn === -1 && dr > 0) continue; // black pawns only move up
      }

      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) continue;

      if (board[nr * 8 + nc] === EMPTY) {
        nonCaptures.push({ from: [row, col], to: [nr, nc], captures: [] });
      } else if (isOppPiece(board[nr * 8 + nc], turn)) {
        // Check landing square
        const lr = nr + dr;
        const lc = nc + dc;
        if (inBounds(lr, lc) && board[lr * 8 + lc] === EMPTY) {
          captures.push({
            from: [row, col],
            to: [lr, lc],
            captures: [[nr, nc]],
          });
        }
      }
    }
  }

  return { captures, nonCaptures };
}

/**
 * Get all legal moves considering mandatory capture rule.
 */
function getLegalMoves(board, turn) {
  const { captures, nonCaptures } = generateLegalMoves(board, turn);
  // Mandatory capture: if any capture exists, only captures are legal
  if (captures.length > 0) return captures;
  return nonCaptures;
}

/**
 * Apply a move to the board. Returns new board state.
 * Handles promotion: white pawn on row 7 → king, black pawn on row 0 → king.
 */
function applyMove(board, move) {
  const newBoard = [...board];
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = getPiece(newBoard, fr, fc);

  // Remove piece from origin
  newBoard[fr * 8 + fc] = EMPTY;

  // Remove captured pieces
  if (move.captures) {
    for (const [cr, cc] of move.captures) {
      newBoard[cr * 8 + cc] = EMPTY;
    }
  }

  // Promotion check
  let promoted = piece;
  if (piece === WHITE_PAWN && tr === 7) {
    promoted = WHITE_KING;
  } else if (piece === BLACK_PAWN && tr === 0) {
    promoted = BLACK_KING;
  }

  // Place piece at destination
  newBoard[tr * 8 + tc] = promoted;

  return { board: newBoard, promoted: promoted !== piece };
}

/**
 * Check game over: no legal moves = current player loses.
 */
function checkGameOver(board, turn) {
  const moves = getLegalMoves(board, turn);
  if (moves.length === 0) {
    return { gameOver: true, winner: turn === 1 ? 'black' : 'white' };
  }
  return { gameOver: false, winner: null };
}

/**
 * Count pieces on the board.
 */
function countPieces(board) {
  let whitePawns = 0, whiteKings = 0, blackPawns = 0, blackKings = 0;
  for (const val of board) {
    if (val === WHITE_PAWN) whitePawns++;
    else if (val === WHITE_KING) whiteKings++;
    else if (val === BLACK_PAWN) blackPawns++;
    else if (val === BLACK_KING) blackKings++;
  }
  return { whitePawns, whiteKings, blackPawns, blackKings, total: whitePawns + whiteKings + blackPawns + blackKings };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

export async function runBoardLogicExtendedTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  PAWN PROMOTION                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('white pawn promotes to king on row 7', () => {
    const board = createEmptyBoard();
    setPiece(board, 6, 1, WHITE_PAWN);
    setPiece(board, 7, 2, EMPTY);

    const move = { from: [6, 1], to: [7, 2], captures: [] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, true, 'Should trigger promotion');
    assert.equal(getPiece(result.board, 7, 2), WHITE_KING, 'Should be white king');
    assert.equal(getPiece(result.board, 6, 1), EMPTY, 'Origin should be empty');
  });

  test('black pawn promotes to king on row 0', () => {
    const board = createEmptyBoard();
    setPiece(board, 1, 3, BLACK_PAWN);
    setPiece(board, 0, 2, EMPTY);

    const move = { from: [1, 3], to: [0, 2], captures: [] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, true, 'Should trigger promotion');
    assert.equal(getPiece(result.board, 0, 2), BLACK_KING, 'Should be black king');
  });

  test('pawn does NOT promote on row 6 (white)', () => {
    const board = createEmptyBoard();
    setPiece(board, 5, 1, WHITE_PAWN);

    const move = { from: [5, 1], to: [6, 2], captures: [] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, false, 'Should NOT promote on row 6');
    assert.equal(getPiece(result.board, 6, 2), WHITE_PAWN, 'Should stay pawn');
  });

  test('pawn does NOT promote on row 1 (black)', () => {
    const board = createEmptyBoard();
    setPiece(board, 2, 3, BLACK_PAWN);

    const move = { from: [2, 3], to: [1, 2], captures: [] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, false, 'Should NOT promote on row 1');
    assert.equal(getPiece(result.board, 1, 2), BLACK_PAWN, 'Should stay pawn');
  });

  test('white pawn promotes during capture move to row 7', () => {
    const board = createEmptyBoard();
    setPiece(board, 6, 5, WHITE_PAWN);
    setPiece(board, 7, 6, BLACK_PAWN);

    const move = { from: [6, 5], to: [7, 6], captures: [[7, 6]] };
    // Landing square is row 7 — but wait, the capture lands BEYOND the piece
    // Actually: from [6,5], captures [7,6], lands at [8,7] — out of bounds!
    // Let's fix: pawn at row 5, captures at row 6, lands at row 7
    const board2 = createEmptyBoard();
    setPiece(board2, 5, 3, WHITE_PAWN);
    setPiece(board2, 6, 4, BLACK_PAWN);

    const move2 = { from: [5, 3], to: [7, 5], captures: [[6, 4]] };
    const result = applyMove(board2, move2);

    assert.equal(result.promoted, true, 'Capture landing on row 7 should promote');
    assert.equal(getPiece(result.board, 7, 5), WHITE_KING, 'Should be promoted to king');
    assert.equal(getPiece(result.board, 6, 4), EMPTY, 'Captured piece removed');
  });

  test('king does NOT re-promote (king stays king)', () => {
    const board = createEmptyBoard();
    setPiece(board, 6, 1, WHITE_KING);

    const move = { from: [6, 1], to: [7, 2], captures: [] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, false, 'King should not "promote" again');
    assert.equal(getPiece(result.board, 7, 2), WHITE_KING, 'Should still be king');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  MANDATORY CAPTURE RULE                                             ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('mandatory capture: when captures exist, non-captures are filtered out', () => {
    // White pawn at [4,1], can move to [5,0] (non-capture) or capture black at [5,2] landing [6,3]
    const board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);
    setPiece(board, 5, 2, BLACK_PAWN);

    const legal = getLegalMoves(board, 1);
    assert.ok(legal.length > 0, 'Should have legal moves');
    for (const m of legal) {
      assert.ok(m.captures.length > 0, 'All legal moves must be captures (mandatory capture)');
    }
  });

  test('mandatory capture: multiple captures available, all must be captures', () => {
    // Two white pawns, each can capture
    const board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);
    setPiece(board, 5, 2, BLACK_PAWN);
    setPiece(board, 4, 5, WHITE_PAWN);
    setPiece(board, 5, 6, BLACK_PAWN);

    const legal = getLegalMoves(board, 1);
    assert.ok(legal.length >= 2, 'Should have at least 2 capture moves');
    for (const m of legal) {
      assert.ok(m.captures.length > 0, 'All must be captures');
    }
  });

  test('mandatory capture: no captures available → non-captures are legal', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);

    const legal = getLegalMoves(board, 1);
    assert.ok(legal.length > 0, 'Should have moves');
    for (const m of legal) {
      assert.equal(m.captures.length, 0, 'All moves should be non-captures');
    }
  });

  test('mandatory capture: only one pawn has capture → that pawn must capture', () => {
    // Pawn at [4,1] can capture. Pawn at [3,3] can only move non-capture.
    // Only the capture should be legal.
    const board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);
    setPiece(board, 5, 2, BLACK_PAWN);
    setPiece(board, 3, 3, WHITE_PAWN); // can move to [4,2] or [4,4] but no capture

    const legal = getLegalMoves(board, 1);
    assert.ok(legal.length > 0);
    // All legal moves must be captures
    for (const m of legal) {
      assert.ok(m.captures.length > 0, 'Mandatory capture forces capture-only moves');
    }
    // The capture should come from [4,1]
    const captureFrom41 = legal.find(m => m.from[0] === 4 && m.from[1] === 1);
    assert.ok(captureFrom41, 'The capturing pawn should have legal moves');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  GAME OVER DETECTION                                                ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('game over: white has no pieces left → black wins', () => {
    // No white pieces on board
    const board = createEmptyBoard();
    setPiece(board, 0, 0, BLACK_PAWN);

    // White's turn but no white pieces → no legal moves → black wins
    const result = checkGameOver(board, 1);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'black');
  });

  test('game over: black has no pieces left → white wins', () => {
    const board = createEmptyBoard();
    setPiece(board, 7, 7, WHITE_PAWN);

    const result = checkGameOver(board, -1);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'white');
  });

  test('game over: white pawn blocked completely → black wins', () => {
    // Single white pawn at [6,0], only forward diagonal is [7,1]
    // Block [7,1] with own piece
    const board = createEmptyBoard();
    setPiece(board, 6, 0, WHITE_PAWN);
    setPiece(board, 7, 1, WHITE_PAWN); // blocks the only forward square

    const result = checkGameOver(board, 1);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'black');
  });

  test('game over: black pawn blocked → white wins', () => {
    // Single black pawn at [1,0], only forward diagonal is [0,1]
    // Block [0,1] with own piece
    const board = createEmptyBoard();
    setPiece(board, 1, 0, BLACK_PAWN);
    setPiece(board, 0, 1, BLACK_PAWN); // blocks the only forward square

    const result = checkGameOver(board, -1);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, 'white');
  });

  test('game NOT over when pieces can move', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_PAWN);
    setPiece(board, 3, 3, BLACK_PAWN);

    const result = checkGameOver(board, 1);
    assert.equal(result.gameOver, false);
    assert.equal(result.winner, null);
  });

  test('game over: only kings remain but one is trapped in corner', () => {
    // Black king at [0,0], white king at [7,7]
    // Both can move — game is NOT over (kings slide)
    const board = createEmptyBoard();
    setPiece(board, 0, 0, BLACK_KING);
    setPiece(board, 7, 7, WHITE_KING);

    const resultWhite = checkGameOver(board, 1);
    assert.equal(resultWhite.gameOver, false, 'White king can move');

    const resultBlack = checkGameOver(board, -1);
    assert.equal(resultBlack.gameOver, false, 'Black king can move');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  PIECE COUNTING                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('countPieces: empty board → all zeros', () => {
    const board = createEmptyBoard();
    const c = countPieces(board);
    assert.deepEqual(c, { whitePawns: 0, whiteKings: 0, blackPawns: 0, blackKings: 0, total: 0 });
  });

  test('countPieces: standard starting position (12 each side)', () => {
    const board = createEmptyBoard();
    // White pawns: rows 0-2 on dark squares
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) setPiece(board, r, c, WHITE_PAWN);
      }
    }
    // Black pawns: rows 5-7 on dark squares
    for (let r = 5; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) setPiece(board, r, c, BLACK_PAWN);
      }
    }

    const c = countPieces(board);
    assert.equal(c.whitePawns, 12);
    assert.equal(c.blackPawns, 12);
    assert.equal(c.whiteKings, 0);
    assert.equal(c.blackKings, 0);
    assert.equal(c.total, 24);
  });

  test('countPieces: after captures, piece count decreases', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);
    setPiece(board, 5, 2, BLACK_PAWN);

    const move = { from: [4, 1], to: [6, 3], captures: [[5, 2]] };
    const result = applyMove(board, move);

    const cBefore = countPieces(board);
    const cAfter = countPieces(result.board);
    assert.equal(cBefore.blackPawns, 1);
    assert.equal(cAfter.blackPawns, 0, 'Black pawn captured');
    assert.equal(cAfter.total, cBefore.total - 1);
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  KING vs PAWN MOVEMENT DIFFERENCES                                  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('white pawn can only move forward (+row direction)', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_PAWN);

    const moves = getLegalMoves(board, 1);
    for (const m of moves) {
      assert.equal(m.from[0], 4);
      assert.equal(m.to[0], 5, 'White pawn must move to higher row (forward)');
      assert.ok([2, 4].includes(m.to[1]), 'Must move diagonally');
    }
  });

  test('black pawn can only move forward (-row direction)', () => {
    const board = createEmptyBoard();
    setPiece(board, 3, 3, BLACK_PAWN);

    const moves = getLegalMoves(board, -1);
    for (const m of moves) {
      assert.equal(m.from[0], 3);
      assert.equal(m.to[0], 2, 'Black pawn must move to lower row (forward)');
      assert.ok([2, 4].includes(m.to[1]), 'Must move diagonally');
    }
  });

  test('king can move in all 4 diagonal directions', () => {
    // White king at center of board, plenty of room
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_KING);

    const { nonCaptures } = generateLegalMoves(board, 1);
    const directions = new Set();
    for (const m of nonCaptures) {
      const dr = Math.sign(m.to[0] - m.from[0]);
      const dc = Math.sign(m.to[1] - m.from[1]);
      directions.add(`${dr},${dc}`);
    }
    assert.equal(directions.size, 4, 'King should move in all 4 diagonal directions');
  });

  test('king can move backward (white king to lower rows)', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_KING);

    const moves = getLegalMoves(board, 1);
    const hasBackwardMove = moves.some(m => m.to[0] < m.from[0]);
    assert.ok(hasBackwardMove, 'White king should be able to move backward');
  });

  test('pawn CANNOT move backward', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_PAWN);

    const moves = getLegalMoves(board, 1);
    const hasBackwardMove = moves.some(m => m.to[0] < m.from[0]);
    assert.ok(!hasBackwardMove, 'White pawn should NOT move backward');
  });

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  EDGE CASES                                                         ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  test('corner pawn: white pawn at [0,1] can only move to [1,0] or [1,2]', () => {
    const board = createEmptyBoard();
    setPiece(board, 0, 1, WHITE_PAWN);

    const moves = getLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'Should have at least one move');
    for (const m of moves) {
      assert.equal(m.to[0], 1);
      assert.ok([0, 2].includes(m.to[1]));
    }
  });

  test('edge king: king at [0,7] has exactly one move (single-step movegen)', () => {
    const board = createEmptyBoard();
    setPiece(board, 0, 7, WHITE_KING);

    const moves = getLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'Edge king should have at least one move');
    // Single-step movegen: only [1,6] is reachable (SW diagonal)
    assert.equal(moves.length, 1, 'Corner king has 1 single-step move');
    assert.deepEqual(moves[0].to, [1, 6]);
  });

  test('capture sequence: pawn captures and promotes in one move', () => {
    // White pawn at row 5, captures black at row 6, lands at row 7 → promotes
    const board = createEmptyBoard();
    setPiece(board, 5, 1, WHITE_PAWN);
    setPiece(board, 6, 2, BLACK_PAWN);
    setPiece(board, 7, 3, EMPTY);

    const move = { from: [5, 1], to: [7, 3], captures: [[6, 2]] };
    const result = applyMove(board, move);

    assert.equal(result.promoted, true, 'Should promote after capture');
    assert.equal(getPiece(result.board, 7, 3), WHITE_KING);
    assert.equal(getPiece(result.board, 6, 2), EMPTY, 'Captured piece removed');
    assert.equal(getPiece(result.board, 5, 1), EMPTY, 'Origin cleared');
  });

  test('applyMove: board immutability — original board not modified', () => {
    const board = createEmptyBoard();
    setPiece(board, 4, 3, WHITE_PAWN);
    const originalVal = getPiece(board, 4, 3);

    const move = { from: [4, 3], to: [5, 4], captures: [] };
    const result = applyMove(board, move);

    assert.equal(getPiece(board, 4, 3), originalVal, 'Original board should not change');
    assert.notEqual(result.board, board, 'Should return new array');
  });

  test('multiple captures in sequence: piece count drops correctly', () => {
    let board = createEmptyBoard();
    setPiece(board, 4, 1, WHITE_PAWN);
    setPiece(board, 5, 2, BLACK_PAWN);
    setPiece(board, 3, 4, BLACK_PAWN);

    const c1 = countPieces(board);

    // First capture
    const move1 = { from: [4, 1], to: [6, 3], captures: [[5, 2]] };
    const r1 = applyMove(board, move1);
    const c2 = countPieces(r1.board);
    assert.equal(c2.blackPawns, c1.blackPawns - 1);

    // Set up second capture from black's perspective
    setPiece(r1.board, 6, 3, WHITE_PAWN); // make sure piece is there
    setPiece(r1.board, 5, 4, BLACK_PAWN); // black can capture
    const move2 = { from: [5, 4], to: [7, 2], captures: [[6, 3]] };
    const r2 = applyMove(r1.board, move2);
    const c3 = countPieces(r2.board);
    assert.equal(c3.whitePawns, c2.whitePawns - 1, 'White piece captured');
  });

  test('getLegalMoves: returns empty array when no pieces of that color', () => {
    const board = createEmptyBoard();
    setPiece(board, 0, 0, BLACK_PAWN);

    const moves = getLegalMoves(board, 1); // white's turn, no white pieces
    assert.equal(moves.length, 0);
  });

  test('applyMove: non-capture move preserves captured array', () => {
    const board = createEmptyBoard();
    setPiece(board, 3, 3, WHITE_PAWN);

    const move = { from: [3, 3], to: [4, 4], captures: [] };
    const result = applyMove(board, move);

    assert.equal(getPiece(result.board, 4, 4), WHITE_PAWN);
    assert.equal(getPiece(result.board, 3, 3), EMPTY);
  });

  // ── Run ─────────────────────────────────────────────────────────────

  console.log('\n📋 Board Logic Extended Tests');

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
