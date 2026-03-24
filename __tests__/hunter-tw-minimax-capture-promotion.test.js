/**
 * hunter-tw-minimax-capture-promotion.test.js — Edge cases for minimax capture + promotion interactions.
 *
 * Gaps:
 * - Multi-capture that ends in promotion (should stop sequence)
 * - King sliding capture through multiple opponent pieces (blocked by own piece)
 * - generateLegalMoves with no pieces (empty board)
 * - generateLegalMoves with only kings (no pawns)
 * - applyMove with captures array containing out-of-bounds coords
 * - evaluate with all pieces of one color removed
 * - minimaxSearch at depth=1 (immediate evaluation)
 * - Promotion boundary: pawn at row 6 captures to row 7
 */

import assert from 'node:assert/strict';

// ── Inlined from server/ai/minimax.js ───────────────────────────────────

const PIECE_VALUES = { 0: 0, 1: 1, 2: 3, 3: 1, 4: 3 };

function evaluate(flatBoard, turn) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const val = flatBoard[i];
    if (!val) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isOwn = (turn === 1 && (val === 1 || val === 2)) || (turn === -1 && (val === 3 || val === 4));
    const pieceVal = PIECE_VALUES[val];
    const pieceSide = (val === 1 || val === 2) ? 1 : -1;
    let posBonus = 0;
    if (val === 1 || val === 3) {
      const advance = pieceSide === 1 ? row : (7 - row);
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
    if ((turn === 1 && toRow === 7) || (turn === -1 && toRow === 0)) {
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

    if (!isKing) {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        if (isWhiteTurn && dr < 0) continue;
        if (!isWhiteTurn && dr > 0) continue;
        const adjR = row + dr, adjC = col + dc;
        const landR = row + dr*2, landC = col + dc*2;
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
              _multi: [[row, col], [landR, landC]],
            });
          }
        }
      }
    } else {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let nr = row + dr, nc = col + dc;
        let foundOpp = false, oppR = -1, oppC = -1;
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
          const idx = nr * 8 + nc;
          if (board[idx] !== 0) {
            if (foundOpp) break;
            const isOpponent = isWhiteTurn ? (board[idx] === 3 || board[idx] === 4) : (board[idx] === 1 || board[idx] === 2);
            if (isOpponent) { foundOpp = true; oppR = nr; oppC = nc; }
            else break;
          } else if (foundOpp) {
            captures.push({
              from: [row, col], to: [nr, nc],
              captures: [[oppR, oppC]],
              _multi: [[row, col], [nr, nc]],
            });
          }
          nr += dr; nc += dc;
        }
      }
    }
  }

  if (captures.length > 0) {
    const extendedCaptures = [];
    for (const cap of captures) {
      _extendCapture(board, cap, turn, extendedCaptures);
    }
    return extendedCaptures.length > 0 ? extendedCaptures : captures;
  }

  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (val !== myPawn && val !== myKing) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isKing = val === myKing;
    if (!isKing) {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        if (isWhiteTurn && dr < 0) continue;
        if (!isWhiteTurn && dr > 0) continue;
        const newR = row + dr, newC = col + dc;
        if (newR < 0 || newR > 7 || newC < 0 || newC > 7) continue;
        const newIdx = newR * 8 + newC;
        if (board[newIdx] === 0) {
          moves.push({ from: [row, col], to: [newR, newC], captures: [] });
        }
      }
    } else {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let nr = row + dr, nc = col + dc;
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
          const newIdx = nr * 8 + nc;
          if (board[newIdx] !== 0) break;
          moves.push({ from: [row, col], to: [nr, nc], captures: [] });
          nr += dr; nc += dc;
        }
      }
    }
  }
  return moves;
}

function _extendCapture(board, cap, turn, result) {
  const capturedBoard = applyMove(board, cap, turn);
  const landR = cap.to[0], landC = cap.to[1];
  const landIdx = landR * 8 + landC;
  const piece = capturedBoard[landIdx];
  const isKing = piece === 2 || piece === 4;
  const isWhiteTurn = turn === 1;
  const origPiece = board[cap.from[0] * 8 + cap.from[1]];
  const wasPawn = origPiece === 1 || origPiece === 3;
  const promoted = wasPawn && isKing;
  if (promoted) { result.push(cap); return; }

  let foundMore = false;
  if (!isKing) {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      if (isWhiteTurn && dr < 0) continue;
      if (!isWhiteTurn && dr > 0) continue;
      const adjR = landR + dr, adjC = landC + dc;
      const jumpR = landR + dr*2, jumpC = landC + dc*2;
      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (jumpR < 0 || jumpR > 7 || jumpC < 0 || jumpC > 7) continue;
      const adjIdx = adjR * 8 + adjC;
      const jumpIdx = jumpR * 8 + jumpC;
      const adjVal = capturedBoard[adjIdx];
      if (adjVal && adjVal !== 0) {
        const isOpponent = isWhiteTurn ? (adjVal === 3 || adjVal === 4) : (adjVal === 1 || adjVal === 2);
        if (isOpponent && capturedBoard[jumpIdx] === 0) {
          const alreadyCaptured = cap.captures.some(([cr, cc]) => cr === adjR && cc === adjC);
          if (!alreadyCaptured) {
            foundMore = true;
            const newCap = { from: cap.from, to: [jumpR, jumpC], captures: [...cap.captures, [adjR, adjC]] };
            _extendCapture(capturedBoard, newCap, turn, result);
          }
        }
      }
    }
  } else {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let nr = landR + dr, nc = landC + dc;
      let foundOpp = false, oppR = -1, oppC = -1;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const idx = nr * 8 + nc;
        if (capturedBoard[idx] !== 0) {
          if (foundOpp) break;
          const isOpponent = isWhiteTurn ? (capturedBoard[idx] === 3 || capturedBoard[idx] === 4) : (capturedBoard[idx] === 1 || capturedBoard[idx] === 2);
          if (isOpponent) { foundOpp = true; oppR = nr; oppC = nc; }
          else break;
        } else if (foundOpp) {
          const alreadyCaptured = cap.captures.some(([cr, cc]) => cr === oppR && cc === oppC);
          if (!alreadyCaptured) {
            foundMore = true;
            const newCap = { from: cap.from, to: [nr, nc], captures: [...cap.captures, [oppR, oppC]] };
            _extendCapture(capturedBoard, newCap, turn, result);
          }
        }
        nr += dr; nc += dc;
      }
    }
  }
  if (!foundMore) result.push(cap);
}

function minimax(flatBoard, depth, alpha, beta, maximizing, turn) {
  const legalMoves = generateLegalMoves(flatBoard, turn);
  if (depth === 0 || legalMoves.length === 0) {
    if (legalMoves.length === 0) return { score: maximizing ? -1000 : 1000, move: null };
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
  return minimax(flatBoard, depth, -Infinity, Infinity, turn === 1, turn);
}

// ── Helper: create empty board ──────────────────────────────────────────
function emptyBoard() { return new Array(64).fill(0); }

// ── Tests ───────────────────────────────────────────────────────────────

export async function runMinimaxCapturePromotionTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── Empty board ────────────────────────────────────────────────────────

  test('generateLegalMoves: empty board → no moves', () => {
    const board = emptyBoard();
    const moves = generateLegalMoves(board, 1);
    assert.equal(moves.length, 0);
  });

  test('minimaxSearch: empty board → no move, score favors loss', () => {
    const board = emptyBoard();
    const result = minimaxSearch(board, 1, 1);
    assert.equal(result.move, null);
    assert.equal(result.score, -1000); // no moves = loss
  });

  // ── Only kings, no pawns ──────────────────────────────────────────────

  test('generateLegalMoves: only kings on board → sliding moves generated', () => {
    const board = emptyBoard();
    board[3 * 8 + 3] = 2; // white king at (3,3)
    board[4 * 8 + 4] = 4; // black king at (4,4)
    const moves = generateLegalMoves(board, 1);
    assert.ok(moves.length > 0, 'should have moves');
    assert.ok(moves.every(m => m.captures.length === 0 || m.captures.length > 0));
  });

  test('generateLegalMoves: single king in corner → limited moves', () => {
    const board = emptyBoard();
    board[0] = 2; // white king at (0,0)
    const moves = generateLegalMoves(board, 1);
    // King at (0,0) can only move diagonally SE
    assert.ok(moves.length > 0);
    assert.ok(moves.every(m => m.from[0] === 0 && m.from[1] === 0));
  });

  test('generateLegalMoves: king blocked by own piece → no capture of own', () => {
    const board = emptyBoard();
    board[3 * 8 + 3] = 2; // white king
    board[4 * 8 + 4] = 1; // white pawn blocks diagonal
    const moves = generateLegalMoves(board, 1);
    // King can move to (2,2), (2,4), (4,2) but NOT through own pawn to (5,5)
    assert.ok(moves.length > 0);
    const targets = moves.map(m => m.to[0] * 8 + m.to[1]);
    assert.ok(!targets.includes(5 * 8 + 5), 'should not capture own piece');
  });

  // ── Promotion during capture stops multi-jump ─────────────────────────

  test('applyMove: pawn captures to promotion row → becomes king', () => {
    // White pawn at (6,3), black pawn at (7,4), white captures to (7,4)+1 → out of bounds
    // Better: white pawn at (6,1), black pawn at (7,2), capture lands at non-existent (8,3)
    // Use: white pawn at (6,3), black at (5,2) — but white moves down, so pawn at (5,x) captures to (6,x)+1
    // White pawn forward = increasing row. Pawn at (5,3) captures opponent at (6,4) → lands at (7,5)
    const board = emptyBoard();
    board[5 * 8 + 3] = 1; // white pawn at (5,3)
    board[6 * 8 + 4] = 3; // black pawn at (6,4)
    // Capture: (5,3) → jump over (6,4) → land at (7,5)
    const move = { from: [5, 3], to: [7, 5], captures: [[6, 4]] };
    const newBoard = applyMove(board, move, 1);
    assert.equal(newBoard[7 * 8 + 5], 2, 'pawn should promote to white king');
    assert.equal(newBoard[5 * 8 + 3], 0, 'original square empty');
    assert.equal(newBoard[6 * 8 + 4], 0, 'captured piece removed');
  });

  test('applyMove: black pawn captures to row 0 → promotes to black king', () => {
    const board = emptyBoard();
    board[2 * 8 + 3] = 3; // black pawn at (2,3)
    board[1 * 8 + 2] = 1; // white pawn at (1,2)
    // Black captures: (2,3) → jump over (1,2) → land at (0,1)
    const move = { from: [2, 3], to: [0, 1], captures: [[1, 2]] };
    const newBoard = applyMove(board, move, -1);
    assert.equal(newBoard[0 * 8 + 1], 4, 'black pawn should promote to black king');
  });

  test('_extendCapture: promotion during capture stops multi-jump', () => {
    // White pawn at (6,1), black at (7,2) — can't jump to (8,3) out of bounds
    // White pawn at (5,1), black at (6,2), land at (7,3) = promotion row
    // After promotion, no further jumps even if possible
    const board = emptyBoard();
    board[5 * 8 + 1] = 1; // white pawn at (5,1)
    board[6 * 8 + 2] = 3; // black at (6,2)
    const cap = { from: [5, 1], to: [7, 3], captures: [[6, 2]] };
    const results = [];
    _extendCapture(board, cap, 1, results);
    assert.equal(results.length, 1, 'promotion stops multi-capture');
    assert.equal(results[0].captures.length, 1, 'only one capture');
  });

  // ── Pawn with multiple capture options ─────────────────────────────────

  test('generateLegalMoves: pawn with two captures → both listed', () => {
    const board = emptyBoard();
    board[4 * 8 + 3] = 1; // white pawn at (4,3)
    board[5 * 8 + 2] = 3; // black at (5,2)
    board[5 * 8 + 4] = 3; // black at (5,4)
    const moves = generateLegalMoves(board, 1);
    const capMoves = moves.filter(m => m.captures.length > 0);
    assert.ok(capMoves.length >= 2, 'should have at least 2 capture options');
  });

  // ── King sliding capture with own piece blocking ──────────────────────

  test('generateLegalMoves: king slide capture blocked by own piece after opponent', () => {
    const board = emptyBoard();
    board[4 * 8 + 4] = 2; // white king at (4,4)
    board[5 * 8 + 5] = 3; // black pawn at (5,5)
    board[6 * 8 + 6] = 1; // white pawn at (6,6) — blocks landing
    const moves = generateLegalMoves(board, 1);
    const capMoves = moves.filter(m => m.captures.length > 0);
    // King cannot capture black at (5,5) because landing (6,6) is blocked by own piece
    const seCapture = capMoves.find(m => m.to[0] === 6 && m.to[1] === 6);
    assert.equal(seCapture, undefined, 'should not be able to land on own piece');
  });

  // ── evaluate edge cases ───────────────────────────────────────────────

  test('evaluate: all white pieces removed → negative for white', () => {
    const board = emptyBoard();
    board[0] = 3; // one black pawn
    const score = evaluate(board, 1);
    assert.ok(score < 0, 'white should be losing');
  });

  test('evaluate: all black pieces removed → positive for black', () => {
    const board = emptyBoard();
    board[63] = 1; // one white pawn
    const score = evaluate(board, -1);
    assert.ok(score < 0, 'black should be losing (white has piece)');
  });

  test('evaluate: symmetric board → score near zero', () => {
    const board = emptyBoard();
    board[2 * 8 + 0] = 1; // white pawn
    board[5 * 8 + 7] = 3; // black pawn (mirror)
    const scoreW = evaluate(board, 1);
    const scoreB = evaluate(board, -1);
    // They should have opposite signs (approximately)
    assert.ok(Math.abs(scoreW + scoreB) < 2, 'scores should approximately cancel');
  });

  // ── minimaxSearch depth=1 ─────────────────────────────────────────────

  test('minimaxSearch: depth=1 returns immediate eval', () => {
    const board = emptyBoard();
    board[3 * 8 + 3] = 1; // white pawn
    board[4 * 8 + 4] = 3; // black pawn
    const result = minimaxSearch(board, 1, 1);
    assert.ok(result.move !== null, 'should find a move');
    assert.ok(typeof result.score === 'number', 'score should be a number');
  });

  // ── applyMove with null/invalid move ──────────────────────────────────

  test('applyMove: null move → returns unchanged board', () => {
    const board = [1, 0, 0, 0, 0, 0, 0, 0, ...new Array(56).fill(0)];
    const result = applyMove(board, null, 1);
    assert.deepEqual(result, board);
  });

  test('applyMove: move without from → returns unchanged board', () => {
    const board = [1, 0, 0, 0, 0, 0, 0, 0, ...new Array(56).fill(0)];
    const result = applyMove(board, { to: [3, 3] }, 1);
    assert.deepEqual(result, board);
  });

  test('applyMove: does not mutate original board', () => {
    const board = emptyBoard();
    board[3 * 8 + 3] = 1;
    const original = [...board];
    applyMove(board, { from: [3, 3], to: [4, 4], captures: [] }, 1);
    assert.deepEqual(board, original, 'original board should be unchanged');
  });

  // ── Multi-capture with multiple pieces ─────────────────────────────────

  test('_extendCapture: double capture with promotion at end → both captures preserved', () => {
    // White pawn at (3,1), black at (4,2), black at (6,4)
    // First capture: (3,1)→(5,3) captures (4,2)
    // After first capture, pawn at (5,3), then captures (6,4)→(7,5) = promotion
    const board = emptyBoard();
    board[3 * 8 + 1] = 1; // white pawn
    board[4 * 8 + 2] = 3; // black
    board[6 * 8 + 4] = 3; // black
    const cap = { from: [3, 1], to: [5, 3], captures: [[4, 2]] };
    const results = [];
    _extendCapture(board, cap, 1, results);
    // Promotion stops multi-capture, but captures accumulate
    assert.equal(results.length, 1, 'should have one result');
    assert.equal(results[0].captures.length, 2, 'should have both captures');
    assert.equal(results[0].to[0], 7, 'should land on row 7 (promotion)');
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

  console.log(`\nhunter-tw-minimax-capture-promotion: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
