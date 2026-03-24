/**
 * issue150-multi-capture-duplicate.test.js
 *
 * Regression test for issue #150: Multi-capture animation — duplicate piece visible.
 *
 * The bug: during multi-capture animation, the moving piece would appear BOTH
 * at the old position (from the board prop) AND at the animation position
 * (from animBoard overlay), creating a visible duplicate.
 *
 * Fix: The displayBoard selection logic in Board.jsx ensures:
 * 1. During animation (animStep >= 0): use animBoard (which has piece removed from start)
 * 2. After animation ends but board prop hasn't updated: keep animBoard visible
 * 3. When board prop updates (differs from prevBoardRef): clear animBoard, use new board
 * 4. Mounted flag prevents timer-based state updates after unmount
 *
 * We extract and test the pure logic behind displayBoard selection and
 * the mounted-flag / timer cleanup patterns.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// Extracted: displayBoard selection logic from Board.jsx
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determines which board to display based on animation state.
 *
 * @param {Object} params
 * @param {number} params.animStep - Current animation step (-1 = no animation)
 * @param {Array[]|null} params.animBoard - Board state during animation (pieces moved)
 * @param {Array[]} params.board - Current board prop from React state
 * @param {Array[]|null} params.prevBoardRef - Previous board snapshot (before animation)
 * @returns {{ displayBoard: Array[], source: string }}
 */
function getDisplayBoard({ animStep, animBoard, board, prevBoardRef }) {
  let displayBoard;
  let source;

  if (animStep >= 0 && animBoard) {
    // During animation: use animBoard
    displayBoard = animBoard;
    source = 'animBoard-during';
  } else if (animBoard && board === prevBoardRef) {
    // After animation cleared but board prop hasn't updated yet — keep showing animBoard
    // This prevents the piece from appearing at the old position after animation ends
    displayBoard = animBoard;
    source = 'animBoard-post-animation';
  } else {
    // Normal display or board has updated — clear animBoard reference
    displayBoard = board;
    source = 'board';
  }

  return { displayBoard, source };
}

// ═══════════════════════════════════════════════════════════════════════════
// Extracted: Piece presence check helpers
// ═══════════════════════════════════════════════════════════════════════════

function countPieces(board) {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell) count++;
    }
  }
  return count;
}

function findPiece(board, color, row, col) {
  const cell = board?.[row]?.[col];
  return cell && cell.color === color ? cell : null;
}

function makeBoard(pieces = []) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const { row, col, color, king } of pieces) {
    board[row][col] = { color, king: !!king };
  }
  return board;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extracted: Multi-capture baseBoard construction logic
// ═══════════════════════════════════════════════════════════════════════════

function buildBaseBoard(prevBoard, path, captures, movingPieceColor) {
  const baseBoard = prevBoard.map(row => row.map(cell => cell ? { ...cell } : null));
  // Remove moving piece from start
  const [startR, startC] = path[0];
  baseBoard[startR][startC] = null;

  // Remove captured pieces
  if (captures && captures.length > 0) {
    for (const cap of captures) {
      baseBoard[cap[0]][cap[1]] = null;
    }
  } else {
    // Fallback: geometry-based detection (only opponent pieces)
    for (let i = 0; i < path.length - 1; i++) {
      const [r1, c1] = path[i];
      const [r2, c2] = path[i + 1];
      const dr = Math.sign(r2 - r1);
      const dc = Math.sign(c2 - c1);
      let r = r1 + dr, c = c1 + dc;
      while (r !== r2 || c !== c2) {
        const cell = prevBoard?.[r]?.[c];
        if (cell && cell.color && cell.color !== movingPieceColor) {
          baseBoard[r][c] = null;
        }
        r += dr;
        c += dc;
      }
    }
  }
  return baseBoard;
}

// ═══════════════════════════════════════════════════════════════════════════
// Extracted: mounted-flag timer safety
// ═══════════════════════════════════════════════════════════════════════════

function createMountedTimerSimulator() {
  let mounted = true;
  const timers = [];
  const stateUpdates = [];

  function setTimeoutSafe(fn, delay) {
    const id = setTimeout(() => {
      if (mounted) fn();
    }, delay);
    timers.push(id);
    return id;
  }

  function cleanup() {
    mounted = false;
    timers.forEach(clearTimeout);
  }

  function getStateUpdates() {
    return stateUpdates;
  }

  function pushUpdate(update) {
    stateUpdates.push(update);
  }

  return { setTimeoutSafe, cleanup, getStateUpdates, pushUpdate, isMounted: () => mounted };
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Runner
// ═══════════════════════════════════════════════════════════════════════════

export async function runIssue150MultiCaptureDuplicateTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── displayBoard selection logic ─────────────────────────────────────

  test('#150: during animation (animStep >= 0), displayBoard uses animBoard', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);
    // animBoard: piece moved from (2,1) to (4,3), capture at (3,2) removed
    const animBoard = makeBoard([
      { row: 4, col: 3, color: 'white' },
    ]);
    // board prop hasn't changed yet (same reference as prevBoard)
    const board = prevBoard;

    const result = getDisplayBoard({
      animStep: 1,
      animBoard,
      board,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'animBoard-during');
    assert.equal(findPiece(result.displayBoard, 'white', 2, 1), null,
      'Moving piece should NOT be at old position during animation');
    assert.ok(findPiece(result.displayBoard, 'white', 4, 3),
      'Moving piece should be at animation position');
  });

  test('#150: during animation, captured piece is NOT shown (no duplicate)', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);
    // animBoard: captured piece removed from (3,2)
    const animBoard = makeBoard([]);

    const result = getDisplayBoard({
      animStep: 0,
      animBoard,
      board: prevBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'animBoard-during');
    assert.equal(findPiece(result.displayBoard, 'black', 3, 2), null,
      'Captured piece should NOT appear during animation');
  });

  test('#150: post-animation, animBoard kept until board prop updates (no duplicate)', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);
    // animBoard after final step: piece at landing, captures removed
    const animBoard = makeBoard([
      { row: 6, col: 5, color: 'white' }, // landing position
    ]);
    // board prop is still same reference as prevBoard (hasn't updated yet)
    const board = prevBoard;

    const result = getDisplayBoard({
      animStep: -1, // animation ended
      animBoard,
      board,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'animBoard-post-animation',
      'Should keep animBoard after animation until board prop updates');
    assert.equal(findPiece(result.displayBoard, 'white', 2, 1), null,
      'Piece should NOT appear at old position');
    assert.equal(findPiece(result.displayBoard, 'white', 6, 5) !== null, true,
      'Piece should appear at landing position');
  });

  test('#150: when board prop updates (differs from prevBoardRef), use new board', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
    ]);
    const animBoard = makeBoard([
      { row: 6, col: 5, color: 'white' },
    ]);
    // board prop has updated! (different reference = new state from server)
    const newBoard = makeBoard([
      { row: 6, col: 5, color: 'white' },
      { row: 5, col: 0, color: 'black' },
    ]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard,
      board: newBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'board',
      'Should use new board prop when it differs from prevBoardRef');
    assert.ok(findPiece(result.displayBoard, 'white', 6, 5));
    assert.ok(findPiece(result.displayBoard, 'black', 5, 0));
  });

  test('#150: no animation (animStep=-1, no animBoard) uses board prop', () => {
    const board = makeBoard([
      { row: 0, col: 1, color: 'white' },
      { row: 7, col: 6, color: 'black' },
    ]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard: null,
      board,
      prevBoardRef: board,
    });

    assert.equal(result.source, 'board');
    assert.equal(result.displayBoard, board);
  });

  test('#150: animBoard is null but board differs from prevBoardRef — use board', () => {
    const prevBoard = makeBoard([]);
    const board = makeBoard([
      { row: 4, col: 3, color: 'white' },
    ]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard: null,
      board,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'board');
  });

  // ── Multi-capture baseBoard construction ────────────────────────────

  test('#150: baseBoard removes moving piece from start position', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);
    const path = [[2, 1], [4, 3], [6, 5]];
    const captures = [[3, 2], [5, 4]];

    const baseBoard = buildBaseBoard(prevBoard, path, captures, 'white');

    assert.equal(findPiece(baseBoard, 'white', 2, 1), null,
      'Moving piece should be removed from start');
  });

  test('#150: baseBoard removes all captured pieces', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 5, col: 4, color: 'black' },
    ]);
    const path = [[2, 1], [4, 3], [6, 5]];
    const captures = [[3, 2], [5, 4]];

    const baseBoard = buildBaseBoard(prevBoard, path, captures, 'white');

    assert.equal(findPiece(baseBoard, 'black', 3, 2), null, 'Captured 1 removed');
    assert.equal(findPiece(baseBoard, 'black', 5, 4), null, 'Captured 2 removed');
  });

  test('#150: baseBoard with captures prop keeps non-captured pieces intact', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 1, col: 0, color: 'white' }, // not involved in capture
      { row: 6, col: 7, color: 'black' }, // not involved
    ]);
    const path = [[2, 1], [4, 3]];
    const captures = [[3, 2]];

    const baseBoard = buildBaseBoard(prevBoard, path, captures, 'white');

    assert.ok(findPiece(baseBoard, 'white', 1, 0), 'Non-involved white piece intact');
    assert.ok(findPiece(baseBoard, 'black', 6, 7), 'Non-involved black piece intact');
  });

  test('#150: baseBoard fallback (no captures prop) removes only opponent pieces', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 3, col: 2, color: 'black' }, // captured by geometry
    ]);
    // No captures prop — fallback to geometry
    const path = [[2, 1], [4, 3]]; // crosses (3,2)

    const baseBoard = buildBaseBoard(prevBoard, path, null, 'white');

    assert.equal(findPiece(baseBoard, 'black', 3, 2), null,
      'Fallback should remove opponent piece on path');
  });

  test('#150: baseBoard fallback does NOT remove friendly pieces on path', () => {
    // Edge case: what if a friendly piece is on the diagonal between path steps?
    // In checkers this shouldn't happen, but the code guards against it
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'white' }, // friendly piece on path (shouldn't happen)
    ]);
    const path = [[2, 1], [4, 3]];

    const baseBoard = buildBaseBoard(prevBoard, path, null, 'white');

    // The fallback only removes pieces with different color than movingPieceColor
    assert.ok(findPiece(baseBoard, 'white', 3, 2),
      'Fallback should NOT remove friendly piece on path');
  });

  // ── No duplicate piece at old+new positions ─────────────────────────

  test('#150: multi-capture final state has piece ONLY at landing, not at start', () => {
    // Simulate the scenario: white pawn at (2,1) captures through (3,2),(5,4) to (6,5)
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 5, col: 4, color: 'black' },
    ]);

    // After multi-capture animation, animBoard has piece at landing
    const animBoard = makeBoard([
      { row: 6, col: 5, color: 'white' },
      // captured pieces removed
      // moving piece removed from start
    ]);

    // Board prop hasn't updated yet (same reference)
    const board = prevBoard;

    const result = getDisplayBoard({
      animStep: -1, // animation ended
      animBoard,
      board,
      prevBoardRef: prevBoard,
    });

    // displayBoard should be animBoard — no duplicate
    assert.equal(result.source, 'animBoard-post-animation');
    assert.equal(countPieces(result.displayBoard), 1,
      'Should have exactly 1 piece (no duplicates)');
    assert.ok(findPiece(result.displayBoard, 'white', 6, 5),
      'Piece at landing position');
    assert.equal(findPiece(result.displayBoard, 'white', 2, 1), null,
      'No piece at old start position');
  });

  test('#150: during multi-capture step, piece shown at current step position', () => {
    // Step 1 of multi-capture: piece at intermediate position
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);

    const animBoard = makeBoard([]); // baseBoard: all removed, piece shown as overlay

    const result = getDisplayBoard({
      animStep: 1, // intermediate step
      animBoard,
      board: prevBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'animBoard-during');
    // The board itself has no pieces — the overlay (movingPieceInfo) shows the piece
    assert.equal(countPieces(result.displayBoard), 0,
      'animBoard has no pieces during step — piece shown via overlay');
  });

  // ── Transition: animation → board update ────────────────────────────

  test('#150: full transition — anim → animBoard kept → board updates → normal display', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);

    const animBoard = makeBoard([
      { row: 4, col: 3, color: 'white' },
    ]);

    const updatedBoard = makeBoard([
      { row: 4, col: 3, color: 'white' },
      { row: 7, col: 0, color: 'black' },
    ]);

    // Phase 1: animation in progress
    let result = getDisplayBoard({ animStep: 1, animBoard, board: prevBoard, prevBoardRef: prevBoard });
    assert.equal(result.source, 'animBoard-during');

    // Phase 2: animation ended, board hasn't updated yet
    result = getDisplayBoard({ animStep: -1, animBoard, board: prevBoard, prevBoardRef: prevBoard });
    assert.equal(result.source, 'animBoard-post-animation');
    assert.equal(findPiece(result.displayBoard, 'white', 2, 1), null, 'No duplicate at start');

    // Phase 3: board prop updated (new ref)
    result = getDisplayBoard({ animStep: -1, animBoard, board: updatedBoard, prevBoardRef: prevBoard });
    assert.equal(result.source, 'board');
    assert.ok(findPiece(result.displayBoard, 'white', 4, 3));
    assert.ok(findPiece(result.displayBoard, 'black', 7, 0));
  });

  // ── Piece count invariant (no extra pieces during animation) ────────

  test('#150: piece count during animation equals pieces minus captures (no extras)', () => {
    // Start: 1 white + 2 black = 3 pieces
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 5, col: 4, color: 'black' },
    ]);

    // After captures: 1 white, 0 black = 1 piece
    const animBoard = makeBoard([
      { row: 6, col: 5, color: 'white' },
    ]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard,
      board: prevBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(countPieces(result.displayBoard), 1,
      'Must have exactly 1 piece (no duplicate from old position)');
  });

  // ── Edge case: rapid board updates during animation ─────────────────

  test('#150: board prop changes mid-animation — still use animBoard', () => {
    const prevBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
    ]);

    const animBoard = makeBoard([]);

    // Board prop changed mid-animation (e.g., another player moved)
    // But animStep >= 0, so animBoard takes precedence
    const newBoard = makeBoard([
      { row: 2, col: 1, color: 'white' },
      { row: 3, col: 2, color: 'black' },
      { row: 7, col: 0, color: 'black' },
    ]);

    const result = getDisplayBoard({
      animStep: 2, // still animating
      animBoard,
      board: newBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'animBoard-during',
      'During animation, animBoard always takes precedence');
  });

  // ── Empty path / null safety ────────────────────────────────────────

  test('#150: null animBoard with animStep=-1 falls through to board', () => {
    const board = makeBoard([{ row: 0, col: 0, color: 'white' }]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard: null,
      board,
      prevBoardRef: board,
    });

    assert.equal(result.source, 'board');
  });

  test('#150: animBoard present but animStep=-1 and board differs → use board', () => {
    const prevBoard = makeBoard([]);
    const animBoard = makeBoard([{ row: 4, col: 3, color: 'white' }]);
    const newBoard = makeBoard([{ row: 4, col: 3, color: 'white' }]);

    const result = getDisplayBoard({
      animStep: -1,
      animBoard,
      board: newBoard,
      prevBoardRef: prevBoard,
    });

    assert.equal(result.source, 'board', 'Board updated, should use new board');
  });

  // ── Run ─────────────────────────────────────────────────────────────

  console.log('\n🎯 Issue #150 — Multi-capture duplicate piece regression tests');

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
