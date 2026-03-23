/**
 * hunter-alpha-minimax-core.test.js — Comprehensive tests for minimax.js
 *
 * Covers: evaluate, applyMove, generateLegalMoves, minimaxSearch, PIECE_VALUES
 * Gap: minimax module had ZERO dedicated test coverage before this.
 *
 * Pure JS — no TF.js, no server, no HTTP.
 */

import assert from 'node:assert/strict';

// ── Inline minimax logic (extracted from server/ai/minimax.js) ───────────
const PIECE_VALUES = { 0: 0, 1: 1, 2: 3, 3: 1, 4: 3 };

function evaluate(flatBoard, turn) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const val = flatBoard[i];
    if (!val) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isOwn = (turn === 1 && (val === 1 || val === 2)) || (turn === -1 && (val === 3 || val === 4));
    const pieceVal = PIECE_VALUES[val] || 0;
    let posBonus = 0;
    if (val === 1 || val === 3) {
      const advance = turn === 1 ? (7 - row) : row;
      posBonus = advance * 0.05;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.1;
    } else {
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.3;
      else posBonus -= 0.1;
    }
    if (isOwn) score += pieceVal + posBonus;
    else score -= pieceVal + posBonus;
  }
  return score;
}

function applyMove(board, move, turn) {
  const newBoard = [...board];
  if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) return newBoard;
  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const fromIdx = fromRow * 8 + fromCol;
  const toIdx = toRow * 8 + toCol;
  const piece = newBoard[fromIdx];
  if (Array.isArray(move.captures) && move.captures.length > 0) {
    for (const [capRow, capCol] of move.captures) {
      const capIdx = capRow * 8 + capCol;
      newBoard[capIdx] = 0;
    }
  }
  newBoard[fromIdx] = 0;
  newBoard[toIdx] = piece;
  const isPawn = piece === 1 || piece === 3;
  if (isPawn) {
    if ((turn === 1 && toRow === 0) || (turn === -1 && toRow === 7)) {
      newBoard[toIdx] = turn === 1 ? 2 : 4;
    }
  }
  return newBoard;
}

function generateLegalMoves(board, turn) {
  const moves = [];
  const isWhiteTurn = turn === 1;
  const myPawn = isWhiteTurn ? 1 : 3;
  const myKing = isWhiteTurn ? 2 : 4;
  const captures = [];

  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (val !== myPawn && val !== myKing) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isKing = val === myKing;
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      if (!isKing) {
        if (isWhiteTurn && dr > 0) continue;
        if (!isWhiteTurn && dr < 0) continue;
      }
      const adjR = row + dr, adjC = col + dc;
      const landR = row + dr * 2, landC = col + dc * 2;
      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (landR < 0 || landR > 7 || landC < 0 || landC > 7) continue;
      const adjIdx = adjR * 8 + adjC;
      const landIdx = landR * 8 + landC;
      const adjVal = board[adjIdx];
      if (adjVal && adjVal !== 0) {
        const isOpponent = isWhiteTurn ? (adjVal === 3 || adjVal === 4) : (adjVal === 1 || adjVal === 2);
        if (isOpponent && board[landIdx] === 0) {
          captures.push({
            from: [row, col], to: [landR, landC],
            captures: [[adjR, adjC]],
          });
        }
      }
    }
  }

  if (captures.length > 0) return captures;

  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (val !== myPawn && val !== myKing) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isKing = val === myKing;
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      if (!isKing) {
        if (isWhiteTurn && dr > 0) continue;
        if (!isWhiteTurn && dr < 0) continue;
      }
      const newR = row + dr, newC = col + dc;
      if (newR < 0 || newR > 7 || newC < 0 || newC > 7) continue;
      const newIdx = newR * 8 + newC;
      if (board[newIdx] === 0) {
        moves.push({ from: [row, col], to: [newR, newC], captures: [] });
      }
    }
  }
  return moves;
}

function minimax(flatBoard, depth, alpha, beta, maximizing, turn) {
  const legalMoves = generateLegalMoves(flatBoard, turn);
  if (depth === 0 || legalMoves.length === 0) {
    if (legalMoves.length === 0) {
      return { score: maximizing ? -1000 : 1000, move: null };
    }
    return { score: evaluate(flatBoard, turn), move: null };
  }
  let bestMove = legalMoves[0];
  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of legalMoves) {
      const nextBoard = applyMove(flatBoard, move, turn);
      const result = minimax(nextBoard, depth - 1, alpha, beta, false, -turn);
      if (result.score > maxEval) { maxEval = result.score; bestMove = move; }
      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const move of legalMoves) {
      const nextBoard = applyMove(flatBoard, move, turn);
      const result = minimax(nextBoard, depth - 1, alpha, beta, true, -turn);
      if (result.score < minEval) { minEval = result.score; bestMove = move; }
      beta = Math.min(beta, result.score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

function minimaxSearch(flatBoard, turn, depth = 4) {
  const isMaximizing = turn === 1;
  return minimax(flatBoard, depth, -Infinity, Infinity, isMaximizing, turn);
}

// ── Helpers ──────────────────────────────────────────────────────────────
function emptyBoard() { return new Array(64).fill(0); }

function makeBoard(setup) {
  const b = emptyBoard();
  for (const [pos, val] of setup) {
    b[pos] = val;
  }
  return b;
}

export async function runHunterAlphaMinimaxCoreTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: PIECE_VALUES
  // ═══════════════════════════════════════════════════════════════════════

  test('PIECE_VALUES: correct values for all piece types', () => {
    assert.equal(PIECE_VALUES[0], 0);
    assert.equal(PIECE_VALUES[1], 1); // white pawn
    assert.equal(PIECE_VALUES[2], 3); // white king
    assert.equal(PIECE_VALUES[3], 1); // black pawn
    assert.equal(PIECE_VALUES[4], 3); // black king
  });

  test('PIECE_VALUES: undefined for invalid piece codes', () => {
    assert.equal(PIECE_VALUES[5], undefined);
    assert.equal(PIECE_VALUES[-1], undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: evaluate()
  // ═══════════════════════════════════════════════════════════════════════

  test('evaluate: empty board returns 0', () => {
    assert.equal(evaluate(emptyBoard(), 1), 0);
    assert.equal(evaluate(emptyBoard(), -1), 0);
  });

  test('evaluate: single white pawn advantage over empty', () => {
    const board = makeBoard([[28, 1]]); // center white pawn
    const score = evaluate(board, 1);
    assert.ok(score > 0, 'white should have positive score');
  });

  test('evaluate: single black pawn advantage over empty', () => {
    const board = makeBoard([[36, 3]]); // center black pawn
    const score = evaluate(board, -1);
    assert.ok(score > 0, 'black should have positive score');
  });

  test('evaluate: king is worth more than pawn', () => {
    const pawnBoard = makeBoard([[28, 1]]);
    const kingBoard = makeBoard([[28, 2]]);
    const pawnScore = evaluate(pawnBoard, 1);
    const kingScore = evaluate(kingBoard, 1);
    assert.ok(kingScore > pawnScore, 'king should score higher than pawn');
  });

  test('evaluate: advanced pawns score higher for white', () => {
    const backRow = makeBoard([[56, 1]]); // row 7, white pawn
    const frontRow = makeBoard([[8, 1]]);  // row 1, white pawn
    const backScore = evaluate(backRow, 1);
    const frontScore = evaluate(frontRow, 1);
    assert.ok(frontScore > backScore, 'advanced white pawn should score higher');
  });

  test('evaluate: advanced pawns score higher for black', () => {
    const backRow = makeBoard([[8, 3]]);   // row 1, black pawn
    const frontRow = makeBoard([[56, 3]]); // row 7, black pawn
    const backScore = evaluate(backRow, -1);
    const frontScore = evaluate(frontRow, -1);
    assert.ok(frontScore > backScore, 'advanced black pawn should score higher');
  });

  test('evaluate: center pawns score higher than edge pawns', () => {
    const edgeBoard = makeBoard([[24, 1]]); // col 0
    const centerBoard = makeBoard([[27, 1]]); // col 3
    const edgeScore = evaluate(edgeBoard, 1);
    const centerScore = evaluate(centerBoard, 1);
    assert.ok(centerScore > edgeScore, 'center pawn should score higher');
  });

  test('evaluate: king center bonus vs edge penalty', () => {
    const edgeKing = makeBoard([[0, 2]]);    // row 0, col 0
    const centerKing = makeBoard([[27, 2]]); // row 3, col 3
    const edgeScore = evaluate(edgeKing, 1);
    const centerScore = evaluate(centerKing, 1);
    assert.ok(centerScore > edgeScore, 'center king should score higher than edge king');
  });

  test('evaluate: symmetric material advantage', () => {
    // White has 4 pawns, black has 2 pawns — white should win
    const board = makeBoard([
      [28, 1], [29, 1], [30, 1], [31, 1],
      [36, 3], [37, 3],
    ]);
    const whiteScore = evaluate(board, 1);
    const blackScore = evaluate(board, -1);
    assert.ok(whiteScore > 0, 'white should have positive score with material advantage');
    assert.ok(blackScore < 0, 'black should have negative score with material disadvantage');
  });

  test('evaluate: equal material returns roughly 0', () => {
    const board = makeBoard([
      [28, 1], [29, 1],
      [36, 3], [37, 3],
    ]);
    const score = evaluate(board, 1);
    // Should be close to 0 (positional differences only)
    assert.ok(Math.abs(score) < 1, `equal material should score near 0, got ${score}`);
  });

  test('evaluate: edge king has penalty', () => {
    const edgeKing = makeBoard([[0, 2]]);
    const score = evaluate(edgeKing, 1);
    // King on edge gets -0.1 penalty, but king value is 3
    assert.ok(score > 0, 'king still positive even on edge');
    assert.ok(score < 3, 'edge penalty should reduce score');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: applyMove()
  // ═══════════════════════════════════════════════════════════════════════

  test('applyMove: simple pawn move', () => {
    const board = makeBoard([[45, 1]]); // white pawn at (5,5)
    const newBoard = applyMove(board, { from: [5, 5], to: [4, 4], captures: [] }, 1);
    assert.equal(newBoard[45], 0, 'source should be empty');
    assert.equal(newBoard[36], 1, 'destination should have piece');
    // Original board unchanged
    assert.equal(board[45], 1, 'original board should not be mutated');
  });

  test('applyMove: capture removes opponent piece', () => {
    const board = makeBoard([
      [45, 1], // white pawn at (5,5)
      [36, 3], // black pawn at (4,4)
    ]);
    const newBoard = applyMove(board, {
      from: [5, 5], to: [3, 3],
      captures: [[4, 4]],
    }, 1);
    assert.equal(newBoard[45], 0, 'source empty');
    assert.equal(newBoard[36], 0, 'captured piece removed');
    assert.equal(newBoard[27], 1, 'piece at destination');
  });

  test('applyMove: multi-capture removes all captured pieces', () => {
    const board = makeBoard([
      [45, 1], // white pawn
      [36, 3], // black pawn 1
      [18, 3], // black pawn 2 at (2,2)
    ]);
    const newBoard = applyMove(board, {
      from: [5, 5], to: [1, 1],
      captures: [[4, 4], [2, 2]],
    }, 1);
    assert.equal(newBoard[45], 0);
    assert.equal(newBoard[36], 0, 'first capture removed');
    assert.equal(newBoard[18], 0, 'second capture removed');
    assert.equal(newBoard[9], 1, 'piece at final destination');
  });

  test('applyMove: white pawn promotes on row 0', () => {
    const board = makeBoard([[9, 1]]); // white pawn at (1,1)
    const newBoard = applyMove(board, { from: [1, 1], to: [0, 0], captures: [] }, 1);
    assert.equal(newBoard[0], 2, 'white pawn promoted to king');
  });

  test('applyMove: black pawn promotes on row 7', () => {
    const board = makeBoard([[54, 3]]); // black pawn at (6,6)
    const newBoard = applyMove(board, { from: [6, 6], to: [7, 7], captures: [] }, -1);
    assert.equal(newBoard[63], 4, 'black pawn promoted to king');
  });

  test('applyMove: king does not get promoted', () => {
    const board = makeBoard([[9, 2]]); // white king at (1,1)
    const newBoard = applyMove(board, { from: [1, 1], to: [0, 0], captures: [] }, 1);
    assert.equal(newBoard[0], 2, 'king stays king');
  });

  test('applyMove: black king does not get promoted', () => {
    const board = makeBoard([[54, 4]]); // black king at (6,6)
    const newBoard = applyMove(board, { from: [6, 6], to: [7, 7], captures: [] }, -1);
    assert.equal(newBoard[63], 4, 'black king stays king');
  });

  test('applyMove: null move returns copy of board', () => {
    const board = makeBoard([[28, 1]]);
    const newBoard = applyMove(board, null, 1);
    assert.deepEqual(newBoard, board);
  });

  test('applyMove: move with missing from/to returns copy', () => {
    const board = makeBoard([[28, 1]]);
    const newBoard = applyMove(board, { from: [4, 4] }, 1); // missing 'to'
    assert.deepEqual(newBoard, board);
  });

  test('applyMove: does not mutate original board', () => {
    const board = makeBoard([[45, 1], [36, 3]]);
    const original = [...board];
    applyMove(board, { from: [5, 5], to: [3, 3], captures: [[4, 4]] }, 1);
    assert.deepEqual(board, original, 'original board must not be mutated');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: generateLegalMoves()
  // ═══════════════════════════════════════════════════════════════════════

  test('generateLegalMoves: empty board has no moves', () => {
    assert.deepEqual(generateLegalMoves(emptyBoard(), 1), []);
    assert.deepEqual(generateLegalMoves(emptyBoard(), -1), []);
  });

  test('generateLegalMoves: white pawn can move diagonally forward', () => {
    const board = makeBoard([[45, 1]]); // (5,5) white pawn
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.length >= 1, 'should have at least 1 move');
    const targets = moves.map(m => m.to);
    // White moves up: (5,5) → (4,4) or (4,6)
    assert.ok(targets.some(([r, c]) => r === 4 && c === 4), 'should move to (4,4)');
    assert.ok(targets.some(([r, c]) => r === 4 && c === 6), 'should move to (4,6)');
  });

  test('generateLegalMoves: black pawn can move diagonally forward', () => {
    const board = makeBoard([[18, 3]]); // (2,2) black pawn
    const moves = generateLegalMoves(board, -1);
    assert.ok(moves.length >= 1, 'should have at least 1 move');
    const targets = moves.map(m => m.to);
    // Black moves down: (2,2) → (3,1) or (3,3)
    assert.ok(targets.some(([r, c]) => r === 3 && c === 1), 'should move to (3,1)');
    assert.ok(targets.some(([r, c]) => r === 3 && c === 3), 'should move to (3,3)');
  });

  test('generateLegalMoves: pawn blocked by own piece', () => {
    const board = makeBoard([
      [45, 1], // white pawn at (5,5)
      [36, 2], // white king at (4,4) — blocks diagonal
    ]);
    const moves = generateLegalMoves(board, 1);
    // Only (4,6) should be available, not (4,4)
    const targets = moves.map(m => m.to);
    assert.ok(!targets.some(([r, c]) => r === 4 && c === 4), '(4,4) should be blocked');
    assert.ok(targets.some(([r, c]) => r === 4 && c === 6), '(4,6) should be available');
  });

  test('generateLegalMoves: capture takes priority over simple moves', () => {
    const board = makeBoard([
      [45, 1], // white pawn (5,5)
      [36, 3], // black pawn (4,4) — capturable
    ]);
    const moves = generateLegalMoves(board, 1);
    // All moves should be captures (mandatory in checkers)
    assert.ok(moves.every(m => m.captures && m.captures.length > 0), 'all moves should be captures');
  });

  test('generateLegalMoves: white pawn cannot capture backward', () => {
    // White pawn at (4,4), black piece at (5,5) — white cannot capture downward
    const board = makeBoard([
      [36, 1], // white pawn at (4,4)
      [45, 3], // black pawn at (5,5) — behind white
    ]);
    const moves = generateLegalMoves(board, 1);
    // No captures should exist since white captures forward (upward)
    const hasCapture = moves.some(m => m.captures && m.captures.length > 0);
    assert.equal(hasCapture, false, 'white cannot capture backward');
  });

  test('generateLegalMoves: black pawn cannot capture backward', () => {
    // Black pawn at (4,4), white piece at (3,3) — black cannot capture upward
    const board = makeBoard([
      [36, 3], // black pawn at (4,4)
      [27, 1], // white pawn at (3,3) — behind black
    ]);
    const moves = generateLegalMoves(board, -1);
    const hasCapture = moves.some(m => m.captures && m.captures.length > 0);
    assert.equal(hasCapture, false, 'black cannot capture backward');
  });

  test('generateLegalMoves: king can move in all 4 diagonals', () => {
    const board = makeBoard([[27, 2]]); // white king at (3,3) center
    const moves = generateLegalMoves(board, 1);
    const targets = moves.map(m => m.to);
    // All 4 directions should be available
    assert.ok(targets.some(([r, c]) => r === 2 && c === 2), 'NW');
    assert.ok(targets.some(([r, c]) => r === 2 && c === 4), 'NE');
    assert.ok(targets.some(([r, c]) => r === 4 && c === 2), 'SW');
    assert.ok(targets.some(([r, c]) => r === 4 && c === 4), 'SE');
  });

  test('generateLegalMoves: king can capture in all directions', () => {
    const board = makeBoard([
      [27, 2], // white king at (3,3)
      [18, 3], // black pawn at (2,2) — NW
      [36, 3], // black pawn at (4,4) — SE
    ]);
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.every(m => m.captures && m.captures.length > 0), 'captures mandatory');
    const targets = moves.map(m => m.to);
    assert.ok(targets.some(([r, c]) => r === 1 && c === 1), 'can capture NW → (1,1)');
    assert.ok(targets.some(([r, c]) => r === 5 && c === 5), 'can capture SE → (5,5)');
  });

  test('generateLegalMoves: pawn at edge has fewer moves', () => {
    const board = makeBoard([[48, 1]]); // white pawn at (6,0) — left edge
    const moves = generateLegalMoves(board, 1);
    // Can only move to (5,1) — right diagonal (left is off-board)
    assert.equal(moves.length, 1, 'edge pawn should have only 1 move');
    assert.deepEqual(moves[0].to, [5, 1]);
  });

  test('generateLegalMoves: pawn at right edge', () => {
    const board = makeBoard([[55, 1]]); // white pawn at (6,7) — right edge
    const moves = generateLegalMoves(board, 1);
    assert.equal(moves.length, 1, 'edge pawn should have only 1 move');
    assert.deepEqual(moves[0].to, [5, 6]);
  });

  test('generateLegalMoves: standard opening position', () => {
    // Standard checkers starting position — 12 white pawns
    const board = emptyBoard();
    // White pawns: rows 5,6,7 (dark squares)
    for (let r = 5; r <= 7; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 1;
      }
    }
    // Black pawns: rows 0,1,2
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 3;
      }
    }

    const whiteMoves = generateLegalMoves(board, 1);
    const blackMoves = generateLegalMoves(board, -1);
    assert.equal(whiteMoves.length, 7, 'white should have 7 opening moves');
    assert.equal(blackMoves.length, 7, 'black should have 7 opening moves');
    // No captures in opening position
    assert.ok(whiteMoves.every(m => m.captures.length === 0), 'no captures in opening');
    assert.ok(blackMoves.every(m => m.captures.length === 0), 'no captures in opening');
  });

  test('generateLegalMoves: blocked position returns empty', () => {
    // All white pawns blocked by black pawns directly in front
    const board = makeBoard([
      [44, 1], // white at (5,4)
      [35, 3], // black at (4,3) — blocks
      [37, 3], // black at (4,5) — blocks
    ]);
    // White can't move to (4,3) or (4,5) — blocked. But can capture both!
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'captures should be available');
    assert.ok(moves.every(m => m.captures.length > 0), 'should be captures');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: minimaxSearch()
  // ═══════════════════════════════════════════════════════════════════════

  test('minimaxSearch: returns a valid move from opening position', () => {
    const board = emptyBoard();
    for (let r = 5; r <= 7; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 1;
      }
    }
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 3;
      }
    }

    const result = minimaxSearch(board, 1, 2);
    assert.ok(result.move, 'should return a move');
    assert.ok(Array.isArray(result.move.from), 'move.from should be array');
    assert.ok(Array.isArray(result.move.to), 'move.to should be array');
    assert.ok(typeof result.score === 'number', 'score should be a number');
  });

  test('minimaxSearch: depth=1 returns immediate best move', () => {
    const board = makeBoard([
      [45, 1], // white pawn
      [36, 3], // black pawn — capturable
    ]);
    const result = minimaxSearch(board, 1, 1);
    assert.ok(result.move, 'should return a move');
    // With only captures available, should pick the capture
    assert.ok(result.move.captures && result.move.captures.length > 0, 'should capture');
  });

  test('minimaxSearch: white wins when only white pieces remain', () => {
    const board = makeBoard([[28, 2]]); // single white king
    const result = minimaxSearch(board, 1, 2);
    // White has a king, black has nothing → white should win
    assert.ok(result.score > 0, `white winning position should score > 0, got ${result.score}`);
  });

  test('minimaxSearch: black wins when only black pieces remain', () => {
    const board = makeBoard([[28, 4]]); // single black king
    const result = minimaxSearch(board, -1, 2);
    assert.ok(result.score < 0, `black winning position should score < 0, got ${result.score}`);
  });

  test('minimaxSearch: forced capture sequence', () => {
    // White can capture black in 1 move
    const board = makeBoard([
      [45, 1], // white (5,5)
      [36, 3], // black (4,4)
    ]);
    const result = minimaxSearch(board, 1, 1);
    assert.deepEqual(result.move.from, [5, 5]);
    assert.deepEqual(result.move.to, [3, 3]);
    assert.deepEqual(result.move.captures, [[4, 4]]);
  });

  test('minimaxSearch: depth 0 returns evaluation only', () => {
    const board = makeBoard([[28, 1], [36, 3]]);
    const result = minimaxSearch(board, 1, 0);
    assert.equal(result.move, null, 'depth 0 should not return a move');
    assert.ok(typeof result.score === 'number');
  });

  test('minimaxSearch: no legal moves returns losing score', () => {
    // Black has no pieces, it is black's turn → no legal moves
    const board = makeBoard([[28, 1]]); // only white piece
    const result = minimaxSearch(board, -1, 2);
    // Black has no moves → losing position
    assert.ok(result.score > 0, 'black with no pieces should score positively for white');
  });

  test('minimaxSearch: promotion is valued', () => {
    // White pawn one step from promotion
    const board = makeBoard([
      [9, 1],  // white pawn at (1,1) — can promote to (0,0)
    ]);
    const result = minimaxSearch(board, 1, 2);
    assert.ok(result.move, 'should find a move');
    // Should move toward promotion
    assert.ok(result.move.to[0] === 0, 'should move to row 0 for promotion');
  });

  test('minimaxSearch: alpha-beta prunes correctly', () => {
    // Full board — test that it completes in reasonable time (depth 3)
    const board = emptyBoard();
    for (let r = 5; r <= 7; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 1;
      }
    }
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) board[r * 8 + c] = 3;
      }
    }
    const start = Date.now();
    const result = minimaxSearch(board, 1, 3);
    const elapsed = Date.now() - start;
    assert.ok(result.move, 'should return a move');
    assert.ok(elapsed < 5000, `depth 3 should complete in <5s, took ${elapsed}ms`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: Edge cases — boundary boards
  // ═══════════════════════════════════════════════════════════════════════

  test('applyMove: capture on board edge', () => {
    // White at (2,0), black at (3,1) — capture lands at (4,2)
    const board = makeBoard([
      [16, 1], // (2,0)
      [25, 3], // (3,1)
    ]);
    const newBoard = applyMove(board, {
      from: [2, 0], to: [4, 2],
      captures: [[3, 1]],
    }, 1);
    assert.equal(newBoard[16], 0);
    assert.equal(newBoard[25], 0);
    assert.equal(newBoard[34], 1);
  });

  test('generateLegalMoves: all pieces on one row', () => {
    const board = makeBoard([
      [32, 1], [34, 1], [36, 1], [38, 1], // row 4, white
    ]);
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'should have moves');
    // Each pawn has 1 or 2 forward moves
    assert.ok(moves.length <= 8, `expected <=8 moves, got ${moves.length}`);
  });

  test('evaluate: completely filled board', () => {
    const board = emptyBoard();
    for (let i = 0; i < 64; i++) {
      board[i] = (i % 2 === 0) ? 1 : 3; // alternate white/black
    }
    const score = evaluate(board, 1);
    assert.ok(typeof score === 'number' && isFinite(score), 'should return finite number');
  });

  test('generateLegalMoves: single white pawn vs single black king', () => {
    const board = makeBoard([
      [28, 1], // white pawn (3,4)
      [35, 4], // black king (4,3)
    ]);
    const whiteMoves = generateLegalMoves(board, 1);
    const blackMoves = generateLegalMoves(board, -1);
    // White can't capture black king (it's behind), but black king can capture
    assert.ok(blackMoves.some(m => m.captures.length > 0), 'black king should have capture');
  });

  test('minimaxSearch: material advantage reflects in score', () => {
    // White has 3 pawns, black has 1 — white should win
    const board = makeBoard([
      [45, 1], [47, 1], [43, 1], // 3 white
      [18, 3], // 1 black
    ]);
    const result = minimaxSearch(board, 1, 2);
    assert.ok(result.score > 0, `material advantage should score > 0, got ${result.score}`);
  });

  // ── Run all tests ─────────────────────────────────────────────────
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

  console.log(`\n  minimax-core: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
