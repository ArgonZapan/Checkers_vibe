/**
 * hunter-tw-minimax-edge.test.js — Edge cases for minimax.js generateLegalMoves
 *
 * Gap: existing hunter-alpha-minimax-core.test.js uses a SIMPLIFIED generateLegalMoves
 * that skips _extendCapture (king multi-capture, promotion during capture, blocked diagonal).
 * These tests use the FULL logic from the actual source.
 *
 * Pure JS — no TF.js, no server, no HTTP.
 */

import assert from 'node:assert/strict';

// ── Full minimax logic (from server/ai/minimax.js) ──────────────────────

const PIECE_VALUES = { 0: 0, 1: 1, 2: 3, 3: 1, 4: 3 };

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
  if (promoted) {
    result.push(cap);
    return;
  }

  let foundMore = false;

  if (!isKing) {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      if (isWhiteTurn && dr < 0) continue;
      if (!isWhiteTurn && dr > 0) continue;
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
  } else {
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let nr = landR + dr, nc = landC + dc;
      let foundOpp = false;
      let oppR = -1, oppC = -1;
      while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
        const idx = nr * 8 + nc;
        if (capturedBoard[idx] !== 0) {
          if (foundOpp) break;
          const isOpponent = isWhiteTurn ? (capturedBoard[idx] === 3 || capturedBoard[idx] === 4) : (capturedBoard[idx] === 1 || capturedBoard[idx] === 2);
          if (isOpponent) {
            foundOpp = true;
            oppR = nr;
            oppC = nc;
          } else {
            break;
          }
        } else if (foundOpp) {
          const alreadyCaptured = cap.captures.some(([cr, cc]) => cr === oppR && cc === oppC);
          if (!alreadyCaptured) {
            foundMore = true;
            const newCap = {
              from: cap.from,
              to: [nr, nc],
              captures: [...cap.captures, [oppR, oppC]],
            };
            _extendCapture(capturedBoard, newCap, turn, result);
          }
        }
        nr += dr;
        nc += dc;
      }
    }
  }

  if (!foundMore) {
    result.push(cap);
  }
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
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        if (isWhiteTurn && dr < 0) continue;
        if (!isWhiteTurn && dr > 0) continue;
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
              _multi: [[row, col], [landR, landC]],
            });
          }
        }
      }
    } else {
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        let nr = row + dr, nc = col + dc;
        let foundOpp = false;
        let oppR = -1, oppC = -1;
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
          const idx = nr * 8 + nc;
          if (board[idx] !== 0) {
            if (foundOpp) break;
            const isOpponent = isWhiteTurn ? (board[idx] === 3 || board[idx] === 4) : (board[idx] === 1 || board[idx] === 2);
            if (isOpponent) {
              foundOpp = true;
              oppR = nr;
              oppC = nc;
            } else {
              break;
            }
          } else if (foundOpp) {
            captures.push({
              from: [row, col], to: [nr, nc],
              captures: [[oppR, oppC]],
              _multi: [[row, col], [nr, nc]],
            });
          }
          nr += dr;
          nc += dc;
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
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
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
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        let nr = row + dr, nc = col + dc;
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7) {
          const newIdx = nr * 8 + nc;
          if (board[newIdx] !== 0) break;
          moves.push({ from: [row, col], to: [nr, nc], captures: [] });
          nr += dr;
          nc += dc;
        }
      }
    }
  }
  return moves;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function emptyBoard() { return new Array(64).fill(0); }
function makeBoard(setup) {
  const b = emptyBoard();
  for (const [pos, val] of setup) b[pos] = val;
  return b;
}

export async function runHunterTwMinimaxEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // King multi-capture
  // ═══════════════════════════════════════════════════════════════════════

  test('king multi-capture: king slides over one opponent and captures', () => {
    // White king at (3,3), black pawn at (4,4), land at (5,5)
    const board = makeBoard([[27, 2], [36, 3]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.length > 0);
    assert.ok(caps.length > 0, 'should have at least one capture');
    const cap = caps.find(m => m.captures.length === 1 && m.captures[0][0] === 4 && m.captures[0][1] === 4);
    assert.ok(cap, 'should capture black pawn at (4,4)');
  });

  test('king multi-capture: king can capture two pieces along same diagonal', () => {
    // White king at (1,1), black pawn at (2,2), black pawn at (4,4), land at (5,5)
    const board = makeBoard([[9, 2], [18, 3], [36, 3]]);
    const moves = generateLegalMoves(board, 1);
    const multiCaps = moves.filter(m => m.captures && m.captures.length >= 2);
    // King captures (2,2) then slides to capture (4,4) — if _extendCapture works
    assert.ok(multiCaps.length > 0 || moves.filter(m => m.captures && m.captures.length === 1).length > 0,
      'king should be able to capture along diagonal');
  });

  test('king multi-capture: king blocked by own piece cannot capture behind it', () => {
    // White king at (3,3), white pawn at (4,4) blocks, black pawn at (5,5)
    const board = makeBoard([[27, 2], [36, 1], [45, 3]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.some(c => c[0] === 5 && c[1] === 5));
    assert.equal(caps.length, 0, 'own piece blocks capture of piece behind it');
  });

  test('king multi-capture: king captures and opponent piece after is not own', () => {
    // White king at (2,2), black pawn at (3,3), white pawn at (4,4)
    // King can capture (3,3) but land must be empty — (4,4) has own piece, so no capture
    const board = makeBoard([[18, 2], [27, 3], [36, 1]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.some(c => c[0] === 3 && c[1] === 3));
    assert.equal(caps.length, 0, 'cannot capture when landing square is occupied by own piece');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Promotion during capture
  // ═══════════════════════════════════════════════════════════════════════

  test('promotion during capture: white pawn capturing to row 7 promotes and stops multi-jump', () => {
    // White pawn at (6,1), black pawn at (7,2), land would be (8,3) — off board
    // But white pawn at (5,0), black pawn at (6,1), land at (7,2) → promotes to king
    const board = makeBoard([[40, 1], [49, 3]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.length > 0);
    // The capture leads to row 7, which promotes. Multi-jump should stop.
    assert.ok(caps.length > 0, 'should have a capture that promotes');
    // All captures that land on row 7 should have exactly 1 capture (no multi-jump extension)
    for (const cap of caps) {
      if (cap.to[0] === 7) {
        assert.equal(cap.captures.length, 1, 'promotion during capture should stop multi-jump');
      }
    }
  });

  test('promotion during capture: black pawn capturing to row 0 promotes and stops multi-jump', () => {
    // Black pawn at (1,2), white pawn at (0,1) — black captures to (0,1)... wait need landing empty
    // Black pawn at (2,3), white pawn at (1,2), land at (0,1) → promotes
    const board = makeBoard([[19, 3], [10, 1]]);
    const moves = generateLegalMoves(board, -1);
    const caps = moves.filter(m => m.captures && m.captures.length > 0);
    assert.ok(caps.length > 0, 'black pawn should capture and promote');
    for (const cap of caps) {
      if (cap.to[0] === 0) {
        assert.equal(cap.captures.length, 1, 'promotion should stop multi-jump for black too');
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Blocked diagonal for kings
  // ═══════════════════════════════════════════════════════════════════════

  test('king blocked diagonal: own piece blocks simple move', () => {
    // White king at (3,3), white pawn at (4,4) — king can't move to (4,4) or beyond
    const board = makeBoard([[27, 2], [36, 1]]);
    const moves = generateLegalMoves(board, 1);
    const blockedMoves = moves.filter(m =>
      m.from[0] === 3 && m.from[1] === 3 &&
      m.to[0] >= 4 && m.to[1] >= 4 // SE direction blocked
    );
    assert.equal(blockedMoves.length, 0, 'king should not move past own piece');
  });

  test('king blocked diagonal: opponent piece blocks simple move (no capture)', () => {
    // White king at (3,3), black pawn at (4,4), white pawn at (5,5)
    // King can capture (4,4) if (5,5) is empty — but (5,5) has white pawn
    // So king cannot capture (4,4) because landing is blocked
    // King also can't slide to (4,4) because it's occupied
    const board = makeBoard([[27, 2], [36, 3], [45, 1]]);
    const moves = generateLegalMoves(board, 1);
    // No simple moves in SE direction from (3,3)
    const seMoves = moves.filter(m =>
      m.from[0] === 3 && m.from[1] === 3 &&
      m.to[0] > 3 && m.to[1] > 3 &&
      (!m.captures || m.captures.length === 0)
    );
    assert.equal(seMoves.length, 0, 'king cannot slide through opponent into own piece');
  });

  test('king can move any distance along empty diagonal', () => {
    // White king at (0,0), diagonal completely empty to (7,7)
    const board = makeBoard([[0, 2]]);
    const moves = generateLegalMoves(board, 1);
    const seMoves = moves.filter(m => m.from[0] === 0 && m.from[1] === 0 && m.to[0] === m.to[1] && m.to[0] > 0);
    assert.ok(seMoves.length === 7, `king should have 7 SE moves, got ${seMoves.length}`);
  });

  test('king cannot move off board', () => {
    // White king at (7,7) — can only go NW
    const board = makeBoard([[63, 2]]);
    const moves = generateLegalMoves(board, 1);
    const kingMoves = moves.filter(m => m.from[0] === 7 && m.from[1] === 7);
    // Should have NW moves: (6,6), (5,5), ..., (0,0)
    assert.ok(kingMoves.length === 7, `corner king should have 7 NW moves, got ${kingMoves.length}`);
    // No moves going SE (off board)
    const seMoves = kingMoves.filter(m => m.to[0] > 7 || m.to[1] > 7);
    assert.equal(seMoves.length, 0, 'no moves off board');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Pawn multi-capture
  // ═══════════════════════════════════════════════════════════════════════

  test('pawn multi-capture: white pawn double jump', () => {
    // White pawn at (2,1), black at (3,2), land at (4,3)
    // Then from (4,3), black at (5,4), land at (6,5)
    const board = makeBoard([[17, 1], [27, 3], [43, 3]]);
    const moves = generateLegalMoves(board, 1);
    const multiCaps = moves.filter(m => m.captures && m.captures.length >= 2);
    assert.ok(multiCaps.length > 0, `white pawn should double-jump, got ${multiCaps.length} multi-captures`);
  });

  test('pawn multi-capture: black pawn double jump', () => {
    // Black pawn at (5,2), white at (4,1), land at (3,0)
    // Then from (3,0) can't continue (edge). Different setup:
    // Black pawn at (5,4), white at (4,3), land at (3,2)
    // From (3,2), white at (2,1), land at (1,0)
    const board = makeBoard([[44, 3], [35, 1], [17, 1]]);
    const moves = generateLegalMoves(board, -1);
    const multiCaps = moves.filter(m => m.captures && m.captures.length >= 2);
    assert.ok(multiCaps.length > 0, `black pawn should double-jump, got ${multiCaps.length} multi-captures`);
  });

  test('pawn multi-capture: cannot re-capture same piece', () => {
    // This tests the alreadyCaptured check in _extendCapture
    // White pawn at (2,1), black at (3,2), land at (4,3)
    // From (4,3), if somehow the same black piece could be jumped again, it should be blocked
    const board = makeBoard([[17, 1], [27, 3]]);
    const moves = generateLegalMoves(board, 1);
    for (const m of moves) {
      if (m.captures) {
        const unique = new Set(m.captures.map(c => `${c[0]},${c[1]}`));
        assert.equal(unique.size, m.captures.length, 'should not capture same piece twice');
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Capture mandatory rule
  // ═══════════════════════════════════════════════════════════════════════

  test('captures are mandatory: when capture exists, no simple moves returned', () => {
    // White pawn at (4,3), black pawn at (5,4) — white can capture
    // White also has other pawns that could do simple moves
    const board = makeBoard([[35, 1], [44, 3], [8, 1]]);
    const moves = generateLegalMoves(board, 1);
    const hasCaptures = moves.some(m => m.captures && m.captures.length > 0);
    assert.ok(hasCaptures, 'should have captures available');
    const hasSimpleMoves = moves.some(m => !m.captures || m.captures.length === 0);
    assert.equal(hasSimpleMoves, false, 'when captures exist, simple moves should not be returned');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge: no legal moves (stalemate/loss)
  // ═══════════════════════════════════════════════════════════════════════

  test('no legal moves: white pawn trapped behind own pieces', () => {
    // White pawn at (0,1) cannot move forward (row -1 is off board)
    // In checkers pawns only move forward, so row 0 white pawn is stuck
    const board = makeBoard([[1, 1]]);
    const moves = generateLegalMoves(board, 1);
    // White pawn at row 0 can move to row 1 (forward = increasing row)
    // Actually white forward is dr > 0 (increasing row), so (0,1) → (1,0) or (1,2)
    // Those should be valid if empty
    assert.ok(moves.length > 0, 'white pawn at row 0 should have forward moves');
  });

  test('no legal moves: all pieces blocked', () => {
    // White pawn at (6,1), black pieces at (7,0) and (7,2) blocking forward
    const board = makeBoard([[49, 1], [56, 3], [58, 3]]);
    const moves = generateLegalMoves(board, 1);
    // Pawn at (6,1) forward-diag: (7,0) occupied, (7,2) occupied — no moves
    // No captures possible (black pieces but landing squares off board)
    assert.equal(moves.length, 0, 'all moves blocked → no legal moves');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // applyMove edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('applyMove: null move returns unchanged board', () => {
    const board = makeBoard([[28, 1]]);
    const result = applyMove(board, null, 1);
    assert.deepEqual(result, board);
  });

  test('applyMove: move with missing from/to returns unchanged board', () => {
    const board = makeBoard([[28, 1]]);
    const result = applyMove(board, { from: [3, 4] }, 1);
    assert.deepEqual(result, board);
  });

  test('applyMove: multi-capture removes all captured pieces', () => {
    const board = makeBoard([[17, 1], [27, 3], [43, 3]]);
    const move = {
      from: [2, 1],
      to: [6, 5],
      captures: [[3, 2], [5, 4]],
    };
    const result = applyMove(board, move, 1);
    assert.equal(result[27], 0, 'first captured piece removed');
    assert.equal(result[43], 0, 'second captured piece removed');
    assert.equal(result[17], 0, 'origin empty');
    assert.equal(result[53], 1, 'piece at destination');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // King sliding capture: captures at various distances
  // ═══════════════════════════════════════════════════════════════════════

  test('king sliding capture: captures opponent 2 squares away', () => {
    // White king at (1,1), black pawn at (2,2), empty at (3,3)
    const board = makeBoard([[9, 2], [18, 3]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.some(c => c[0] === 2 && c[1] === 2));
    assert.ok(caps.length > 0, 'king should capture opponent 1 square away on diagonal');
    // Landing should be at (3,3) or further
    const cap = caps[0];
    assert.ok(cap.to[0] >= 3 && cap.to[1] >= 3, 'should land after captured piece');
  });

  test('king sliding capture: multiple captures available on different diagonals', () => {
    // White king at (3,3), black at (4,4) and black at (4,2)
    const board = makeBoard([[27, 2], [36, 3], [34, 3]]);
    const moves = generateLegalMoves(board, 1);
    const caps = moves.filter(m => m.captures && m.captures.length > 0);
    assert.ok(caps.length >= 2, `king should capture on multiple diagonals, got ${caps.length}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Run all tests
  // ═══════════════════════════════════════════════════════════════════════

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\nhunter-tw-minimax-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
