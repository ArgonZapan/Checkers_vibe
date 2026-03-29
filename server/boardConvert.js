/**
 * Board conversion helpers between C++ engine format and React objects.
 *
 * C++ encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
 * React format: null or { color: 'white'|'black', king: boolean }
 *
 * SECURITY (Issue #170): All board data from C++ is validated before sending to the client.
 * Invalid values are replaced with null (empty cell) and logged for monitoring.
 */

// Valid C++ piece values (security boundary)
const VALID_PIECE_VALUES = new Set([0, 1, 2, 3, 4]);

/**
 * Validate a raw C++ board value is safe before boardFromCpp processing.
 * Guards against unexpected types or values from a compromised/malformed C++ engine.
 * @param {*} val - Raw cell value from C++
 * @returns {boolean} true if valid (0-4)
 */
export function isValidPieceValue(val) {
  return typeof val === 'number' && Number.isInteger(val) && VALID_PIECE_VALUES.has(val);
}

/**
 * Validate an entire board array — return true only if all 64 cells are valid piece values.
 * Used as a security gate before boardFromCpp() for server→client payloads.
 * @param {*} board - Raw board data (flat array, 2D array, or C++ response)
 * @returns {boolean} true if board passes validation
 */
export function isBoardSafe(board) {
  if (!board || !Array.isArray(board)) return false;
  const flat = board.flat ? board.flat() : board;
  if (!Array.isArray(flat)) return false;
  // Must be exactly 64 cells
  if (flat.length !== 64) return false;
  for (const cell of flat) {
    if (!isValidPieceValue(cell)) return false;
  }
  return true;
}

/**
 * Sanitize a raw board for sending to the client.
 * If validation fails, logs a security warning and returns a safe empty board.
 * This prevents a compromised C++ engine from injecting arbitrary data via board values.
 *
 * @param {*} rawBoard - Raw board from C++ engine
 * @param {string} [context='board'] - Context string for log messages
 * @returns {Array<Array<{color: string, king: boolean}|null>>} Valid 8×8 board
 */
export function sanitizeBoard(rawBoard, context = 'board') {
  if (!isBoardSafe(rawBoard)) {
    console.warn(`[SECURITY] ${context}: invalid board data received from C++ engine — rejecting, returning empty board`);
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  return boardFromCpp(rawBoard);
}

/**
 * Sanitize a complete game state payload before sending to the client.
 * Applies board validation + moveHistory length limit as defense-in-depth for Issue #170.
 *
 * @param {Object} state - Raw state object from getGameState() or handleMove()
 * @param {string} [context='state'] - Context string for log messages
 * @returns {Object} Sanitized state safe to send via WebSocket
 */
export function sanitizeStatePayload(state, context = 'state') {
  if (!state || typeof state !== 'object') {
    console.warn(`[SECURITY] ${context}: invalid state object — rejecting`);
    return {
      board: Array.from({ length: 8 }, () => Array(8).fill(null)),
      turn: 'white',
      legalMoves: [],
      gameOver: false,
      winner: null,
      lastMove: null,
    };
  }

  return {
    ...state,
    // Sanitize board: if C++ returns malformed board, reject it entirely
    board: sanitizeBoard(state.board, context),
    // Clamp moveHistory to prevent unbounded growth (already handled client-side at 40, but server clamps too)
    moveHistory: Array.isArray(state.moveHistory)
      ? state.moveHistory.slice(-50)
      : undefined,
  };
}

/**
 * Convert a C++ board (flat or 2D int array) to 8×8 React piece objects.
 * @param {number[]|number[][]} cppBoard - C++ board representation
 * @returns {Array<Array<{color: string, king: boolean}|null>>}
 */
export function boardFromCpp(cppBoard) {
  // Input validation — prevent crash on null/undefined/non-array
  if (!cppBoard || !Array.isArray(cppBoard)) {
    console.warn('[boardFromCpp] Invalid input:', typeof cppBoard);
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  if (cppBoard.length === 0) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  // Normalize to 2D array
  let board2D = cppBoard;
  if (Array.isArray(cppBoard) && !Array.isArray(cppBoard[0])) {
    // Flat array must have exactly 64 elements for an 8×8 board
    if (cppBoard.length !== 64) {
      console.warn('[boardFromCpp] Flat array length', cppBoard.length, '!== 64, returning empty board');
      return Array.from({ length: 8 }, () => Array(8).fill(null));
    }
    board2D = [];
    for (let r = 0; r < 8; r++) {
      board2D.push(cppBoard.slice(r * 8, r * 8 + 8));
    }
  }
  // Validate 2D array has 8 rows with 8 columns each
  if (board2D.length !== 8) {
    console.warn('[boardFromCpp] 2D array has', board2D.length, 'rows, expected 8, returning empty board');
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  for (let r = 0; r < 8; r++) {
    if (!Array.isArray(board2D[r]) || board2D[r].length !== 8) {
      console.warn('[boardFromCpp] Row', r, 'has length', board2D[r]?.length, 'expected 8, returning empty board');
      return Array.from({ length: 8 }, () => Array(8).fill(null));
    }
  }
  return board2D.map(row => row.map(val => {
    if (typeof val !== 'number' || Number.isNaN(val) || val === 0) return null;
    if (val < 1 || val > 4) return null; // guard against unexpected values
    const isWhite = val === 1 || val === 2;
    const isKing = val === 2 || val === 4;
    return { color: isWhite ? 'white' : 'black', king: isKing };
  }));
}

/**
 * Convert an 8×8 React board back to a flat 64-element int array for C++.
 * @param {Array<Array<{color: string, king: boolean}|null>>} board
 * @returns {number[]}
 */
export function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    console.warn('[boardToCpp] Invalid input:', typeof board);
    return new Array(64).fill(0);
  }
  if (board.length === 0) {
    return new Array(64).fill(0);
  }
  const flat = board.flat();
  // Normalize flat array to exactly 64 elements
  if (flat.length !== 64) {
    if (flat.length > 64) {
      console.warn('[boardToCpp] Board array too large:', flat.length, '— truncating to 64');
      flat.length = 64;
    } else {
      console.warn('[boardToCpp] Board array too short:', flat.length, '— padding with zeros to 64');
      const originalLen = flat.length;
      flat.length = 64;
      flat.fill(0, originalLen);
    }
  }
  return flat.map(p => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 0;
    // Only read expected properties (prevent prototype pollution)
    const color = p.color;
    const king = p.king;
    if (color === 'white') return king ? 2 : 1;
    if (color === 'black') return king ? 4 : 3;
    return 0;
  });
}

/**
 * Check if a piece should be promoted based on its position.
 * @param {number} piece - C++ piece encoding: 1=white pawn, 2=white king, 3=black pawn, 4=black king
 * @param {number} toRow - Destination row (0-7)
 * @param {number} turn - 1 (white) or -1 (black) — player who just moved
 * @returns {boolean} true if the piece should be promoted
 */
export function shouldPromote(piece, toRow, turn) {
  const isPawn = piece === 1 || piece === 3;
  if (!isPawn) return false;
  return (turn === 1 && toRow === 7) || (turn === -1 && toRow === 0);
}

/**
 * Get the promoted piece value.
 * @param {number} piece - C++ piece encoding
 * @returns {number} Promoted piece (2 for white, 4 for black), or unchanged piece if not a pawn
 */
export function promotePiece(piece) {
  if (piece === 1) return 2;
  if (piece === 3) return 4;
  return piece;
}
