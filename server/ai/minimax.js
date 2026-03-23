/**
 * Minimax with alpha-beta pruning for checkers.
 *
 * Pure JS — no HTTP calls during search. Uses applyMove() to simulate moves.
 * Board format: flat 64-element array, 0=empty, 1=white pawn, 2=white king,
 *               3=black pawn, 4=black king.
 * Move format: { from: [row,col], to: [row,col], captures?: [[row,col],...] }
 */

// ── Piece Values ─────────────────────────────────────────────────────────────
const PIECE_VALUES = { 0: 0, 1: 1, 2: 3, 3: 1, 4: 3 };

// ── Evaluate ─────────────────────────────────────────────────────────────────
/**
 * Evaluate board from the perspective of `turn`.
 * @param {number[]} flatBoard — flat 64-element board
 * @param {number} turn — 1 (white) or -1 (black)
 * @returns {number} score (positive = good for turn)
 */
function evaluate(flatBoard, turn) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const val = flatBoard[i];
    if (!val) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isOwn = (turn === 1 && (val === 1 || val === 2)) || (turn === -1 && (val === 3 || val === 4));
    const pieceVal = PIECE_VALUES[val] || 0;

    // Positional bonus
    let posBonus = 0;
    if (val === 1 || val === 3) {
      // Pawn: advance bonus + center bonus
      // White advances toward row 0, black toward row 7
      const advance = turn === 1 ? (7 - row) : row;
      posBonus = advance * 0.05;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.1;
    } else {
      // King: center control
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) posBonus += 0.3;
      else posBonus -= 0.1;
    }

    if (isOwn) score += pieceVal + posBonus;
    else score -= pieceVal + posBonus;
  }
  return score;
}

// ── Apply Move (pure JS simulation) ─────────────────────────────────────────
/**
 * Apply a move to a flat board and return a new board.
 * Handles: normal move, capture, multi-capture, promotion.
 *
 * @param {number[]} board — flat 64-element board (not mutated)
 * @param {object} move — { from: [row,col], to: [row,col], captures?: [...] }
 * @param {number} turn — 1 (white) or -1 (black)
 * @returns {number[]} new flat 64-element board
 */
function applyMove(board, move, turn) {
  const newBoard = [...board];

  if (!move || !Array.isArray(move.from) || !Array.isArray(move.to)) {
    return newBoard; // invalid move, return unchanged
  }

  const [fromRow, fromCol] = move.from;
  const [toRow, toCol] = move.to;
  const fromIdx = fromRow * 8 + fromCol;
  const toIdx = toRow * 8 + toCol;
  const piece = newBoard[fromIdx];

  // Remove captured pieces
  if (Array.isArray(move.captures) && move.captures.length > 0) {
    for (const [capRow, capCol] of move.captures) {
      const capIdx = capRow * 8 + capCol;
      newBoard[capIdx] = 0;
    }
  }

  // Move piece
  newBoard[fromIdx] = 0;
  newBoard[toIdx] = piece;

  // Promotion: pawn reaches last row
  // White starts rows 5-7, promotes at row 0; Black starts rows 0-2, promotes at row 7
  const isPawn = piece === 1 || piece === 3;
  if (isPawn) {
    if ((turn === 1 && toRow === 0) || (turn === -1 && toRow === 7)) {
      newBoard[toIdx] = turn === 1 ? 2 : 4; // promote to king
    }
  }

  return newBoard;
}

// ── Generate Legal Moves (pure JS) ──────────────────────────────────────────
/**
 * Generate legal moves for a given board and turn.
 * This is a simplified move generator — captures are mandatory in checkers.
 *
 * @param {number[]} board — flat 64-element board
 * @param {number} turn — 1 (white) or -1 (black)
 * @returns {object[]} array of legal moves { from, to, captures }
 */
function generateLegalMoves(board, turn) {
  const moves = [];
  const isWhiteTurn = turn === 1;
  const myPawn = isWhiteTurn ? 1 : 3;
  const myKing = isWhiteTurn ? 2 : 4;

  // First pass: find all captures
  const captures = [];

  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (val !== myPawn && val !== myKing) continue;

    const row = Math.floor(i / 8);
    const col = i % 8;
    const isKing = val === myKing;

    // Check all 4 diagonal directions for captures
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      // Pawns can only capture forward (unless king)
      // White starts rows 5-7, moves forward = decreasing row (toward row 0)
      // Black starts rows 0-2, moves forward = increasing row (toward row 7)
      if (!isKing) {
        if (isWhiteTurn && dr > 0) continue; // white skips downward (captures upward)
        if (!isWhiteTurn && dr < 0) continue; // black skips upward (captures downward)
      }

      // Find jump targets for simple captures
      const adjR = row + dr, adjC = col + dc;
      const landR = row + dr * 2, landC = col + dc * 2;

      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (landR < 0 || landR > 7 || landC < 0 || landC > 7) continue;

      const adjIdx = adjR * 8 + adjC;
      const landIdx = landR * 8 + landC;
      const adjVal = board[adjIdx];

      // Can capture if adjacent has opponent piece and landing is empty
      if (adjVal && adjVal !== 0) {
        const isOpponent = isWhiteTurn ? (adjVal === 3 || adjVal === 4) : (adjVal === 1 || adjVal === 2);
        if (isOpponent && board[landIdx] === 0) {
          captures.push({
            from: [row, col],
            to: [landR, landC],
            captures: [[adjR, adjC]],
            _multi: [[row, col], [landR, landC]], // for multi-capture tracking
          });
        }
      }
    }
  }

  // Multi-capture: extend each capture to see if further jumps are possible
  if (captures.length > 0) {
    const extendedCaptures = [];
    for (const cap of captures) {
      _extendCapture(board, cap, turn, extendedCaptures);
    }
    return extendedCaptures.length > 0 ? extendedCaptures : captures;
  }

  // Second pass: find all simple moves (no captures)
  for (let i = 0; i < 64; i++) {
    const val = board[i];
    if (val !== myPawn && val !== myKing) continue;

    const row = Math.floor(i / 8);
    const col = i % 8;
    const isKing = val === myKing;

    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      // Pawns can only move forward
      // White starts rows 5-7, moves forward = decreasing row (toward row 0)
      // Black starts rows 0-2, moves forward = increasing row (toward row 7)
      if (!isKing) {
        if (isWhiteTurn && dr > 0) continue; // white skips downward
        if (!isWhiteTurn && dr < 0) continue; // black skips upward
      }

      const newR = row + dr, newC = col + dc;
      if (newR < 0 || newR > 7 || newC < 0 || newC > 7) continue;

      const newIdx = newR * 8 + newC;
      if (board[newIdx] === 0) {
        moves.push({
          from: [row, col],
          to: [newR, newC],
          captures: [],
        });
      }
    }
  }

  return moves;
}

/**
 * Recursively extend a capture with multi-jumps.
 */
function _extendCapture(board, cap, turn, result) {
  const capturedBoard = applyMove(board, cap, turn);
  const landR = cap.to[0], landC = cap.to[1];
  const landIdx = landR * 8 + landC;
  const piece = capturedBoard[landIdx];
  const isKing = piece === 2 || piece === 4;
  const isWhiteTurn = turn === 1;

  let foundMore = false;

  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    // Pawns can only capture forward
    // White: forward = decreasing row (toward row 0); Black: forward = increasing row (toward row 7)
    if (!isKing) {
      if (isWhiteTurn && dr > 0) continue; // white skips downward
      if (!isWhiteTurn && dr < 0) continue; // black skips upward
    }

    const adjR = landR + dr, adjC = landC + dc;
    const jumpR = landR + dr * 2, jumpC = landC + dc * 2;

    if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
    if (jumpR < 0 || jumpR > 7 || jumpC < 0 || jumpC > 7) continue;

    const adjIdx = adjR * 8 + adjC;
    const jumpIdx = jumpR * 8 + jumpC;
    const adjVal = capturedBoard[adjIdx];

    if (adjVal && adjVal !== 0) {
      const isOpponent = isWhiteTurn ? (adjVal === 3 || adjVal === 4) : (adjVal === 1 || adjVal === 2);
      if (isOpponent && capturedBoard[jumpIdx] === 0) {
        // Check we haven't already captured this piece
        const alreadyCaptured = cap.captures.some(([cr, cc]) => cr === adjR && cc === adjC);
        if (!alreadyCaptured) {
          foundMore = true;
          const newCap = {
            from: cap.from,
            to: [jumpR, jumpC],
            captures: [...cap.captures, [adjR, adjC]],
          };
          _extendCapture(capturedBoard, newCap, turn, result);
        }
      }
    }
  }

  if (!foundMore) {
    // Check for promotion in multi-capture
    const finalBoard = applyMove(board, cap, turn);
    result.push(cap);
  }
}

// ── Minimax with Alpha-Beta Pruning ─────────────────────────────────────────
/**
 * Minimax search.
 *
 * @param {number[]} flatBoard — current board state
 * @param {number} depth — search depth remaining
 * @param {number} alpha — alpha value for pruning
 * @param {number} beta — beta value for pruning
 * @param {boolean} maximizing — true if maximizing player
 * @param {number} turn — 1 (white) or -1 (black) — current player to move
 * @returns {{ score: number, move: object|null }}
 */
function minimax(flatBoard, depth, alpha, beta, maximizing, turn) {
  const legalMoves = generateLegalMoves(flatBoard, turn);

  // Terminal conditions
  if (depth === 0 || legalMoves.length === 0) {
    // If no legal moves, current player loses
    if (legalMoves.length === 0) {
      return {
        score: maximizing ? -1000 : 1000,
        move: null,
      };
    }
    return { score: evaluate(flatBoard, turn), move: null };
  }

  let bestMove = legalMoves[0];

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of legalMoves) {
      const nextBoard = applyMove(flatBoard, move, turn);
      const result = minimax(nextBoard, depth - 1, alpha, beta, false, -turn);
      if (result.score > maxEval) {
        maxEval = result.score;
        bestMove = move;
      }
      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const move of legalMoves) {
      const nextBoard = applyMove(flatBoard, move, turn);
      const result = minimax(nextBoard, depth - 1, alpha, beta, true, -turn);
      if (result.score < minEval) {
        minEval = result.score;
        bestMove = move;
      }
      beta = Math.min(beta, result.score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

/**
 * High-level minimax search: find best move for current position.
 *
 * @param {number[]} flatBoard — current board
 * @param {number} turn — 1 (white) or -1 (black)
 * @param {number} depth — search depth (default 4)
 * @returns {{ score: number, move: object|null }}
 */
function minimaxSearch(flatBoard, turn, depth = 4) {
  const isMaximizing = turn === 1; // white maximizes
  return minimax(flatBoard, depth, -Infinity, Infinity, isMaximizing, turn);
}

export {
  evaluate,
  applyMove,
  generateLegalMoves,
  minimax,
  minimaxSearch,
  PIECE_VALUES,
};
