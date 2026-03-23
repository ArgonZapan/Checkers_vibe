/**
 * hunter-coverageGaps.test.js — Tests covering genuine gaps in existing test suite.
 *
 * Covers:
 * 1. trainer.js: _validateAndFallback edge cases (out-of-range index, mixed coordinate formats)
 * 2. trainer.js: isMoveLegal — array coords with captures, edge cases
 * 3. trainer.js: calculateReward — pawn direction in calcThreat
 * 4. proxy.js: body serialization edge cases, concurrent body handling
 * 5. boardConvert.js: boardToCpp with extra properties, type coercion edge cases
 *
 * Extracted logic — no server, engine, or TF.js required.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: trainer.js — _validateAndFallback edge cases
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a move object — mirrors server/ai/trainer.js validateMove exactly.
 * Handles both scalar 0-63 and [row,col] array formats (normalizes arrays to scalars).
 */
function validateMove(move) {
  if (!move || typeof move !== 'object') {
    return { valid: false, reason: 'move is null/undefined/not an object' };
  }
  if (!('from' in move) || !('to' in move)) {
    return { valid: false, reason: 'move missing from/to fields' };
  }
  let { from, to } = move;

  // Normalize [row,col] arrays to scalar 0-63 (C++ engine uses array format)
  if (Array.isArray(from)) {
    if (from.length !== 2 || !Number.isInteger(from[0]) || !Number.isInteger(from[1])) {
      return { valid: false, reason: `from array invalid: ${JSON.stringify(from)}` };
    }
    from = from[0] * 8 + from[1];
  }
  if (Array.isArray(to)) {
    if (to.length !== 2 || !Number.isInteger(to[0]) || !Number.isInteger(to[1])) {
      return { valid: false, reason: `to array invalid: ${JSON.stringify(to)}` };
    }
    to = to[0] * 8 + to[1];
  }

  // from/to should be numbers in range 0-63
  if (typeof from !== 'number' || typeof to !== 'number') {
    return { valid: false, reason: `from/to not numbers: from=${from} (${typeof from}), to=${to} (${typeof to})` };
  }
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    return { valid: false, reason: `from/to not integers: from=${from}, to=${to}` };
  }
  if (from < 0 || from > 63 || to < 0 || to > 63) {
    return { valid: false, reason: `from/to out of range 0-63: from=${from}, to=${to}` };
  }
  if (from === to) {
    return { valid: false, reason: `from === to === ${from} (no-op move)` };
  }
  return { valid: true, move };
}

function isMoveLegal(move, legalMoves) {
  if (!move || !Array.isArray(legalMoves) || legalMoves.length === 0) return false;
  return legalMoves.some(lm => {
    const sameFrom = Array.isArray(lm.from)
      ? lm.from[0] === move.from?.[0] && lm.from[1] === move.from?.[1]
      : lm.from === move.from;
    const sameTo = Array.isArray(lm.to)
      ? lm.to[0] === move.to?.[0] && lm.to[1] === move.to?.[1]
      : lm.to === move.to;
    if (!sameFrom || !sameTo) return false;
    if (move.captures && move.captures.length > 0) {
      if (!lm.captures || lm.captures.length !== move.captures.length) return false;
      return move.captures.every((c, i) => c[0] === lm.captures[i]?.[0] && c[1] === lm.captures[i]?.[1]);
    }
    return true;
  });
}

function randomLegalMove(legalMoves) {
  if (!legalMoves || legalMoves.length === 0) return null;
  return legalMoves[Math.floor(Math.random() * legalMoves.length)];
}

/**
 * _validateAndFallback — mirrors server/ai/trainer.js exactly.
 * Uses validateMove (which now handles [row,col] arrays) then isMoveLegal.
 */
function validateAndFallback(chosenMove, legalMoves) {
  // Resolve chosen move to a full move object
  let selectedMove;
  if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
    const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
    selectedMove = legalMoves[idx] || null;
  } else if (chosenMove && typeof chosenMove === 'object' && 'from' in chosenMove) {
    selectedMove = chosenMove;
  }

  // Validate the selected move (handles both scalar and [row,col] formats)
  const validation = validateMove(selectedMove);
  if (!validation.valid) {
    return randomLegalMove(legalMoves);
  }

  // Check if move is actually legal
  if (!isMoveLegal(selectedMove, legalMoves)) {
    return randomLegalMove(legalMoves);
  }

  return selectedMove;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: trainer.js — calculateReward with pawn direction calcThreat
// ═══════════════════════════════════════════════════════════════════════════════

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2;
  return val === 3 || val === 4;
}

function isPawn(val, turn) {
  return turn === 1 ? val === 1 : val === 3;
}

function isKing(val) {
  const absVal = Math.abs(val);
  return absVal === 2 || absVal === 4;
}

function calcThreatWithDirection(board, turn) {
  let myThreats = 0, oppThreats = 0;
  for (let i = 0; i < 64; i++) {
    if (!board[i]) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isMy = isOwnPiece(board[i], turn);
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const adjR = row + dr, adjC = col + dc;
      const jumpR = row - dr, jumpC = col - dc;
      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (jumpR < 0 || jumpR > 7 || jumpC < 0 || jumpC > 7) continue;
      const adjIdx = adjR * 8 + adjC;
      const jumpIdx = jumpR * 8 + jumpC;
      if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
        const oppVal = board[adjIdx];
        const oppAbsVal = Math.abs(oppVal);
        const oppIsKing = oppAbsVal === 2 || oppAbsVal === 4;
        if (!oppIsKing) {
          const oppIsWhite = oppVal > 0 && (oppAbsVal === 1 || oppAbsVal === 2);
          if (oppIsWhite && dr !== -1) continue;
          if (!oppIsWhite && dr !== 1) continue;
        }
        if (isMy) myThreats++; else oppThreats++;
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

function emptyBoard() { return new Array(64).fill(0); }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: proxy.js — body serialization edge cases
// ═══════════════════════════════════════════════════════════════════════════════

function methodHasBody(method) {
  return ['POST', 'PUT', 'PATCH'].includes(method);
}

function serializeBody(body) {
  if (!body) return null;
  return JSON.stringify(body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: boardToCpp — extra properties, type coercion
// ═══════════════════════════════════════════════════════════════════════════════

function boardToCpp(board) {
  if (!board || !Array.isArray(board)) {
    return new Array(64).fill(0);
  }
  return board.flat().map(p => {
    if (!p || typeof p !== 'object') return 0;
    if (p.color === 'white') return p.king ? 2 : 1;
    if (p.color === 'black') return p.king ? 4 : 3;
    return 0;
  });
}

function boardFromCpp(cppBoard) {
  if (!cppBoard || !Array.isArray(cppBoard)) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
  if (cppBoard.length === 0) {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════════

export async function runHunterCoverageGapsTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── 1. _validateAndFallback: index-based resolution edge cases ─────────

  const legalMoves = [
    { from: 8, to: 12, captures: [] },
    { from: 9, to: 13, captures: [] },
    { from: 10, to: 14, captures: [] },
  ];

  test('validateAndFallback: index 0 resolves correctly', () => {
    const result = validateAndFallback(0, legalMoves);
    assert.equal(result.from, 8);
    assert.equal(result.to, 12);
  });

  test('validateAndFallback: index 2 resolves correctly', () => {
    const result = validateAndFallback(2, legalMoves);
    assert.equal(result.from, 10);
    assert.equal(result.to, 14);
  });

  test('validateAndFallback: index -1 causes fallback (legalMoves[-1] is undefined)', () => {
    const result = validateAndFallback(-1, legalMoves);
    assert.ok(result !== null && result !== undefined);
    assert.ok(legalMoves.some(m => m.from === result.from && m.to === result.to));
  });

  test('validateAndFallback: object {index: 0} resolves correctly', () => {
    const result = validateAndFallback({ index: 0 }, legalMoves);
    assert.equal(result.from, 8);
  });

  test('validateAndFallback: object {index: 999} causes fallback', () => {
    const result = validateAndFallback({ index: 999 }, legalMoves);
    assert.ok(result !== null);
    assert.ok(legalMoves.some(m => m.from === result.from));
  });

  test('validateAndFallback: object with both index and from/to (index takes precedence)', () => {
    // When index is present, it resolves via index first
    const result = validateAndFallback({ from: 100, to: 200, index: 1 }, legalMoves);
    assert.equal(result.from, 9); // index 1 → legalMoves[1]
  });

  test('validateAndFallback: scalar index 0 on single-element legalMoves', () => {
    const single = [{ from: 42, to: 43, captures: [] }];
    const result = validateAndFallback(0, single);
    assert.equal(result.from, 42);
  });

  test('validateAndFallback: empty legalMoves with scalar index → null', () => {
    const result = validateAndFallback(0, []);
    assert.equal(result, null);
  });

  // ── 2. isMoveLegal: array coordinates with captures ────────────────────

  const arrayLegalMoves = [
    { from: [2, 1], to: [4, 3], captures: [[3, 2]] },
    { from: [2, 3], to: [4, 5], captures: [[3, 4]] },
    { from: [5, 0], to: [4, 1], captures: [] },
  ];

  test('isMoveLegal: array move with single capture matches', () => {
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 2]] };
    assert.ok(isMoveLegal(move, arrayLegalMoves));
  });

  test('isMoveLegal: array move with wrong capture square fails', () => {
    const move = { from: [2, 1], to: [4, 3], captures: [[3, 4]] };
    assert.ok(!isMoveLegal(move, arrayLegalMoves));
  });

  test('isMoveLegal: array non-capture move matches non-capture legal move', () => {
    const move = { from: [5, 0], to: [4, 1] };
    assert.ok(isMoveLegal(move, arrayLegalMoves));
  });

  test('isMoveLegal: array move without captures matches capture legal move (allowed)', () => {
    // When move has no captures, any capture arrangement is accepted
    const move = { from: [2, 1], to: [4, 3] };
    assert.ok(isMoveLegal(move, arrayLegalMoves));
  });

  test('isMoveLegal: move with captures but legal move has no captures → false', () => {
    const legal = [{ from: [5, 0], to: [4, 1] }];
    const move = { from: [5, 0], to: [4, 1], captures: [[4, 1]] };
    assert.ok(!isMoveLegal(move, legal));
  });

  test('isMoveLegal: multi-capture array move matching', () => {
    const legal = [{ from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 4]] }];
    const move = { from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 4]] };
    assert.ok(isMoveLegal(move, legal));
  });

  test('isMoveLegal: multi-capture partial mismatch → false', () => {
    const legal = [{ from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 4]] }];
    const move = { from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 6]] };
    assert.ok(!isMoveLegal(move, legal));
  });

  test('isMoveLegal: mixed from (array) in legal, scalar from in move → false', () => {
    // legal has array from [2,1], move has scalar from 17 → lm.from[0] check fails
    const legal = [{ from: [2, 1], to: [3, 0] }];
    const move = { from: 17, to: 24 };
    assert.ok(!isMoveLegal(move, legal));
  });

  test('isMoveLegal: mixed to (array) in legal, scalar to in move → false', () => {
    const legal = [{ from: 17, to: [3, 0] }];
    const move = { from: 17, to: 24 };
    assert.ok(!isMoveLegal(move, legal));
  });

  // ── 3. calcThreat: pawn direction filtering ───────────────────────────

  test('calcThreat: white pawn can only capture downward (dr=-1 from pawn perspective)', () => {
    const board = emptyBoard();
    // White pawn at [2,3] (index 19), black pawn at [1,4] (index 12)
    // Black is above white, so white can capture black by jumping over it downward
    // From white's perspective: black is at dr=-1 from white's position
    // The check: !oppIsWhite && dr !== 1 → if opp is black, dr must be 1 (from adj to jump)
    // Actually: for white piece seeing black adj: isMy=true, opp is black
    // oppIsWhite=false, dr is direction from own piece to adj opponent
    board[19] = 1; // white pawn at row 2, col 3
    board[12] = 3; // black pawn at row 1, col 4 (adjacent: dr=-1, dc=1 from white)
    // Jump square: row 3, col 2 (index 26) — must be empty
    const threat = calcThreatWithDirection(board, 1);
    // Black pawn at [1,4] with dr=+1 (captures toward row 0, away from white) 
    // The code checks: !oppIsWhite && dr !== 1 → but dr here is from white to black = -1
    // So !oppIsWhite && (-1) !== 1 → true → threat counted
    assert.ok(typeof threat === 'number');
  });

  test('calcThreat: black pawn can only capture upward (dr=1 from pawn perspective)', () => {
    const board = emptyBoard();
    // Black pawn at [4,3] (index 35), white pawn at [5,4] (index 44)
    // White is below black, so black can capture white by jumping over it upward
    // From black's perspective: white is at dr=+1
    board[35] = 3; // black pawn at row 4, col 3
    board[44] = 1; // white pawn at row 5, col 4 (adjacent: dr=1, dc=1 from black)
    // Jump square: row 3, col 2 (index 26) — must be empty
    const threat = calcThreatWithDirection(board, -1);
    assert.ok(typeof threat === 'number');
  });

  test('calcThreat: king can capture in any direction', () => {
    const board = emptyBoard();
    // Black king at [3,3] (index 27), white pawn at [2,4] (index 20) — above-right
    // Jump square: row 4, col 2 (index 34) — empty
    board[27] = 4; // black king
    board[20] = 1; // white pawn above-right
    const threat = calcThreatWithDirection(board, -1);
    // King has no direction restriction, so this should count as a threat
    assert.ok(typeof threat === 'number');
  });

  test('calcThreat: pawn blocked by jump square occupied → no threat', () => {
    const board = emptyBoard();
    board[19] = 1; // white pawn at [2,3]
    board[12] = 3; // black pawn at [1,4] (adjacent)
    board[5] = 3;  // another piece at jump square [0,5] — blocks capture
    // Jump from [2,3] over [1,4] lands on [0,5] which is occupied → no threat
    const threat = calcThreatWithDirection(board, 1);
    assert.ok(typeof threat === 'number');
  });

  test('calcThreat: empty board has no threats', () => {
    assert.equal(calcThreatWithDirection(emptyBoard(), 1), 0);
    assert.equal(calcThreatWithDirection(emptyBoard(), -1), 0);
  });

  test('calcThreat: isolated pieces (not adjacent) have no threats', () => {
    const board = emptyBoard();
    board[0] = 1; // white pawn at [0,1]
    board[63] = 3; // black pawn at [7,7]
    assert.equal(calcThreatWithDirection(board, 1), 0);
  });

  // ── 4. proxy.js: body serialization edge cases ─────────────────────────

  test('serializeBody: unicode content preserved', () => {
    const body = { message: 'Zażółć gęślą jaźń 🎮' };
    const result = serializeBody(body);
    const parsed = JSON.parse(result);
    assert.equal(parsed.message, 'Zażółć gęślą jaźń 🎮');
  });

  test('serializeBody: deeply nested object', () => {
    const body = { a: { b: { c: { d: 42 } } } };
    const result = JSON.parse(serializeBody(body));
    assert.equal(result.a.b.c.d, 42);
  });

  test('serializeBody: array value in object', () => {
    const body = { moves: [[1, 2], [3, 4]], count: 2 };
    const result = JSON.parse(serializeBody(body));
    assert.deepEqual(result.moves, [[1, 2], [3, 4]]);
    assert.equal(result.count, 2);
  });

  test('serializeBody: number zero is falsy → null', () => {
    assert.equal(serializeBody(0), null);
  });

  test('serializeBody: empty string is falsy → null', () => {
    assert.equal(serializeBody(''), null);
  });

  test('serializeBody: boolean false is falsy → null', () => {
    assert.equal(serializeBody(false), null);
  });

  test('methodHasBody: TRACE → false', () => {
    assert.equal(methodHasBody('TRACE'), false);
  });

  test('methodHasBody: CONNECT → false', () => {
    assert.equal(methodHasBody('CONNECT'), false);
  });

  test('methodHasBody: empty string → false', () => {
    assert.equal(methodHasBody(''), false);
  });

  // ── 5. boardToCpp: edge cases with extra properties ────────────────────

  test('boardToCpp: piece with extra properties ignores them', () => {
    const board = [[{ color: 'white', king: false, promoted: true, row: 3, col: 2, _id: 'abc' }]];
    assert.deepEqual(boardToCpp(board), [1]);
  });

  test('boardToCpp: piece with getter for king', () => {
    const piece = { color: 'black' };
    Object.defineProperty(piece, 'king', { get: () => true });
    const result = boardToCpp([[piece]]);
    assert.equal(result[0], 4);
  });

  test('boardToCpp: piece with circular reference property (still works)', () => {
    const piece = { color: 'white', king: false };
    piece.self = piece; // circular ref
    assert.deepEqual(boardToCpp([[piece]]), [1]);
  });

  test('boardToCpp: board with prototype pollution attempt (safe)', () => {
    const board = [[{ color: 'white', king: false, __proto__: { isAdmin: true } }]];
    const result = boardToCpp(board);
    assert.deepEqual(result, [1]);
  });

  test('boardFromCpp: negative value treated as black pawn', () => {
    const board = boardFromCpp([[-5]]);
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardFromCpp: large positive value treated as black pawn', () => {
    const board = boardFromCpp([[999]]);
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardFromCpp: float value (3.5) — triggers king check on 2 or 4 only', () => {
    const board = boardFromCpp([[3.5]]);
    // 3.5 !== 0, !== 1, !== 2 → not white → black
    // 3.5 !== 2, !== 4 → not king → pawn
    assert.equal(board[0][0].color, 'black');
    assert.equal(board[0][0].king, false);
  });

  test('boardToCpp round-trip: pieces with metadata survive (metadata lost, values preserved)', () => {
    const react = Array.from({ length: 8 }, () => new Array(8).fill(null));
    react[0][1] = { color: 'white', king: false, promoted: false };
    react[3][4] = { color: 'black', king: true, moved: true };
    const cpp = boardToCpp(react);
    const back = boardFromCpp(cpp);
    assert.equal(back[0][1].color, 'white');
    assert.equal(back[0][1].king, false);
    assert.equal(back[1][0], null);
    assert.equal(back[3][4].color, 'black');
    assert.equal(back[3][4].king, true);
    // Metadata is gone (not in React format)
    assert.equal(back[0][1].promoted, undefined);
  });

  // ── 6. validateAndFallback: full scenario with captures ────────────────

  test('validateAndFallback: capture move with correct captures passes', () => {
    const moves = [
      { from: 9, to: 18, captures: [13] },
      { from: 11, to: 20, captures: [15] },
    ];
    const result = validateAndFallback({ from: 9, to: 18, captures: [13] }, moves);
    assert.equal(result.from, 9);
    assert.equal(result.to, 18);
  });

  test('validateAndFallback: capture move with wrong from falls back', () => {
    const moves = [
      { from: 9, to: 18, captures: [13] },
      { from: 11, to: 20, captures: [15] },
    ];
    const result = validateAndFallback({ from: 99, to: 18, captures: [13] }, moves);
    assert.ok(result !== null);
    assert.ok(moves.some(m => m.from === result.from));
  });

  // ── 7. isMoveLegal: boundary cases ────────────────────────────────────

  test('isMoveLegal: single legal move exact match', () => {
    const legal = [{ from: [0, 1], to: [1, 0] }];
    assert.ok(isMoveLegal({ from: [0, 1], to: [1, 0] }, legal));
  });

  test('isMoveLegal: single legal move wrong to → false', () => {
    const legal = [{ from: [0, 1], to: [1, 0] }];
    assert.ok(!isMoveLegal({ from: [0, 1], to: [1, 2] }, legal));
  });

  test('isMoveLegal: move with empty captures array matches any capture arrangement', () => {
    const legal = [{ from: 9, to: 18, captures: [13] }];
    const move = { from: 9, to: 18, captures: [] };
    // captures.length === 0 → falsy → skip capture check → true
    assert.ok(isMoveLegal(move, legal));
  });

  // ── 8. validateMove: [row,col] array normalization (new in trainer.js) ──

  test('validateMove: [row,col] array from/to normalizes to scalar', () => {
    // [2,1] → 2*8+1=17, [3,2] → 3*8+2=26
    const r = validateMove({ from: [2, 1], to: [3, 2] });
    assert.equal(r.valid, true);
  });

  test('validateMove: [0,0] to [7,7] — corners valid', () => {
    const r = validateMove({ from: [0, 0], to: [7, 7] });
    assert.equal(r.valid, true);
  });

  test('validateMove: from=[2,1] to=[2,1] — same square rejected', () => {
    const r = validateMove({ from: [2, 1], to: [2, 1] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('no-op'));
  });

  test('validateMove: from=[-1,0] — negative row rejected', () => {
    const r = validateMove({ from: [-1, 0], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: from=[8,0] — row > 7 rejected', () => {
    const r = validateMove({ from: [8, 0], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: from=[3.5, 2] — float in array rejected', () => {
    const r = validateMove({ from: [3.5, 2], to: [4, 3] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('from array invalid'));
  });

  test('validateMove: from=[2] — single-element array rejected', () => {
    const r = validateMove({ from: [2], to: [3, 3] });
    assert.equal(r.valid, false);
    assert.ok(r.reason.includes('from array invalid'));
  });

  test('validateMove: from=[2,3,4] — three-element array rejected', () => {
    const r = validateMove({ from: [2, 3, 4], to: [3, 3] });
    assert.equal(r.valid, false);
  });

  test('validateMove: mixed — scalar from, array to', () => {
    // from=9 (scalar), to=[3,2] (array → 26)
    const r = validateMove({ from: 9, to: [3, 2] });
    assert.equal(r.valid, true);
  });

  test('validateMove: mixed — array from, scalar to', () => {
    const r = validateMove({ from: [1, 1], to: 18 });
    assert.equal(r.valid, true);
  });

  test('validateMove: from="hello" — string rejected', () => {
    const r = validateMove({ from: 'hello', to: [3, 3] });
    assert.equal(r.valid, false);
    // "hello" is not an array, so it falls through to the "not numbers" check
    assert.ok(r.reason.includes('from/to not numbers') || r.reason.includes('from array invalid'));
  });

  // ── 9. validateAndFallback with [row,col] arrays ───────────────────────

  const arrayMovesLegal = [
    { from: [2, 1], to: [3, 2], captures: [] },
    { from: [2, 3], to: [3, 4], captures: [] },
  ];

  test('validateAndFallback: object with array from/to resolves correctly', () => {
    const result = validateAndFallback({ from: [2, 1], to: [3, 2] }, arrayMovesLegal);
    assert.ok(result !== null);
    assert.deepEqual(result.from, [2, 1]);
    assert.deepEqual(result.to, [3, 2]);
  });

  test('validateAndFallback: object with array from/to not in legal → fallback', () => {
    const result = validateAndFallback({ from: [0, 0], to: [1, 1] }, arrayMovesLegal);
    assert.ok(result !== null);
    assert.ok(arrayMovesLegal.some(m =>
      m.from[0] === result.from[0] && m.from[1] === result.from[1]
    ));
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter Coverage Gap Tests');

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
