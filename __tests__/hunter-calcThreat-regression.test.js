/**
 * hunter-calcThreat-regression.test.js — Regression tests for calcThreat double-counting fix.
 *
 * Covers bugs fixed in hunter alpha cycle:
 * - calcThreat returns correct values with both colors present
 * - No threats counted between same-color pieces (double-counting fix)
 * - Edge cases: empty board, only own pieces, only opponent pieces
 * - Edge piece positions — no out-of-bounds crash
 * - King vs pawn — threats counted correctly with direction filtering
 *
 * Extracted logic — mirrors server/ai/trainer.js calcThreat verbatim.
 */

import assert from 'node:assert/strict';

// ── Extracted helpers (mirrors server/ai/trainer.js) ────────────────────────

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2;
  return val === 3 || val === 4;
}

/**
 * calcThreat — EXACT copy from server/ai/trainer.js (post-fix).
 * Two branches: isMy → myThreats, else → oppThreats.
 * Double-counting fix: only count real cross-side threats.
 */
function calcThreat(board, turn) {
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
      if (isMy) {
        if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
          const oppVal = board[adjIdx];
          const oppAbsVal = Math.abs(oppVal);
          const oppIsKing = oppAbsVal === 2 || oppAbsVal === 4;
          if (!oppIsKing) {
            const oppIsWhite = oppVal > 0 && (oppAbsVal === 1 || oppAbsVal === 2);
            if (oppIsWhite && dr !== -1) continue;
            if (!oppIsWhite && dr !== 1) continue;
          }
          myThreats++;
        }
      } else {
        if (board[adjIdx] && isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
          const myVal = board[adjIdx];
          const myAbsVal = Math.abs(myVal);
          const myIsKing = myAbsVal === 2 || myAbsVal === 4;
          if (!myIsKing) {
            const myIsWhite = myVal > 0 && (myAbsVal === 1 || myAbsVal === 2);
            if (myIsWhite && dr !== 1) continue;
            if (!myIsWhite && dr !== -1) continue;
          }
          oppThreats++;
        }
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyBoard() { return new Array(64).fill(0); }
function idx(r, c) { return r * 8 + c; }

function runHunterCalcThreatRegressionTests() {
  let passed = 0, failed = 0;

  function test(name, fn) {
    try { fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}: ${err.message}`); failed++; }
  }

  console.log('\n── hunter-calcThreat-regression ──');

  // ── Correct values with both colors ───────────────────────────────────────

  test('calcThreat: black pawn below white → threat to white (myThreats=1)', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white pawn
    b[idx(5, 5)] = 3; // black pawn below
    // isMy=true, adj black at (5,5), dr=1. Black captures upward, must be below (dr=1) ✓ → myThreats=1
    // score = (0-1)/1 = -1
    assert.equal(calcThreat(b, 1), -1);
  });

  test('calcThreat: white pawn above black → threat to black (myThreats=1)', () => {
    const b = emptyBoard();
    b[idx(3, 3)] = 3; // black pawn
    b[idx(2, 2)] = 1; // white pawn above
    // isMy=true (black), adj white at (2,2), dr=-1. White captures downward, must be above (dr=-1) ✓
    // myThreats=1 → score = (0-1)/1 = -1
    assert.equal(calcThreat(b, -1), -1);
  });

  test('calcThreat: white pawn below black → can capture black (oppThreats=1)', () => {
    const b = emptyBoard();
    b[idx(3, 3)] = 3; // black pawn
    b[idx(4, 4)] = 1; // white pawn below
    // isMy=false (white is opponent), adj at (3,3)=black (own to turn=-1), dr=1.
    // My white pawn captures downward, must be below opponent (dr=1) ✓ → oppThreats=1
    // score = (1-0)/1 = +1
    assert.equal(calcThreat(b, -1), 1);
  });

  test('calcThreat: black pawn above white → can capture white (oppThreats=1)', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white pawn
    b[idx(3, 3)] = 3; // black pawn above
    // isMy=false (black is opponent), adj at (4,4)=white (own to turn=1), dr=-1.
    // My black pawn captures upward, must be above opponent (dr=-1) ✓ → oppThreats=1
    // score = (1-0)/1 = +1
    assert.equal(calcThreat(b, 1), 1);
  });

  test('calcThreat: black pawn below white is threat, black above is oppThreat → balanced', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white pawn
    b[idx(5, 5)] = 3; // black below → myThreats (black threatens white)
    b[idx(3, 3)] = 3; // black above → oppThreats (black captures white from above)
    // myThreats=1, oppThreats=1 → (1-1)/2 = 0
    assert.equal(calcThreat(b, 1), 0);
  });

  // ── No double-counting between same-color pieces ─────────────────────────

  test('calcThreat: two white pawns adjacent → no threats (isMy=true, adj own → skip)', () => {
    const b = emptyBoard();
    b[idx(2, 2)] = 1;
    b[idx(3, 3)] = 1;
    // isMy=true: adj is own → !isOwnPiece fails → skip
    // isMy=false never happens (both are own to turn=1)
    assert.equal(calcThreat(b, 1), 0);
  });

  test('calcThreat: two black pawns adjacent → no double-count from white turn', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 3;
    b[idx(5, 5)] = 3;
    // Both are opponent to white (turn=1). isMy=false for both.
    // Branch 2: adj at (5,5) is NOT own (isOwnPiece(3,1)=false) → skip
    // Branch 2: adj at (4,4) is NOT own → skip
    // No threats counted → 0
    assert.equal(calcThreat(b, 1), 0, 'same-color pieces must not create threats');
  });

  test('calcThreat: two white pawns adjacent → no double-count from black turn', () => {
    const b = emptyBoard();
    b[idx(3, 3)] = 1;
    b[idx(4, 4)] = 1;
    assert.equal(calcThreat(b, -1), 0, 'same-color pieces must not create threats');
  });

  test('calcThreat: chain of 3 same-color pieces → no threats', () => {
    const b = emptyBoard();
    b[idx(3, 3)] = 3;
    b[idx(4, 4)] = 3;
    b[idx(5, 5)] = 3;
    assert.equal(calcThreat(b, 1), 0);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  test('calcThreat: empty board → 0', () => {
    assert.equal(calcThreat(emptyBoard(), 1), 0);
    assert.equal(calcThreat(emptyBoard(), -1), 0);
  });

  test('calcThreat: only own pieces → 0', () => {
    const b = emptyBoard();
    b[idx(2, 2)] = 1;
    b[idx(2, 4)] = 2;
    b[idx(4, 2)] = 1;
    assert.equal(calcThreat(b, 1), 0);
  });

  test('calcThreat: only opponent pieces → 0 (no double-count)', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 3;
    b[idx(5, 5)] = 3;
    b[idx(6, 6)] = 4;
    assert.equal(calcThreat(b, 1), 0, 'opponent-only must be 0');
  });

  // ── Edge positions — no out-of-bounds crash ──────────────────────────────

  test('calcThreat: corner (0,0) — no crash', () => {
    const b = emptyBoard(); b[idx(0, 0)] = 1; b[idx(1, 1)] = 3;
    assert.ok(Number.isFinite(calcThreat(b, 1)));
  });

  test('calcThreat: corner (7,7) — no crash', () => {
    const b = emptyBoard(); b[idx(7, 7)] = 1; b[idx(6, 6)] = 3;
    assert.ok(Number.isFinite(calcThreat(b, 1)));
  });

  test('calcThreat: top edge row 0 — no crash', () => {
    const b = emptyBoard(); b[idx(0, 3)] = 1; b[idx(1, 2)] = 3; b[idx(1, 4)] = 3;
    assert.ok(Number.isFinite(calcThreat(b, 1)));
  });

  test('calcThreat: bottom edge row 7 — no crash', () => {
    const b = emptyBoard(); b[idx(7, 4)] = 3; b[idx(6, 3)] = 1; b[idx(6, 5)] = 1;
    assert.ok(Number.isFinite(calcThreat(b, -1)));
  });

  test('calcThreat: left edge col 0 — no crash', () => {
    const b = emptyBoard(); b[idx(3, 0)] = 1; b[idx(4, 1)] = 3;
    assert.ok(Number.isFinite(calcThreat(b, 1)));
  });

  test('calcThreat: right edge col 7 — no crash', () => {
    const b = emptyBoard(); b[idx(3, 7)] = 1; b[idx(4, 6)] = 3;
    assert.ok(Number.isFinite(calcThreat(b, 1)));
  });

  // ── King vs pawn — direction filtering ────────────────────────────────────

  test('calcThreat: king has no direction restriction — always threat if adjacent + jump clear', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white pawn
    b[idx(3, 3)] = 4; // black king above
    // isMy=true, adj black king, dr=-1. King → no direction check → myThreats=1
    assert.equal(calcThreat(b, 1), -1);
  });

  test('calcThreat: king captures from below (no restriction)', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white
    b[idx(5, 5)] = 4; // black king below
    assert.equal(calcThreat(b, 1), -1);
  });

  test('calcThreat: pawn direction matters — black below white is threat', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1;
    b[idx(5, 5)] = 3;
    // isMy=true, adj black below, dr=1. Black captures upward, must be below (dr=1) ✓
    assert.equal(calcThreat(b, 1), -1);
  });

  test('calcThreat: pawn direction — black above white creates oppThreat (captures upward)', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1;
    b[idx(3, 3)] = 3;
    // isMy=false (black at i), adj white at (4,4) own, dr=-1.
    // My black pawn captures upward, must be above opponent (dr=-1) ✓ → oppThreats=1
    assert.equal(calcThreat(b, 1), 1);
  });

  test('calcThreat: blocked jump square → no threat', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1;
    b[idx(5, 5)] = 3;
    b[idx(6, 6)] = 1; // blocks jump
    assert.equal(calcThreat(b, 1), 0);
  });

  // ── Complex boards ────────────────────────────────────────────────────────

  test('calcThreat: complex mixed board — correct threat count', () => {
    const b = emptyBoard();
    b[idx(2, 2)] = 1; // white pawn
    b[idx(2, 4)] = 2; // white king
    b[idx(3, 3)] = 3; // black pawn
    b[idx(5, 5)] = 3; // isolated black pawn
    // turn=1 (white):
    // isMy=true at (2,2): adj(3,3)=black below, dr=1. Black captures upward ✓ → myThreats++
    // isMy=true at (2,4): adj(3,3)=black below-left, dr=1,dc=-1. Black captures upward ✓ → myThreats++
    // isMy=false at (3,3): adj(2,2)=white own, dr=-1. My white captures downward, must be below (dr=1)... dr=-1 ≠ 1 → skip
    //   adj(2,4)=white king own, dr=-1,dc=1. King no restriction → oppThreats++
    // isMy=false at (5,5): no adj own pieces → skip
    // myThreats=2, oppThreats=1 → (1-2)/3 = -1/3
    assert.ok(Math.abs(calcThreat(b, 1) - (-1/3)) < 0.01);
  });

  test('calcThreat: multiple same-color threats + real cross threats', () => {
    const b = emptyBoard();
    b[idx(4, 4)] = 1; // white
    b[idx(5, 3)] = 3; // black below-left
    b[idx(5, 5)] = 3; // black below-right
    // Both black pawns below white → myThreats=2 (each captures upward)
    // No oppThreats (black pieces see white above, but white pawn captures downward, need dr=1 for opp branch)
    // Actually: isMy=false at (5,3): adj(4,4)=white own, dr=-1,dc=-1. My white captures downward (dr=1 needed). dr=-1 ≠ 1 → skip
    // isMy=false at (5,5): adj(4,4)=white own, dr=-1,dc=-1. Same → skip
    // myThreats=2, oppThreats=0 → (0-2)/2 = -1
    assert.equal(calcThreat(b, 1), -1);
  });

  // ── Return value properties ───────────────────────────────────────────────

  test('calcThreat: result always in [-1, 1]', () => {
    const b = emptyBoard();
    b[idx(2, 2)] = 1; b[idx(3, 1)] = 3; b[idx(3, 3)] = 3; b[idx(5, 5)] = 4;
    const r = calcThreat(b, 1);
    assert.ok(r >= -1 && r <= 1, `result ${r} not in [-1, 1]`);
  });

  test('calcThreat: no adjacent threats → exactly 0', () => {
    const b = emptyBoard();
    b[idx(0, 0)] = 1;
    b[idx(7, 7)] = 3;
    assert.equal(calcThreat(b, 1), 0);
  });

  console.log(`\n  Total: ${passed + failed} | ✅ ${passed} passed | ❌ ${failed} failed`);
  return { passed, failed };
}

export { runHunterCalcThreatRegressionTests };

if (process.argv[1]?.endsWith('hunter-calcThreat-regression.test.js')) {
  runHunterCalcThreatRegressionTests();
}
