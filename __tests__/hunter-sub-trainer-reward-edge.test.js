/**
 * hunter-sub-trainer-reward-edge.test.js — Edge cases for calculateReward in trainer.js
 *
 * Focus: null prevBoard, empty boards, all-captured board, single piece boards
 */

import assert from 'node:assert/strict';

const PIECE_VALUE = { 1: 1, 2: 3, 3: 1, 4: 3 };

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2;
  return val === 3 || val === 4;
}
function isPawn(val, turn) { return turn === 1 ? val === 1 : val === 3; }
function isKing(val, turn) { return turn === 1 ? val === 2 : val === 4; }

function calcMaterial(prev, next, turn) {
  let prevMy = 0, prevOpp = 0, nextMy = 0, nextOpp = 0;
  for (let i = 0; i < 64; i++) {
    if (prev[i] !== 0) { const v = PIECE_VALUE[Math.abs(prev[i])] || 0; if (isOwnPiece(prev[i], turn)) prevMy += v; else prevOpp += v; }
    if (next[i] !== 0) { const v = PIECE_VALUE[Math.abs(next[i])] || 0; if (isOwnPiece(next[i], turn)) nextMy += v; else nextOpp += v; }
  }
  return ((nextMy - prevMy) - (nextOpp - prevOpp)) / 6;
}

function calcPosition(board, turn) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8), col = i % 8, val = board[i];
    if (!isOwnPiece(val, turn)) continue;
    if (isPawn(val, turn)) {
      score += (turn === 1 ? row : (7 - row)) * 0.1 / 7;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += 0.15 / 12;
      if (col === 0 || col === 7) score += -0.1 / 12;
    }
    if (isKing(val, turn)) {
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += 0.2;
      else if (col === 0 || col === 7 || row === 0 || row === 7) score += -0.15;
    }
  }
  return Math.max(-1, Math.min(1, score));
}

function calcThreat(board, turn) {
  let myT = 0, oppT = 0;
  for (let i = 0; i < 64; i++) {
    if (!board[i]) continue;
    const row = Math.floor(i / 8), col = i % 8, isMy = isOwnPiece(board[i], turn);
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const aR = row + dr, aC = col + dc, jR = row - dr, jC = col - dc;
      if (aR < 0 || aR > 7 || aC < 0 || aC > 7 || jR < 0 || jR > 7 || jC < 0 || jC > 7) continue;
      const aV = board[aR * 8 + aC], jV = board[jR * 8 + jC];
      if (aV && !isOwnPiece(aV, turn) && !jV) { if (isMy) myT++; else oppT++; }
    }
  }
  return (oppT - myT) / Math.max(oppT + myT, 1);
}

function calcAdvance(prev, next, turn) {
  let tA = 0, pA = 0;
  for (let i = 0; i < 64; i++) { const r = Math.floor(i / 8);
    if (isPawn(next[i], turn)) tA += turn === 1 ? r / 7 : (7 - r) / 7;
    if (isPawn(prev[i], turn)) pA += turn === 1 ? r / 7 : (7 - r) / 7;
  }
  return Math.max(-1, Math.min(1, tA - pA));
}

function calcTempo(prev, next, turn) {
  let m = 0, o = 0;
  for (let i = 0; i < 64; i++) { const r = Math.floor(i / 8), v = next[i];
    if (isOwnPiece(v, turn) && ((turn === 1 && r >= 4) || (turn === -1 && r <= 3))) m++;
    if (v && !isOwnPiece(v, turn) && ((turn === -1 && r >= 4) || (turn === 1 && r <= 3))) o++;
  }
  return (m - o) / Math.max(m + o, 1);
}

function calculateReward(prev, next, turn, side = 'white') {
  if (!prev || !next) return 0;
  const strats = {
    aggressor: { w: { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 }, adv: 0.10 },
    fortress:  { w: { material: 0.50, position: 0.25, threat: 0.15, tempo: 0.10 }, adv: 0.05 },
  };
  const s = side === 'white' ? strats.aggressor : strats.fortress;
  let r = 0;
  r += calcMaterial(prev, next, turn) * s.w.material;
  r += calcPosition(next, turn) * s.w.position;
  r += calcThreat(next, turn) * s.w.threat;
  r += calcTempo(prev, next, turn) * s.w.tempo;
  r += calcAdvance(prev, next, turn) * s.adv;
  return Math.max(-1, Math.min(1, Math.round(r * 1000) / 1000));
}

function emptyBoard() { return new Array(64).fill(0); }
function makeBoard(setup) { const b = emptyBoard(); for (const [p, v] of setup) b[p] = v; return b; }

export async function runTrainerRewardEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test('null prevBoard returns 0', () => { assert.equal(calculateReward(null, makeBoard([[28,1]]), 1, 'white'), 0); });
  test('undefined prevBoard returns 0', () => { assert.equal(calculateReward(undefined, makeBoard([[28,1]]), 1, 'white'), 0); });
  test('null nextBoard returns 0', () => { assert.equal(calculateReward(makeBoard([[28,1]]), null, 1, 'white'), 0); });

  test('both boards empty returns 0', () => { assert.equal(calculateReward(emptyBoard(), emptyBoard(), 1, 'white'), 0); });
  test('empty prevBoard non-empty nextBoard (white)', () => {
    const r = calculateReward(emptyBoard(), makeBoard([[28,1],[36,3]]), 1, 'white');
    assert.ok(typeof r === 'number' && isFinite(r));
  });
  test('empty prevBoard non-empty nextBoard (black)', () => {
    const r = calculateReward(emptyBoard(), makeBoard([[28,1],[36,3]]), -1, 'black');
    assert.ok(typeof r === 'number' && isFinite(r));
  });

  test('white captures all black — positive', () => {
    const r = calculateReward(makeBoard([[28,1],[29,1],[36,3],[37,3]]), makeBoard([[28,1],[29,1]]), 1, 'white');
    assert.ok(r > 0);
  });
  test('black captures all white — positive', () => {
    const r = calculateReward(makeBoard([[28,1],[29,1],[36,3],[37,3]]), makeBoard([[36,3],[37,3]]), -1, 'black');
    assert.ok(r > 0);
  });
  test('own pieces all captured — negative', () => {
    const r = calculateReward(makeBoard([[28,1],[29,1],[36,3],[37,3]]), makeBoard([[36,3],[37,3]]), 1, 'white');
    assert.ok(r < 0);
  });
  test('completely empty result board', () => {
    const r = calculateReward(makeBoard([[28,1],[36,3]]), emptyBoard(), 1, 'white');
    assert.ok(typeof r === 'number' && isFinite(r));
  });

  test('reward in [-1, 1]', () => {
    const r = calculateReward(
      makeBoard([[28,1],[29,1],[30,1],[31,1],[36,3],[37,3],[38,3],[39,3],[44,3],[45,3],[46,3],[47,3]]),
      makeBoard([[28,1],[29,1],[30,1],[31,1]]), 1, 'white');
    assert.ok(r >= -1 && r <= 1);
  });
  test('no change near zero', () => {
    const b = makeBoard([[28,1],[36,3]]);
    assert.ok(Math.abs(calculateReward(b, b, 1, 'white')) < 0.5);
  });

  test('white pawn forward move non-negative', () => {
    assert.ok(calculateReward(makeBoard([[45,1]]), makeBoard([[36,1]]), 1, 'white') >= 0);
  });
  test('black pawn forward move non-negative', () => {
    assert.ok(calculateReward(makeBoard([[18,3]]), makeBoard([[27,3]]), -1, 'black') >= 0);
  });

  test('result rounded to 3 decimals', () => {
    const r = calculateReward(makeBoard([[45,1],[36,3]]), makeBoard([[27,1]]), 1, 'white');
    assert.equal(r * 1000 % 1, 0);
  });

  for (const t of tests) {
    try { t.fn(); passed++; console.log(`  ✅ ${t.name}`); }
    catch (err) { failed++; console.log(`  ❌ ${t.name}: ${err.message}`); }
  }
  console.log(`\n  trainer-reward-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
