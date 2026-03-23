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
  // Normalize to 2D array
  let board2D = cppBoard;
  if (Array.isArray(cppBoard) && !Array.isArray(cppBoard[0])) {
    board2D = [];
    for (let r = 0; r < 8; r++) {
      board2D.push(cppBoard.slice(r * 8, r * 8 + 8));
    }
  }
  return board2D.map(row => row.map(val => {
    if (val === 0) return null;
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
  return board.flat().map(p => {
    if (!p) return 0;
    if (p.color === 'white') return p.king ? 2 : 1;
    return p.king ? 4 : 3;
  });
}
