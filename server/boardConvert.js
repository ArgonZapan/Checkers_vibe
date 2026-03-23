/**
 * Board conversion helpers between C++ engine format and React objects.
 *
 * C++ encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
 * React format: null or { color: 'white'|'black', king: boolean }
 */

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
    if (typeof val !== 'number' || val === 0) return null;
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
  const flat = board.flat();
  // Guard against oversized arrays (DoS via memory)
  if (flat.length > 64) {
    console.warn('[boardToCpp] Board array too large:', flat.length, '— truncating to 64');
    flat.length = 64;
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
