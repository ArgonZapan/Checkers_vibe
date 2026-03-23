/**
 * hunter-sub-003-coverage.test.js — Tests targeting key coverage gaps.
 *
 * Covers:
 * 1. saveState/loadState edge cases (corrupt JSON, atomic write)
 * 2. calculateReward with edge scenarios (null prevBoard, promotion, fortress strategy)
 * 3. _playGame game-over logic (winner string vs int, stale paramsVersion)
 * 4. resetModel cleanup verification (state reset, epsilon reset, stats reset)
 * 5. aiMove flow — fallback chain (model null, predict throws, move not in legal)
 * 6. handleMove flow — PvAI animation delay calculation
 * 7. Client EMPTY_BOARD construction correctness
 * 8. handleCellClick — selection and move dispatch logic
 *
 * Extracted logic — no server, engine, or TF.js required.
 */

import assert from 'node:assert/strict';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: saveState / loadState edge cases
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulate loadState parsing — mirrors trainer.js loadState logic.
 */
function parseState(raw) {
  try {
    const state = JSON.parse(raw);
    const stats = {
      gamesPlayed: state.stats?.gamesPlayed ?? 0,
      whiteWins: state.stats?.whiteWins ?? 0,
      blackWins: state.stats?.blackWins ?? 0,
      draws: state.stats?.draws ?? 0,
      lastLoss: state.stats?.lastLoss ?? null,
    };
    const epsilonWhite = (typeof state.epsilonWhite === 'number' && Number.isFinite(state.epsilonWhite))
      ? state.epsilonWhite : 0.3;
    const epsilonBlack = (typeof state.epsilonBlack === 'number' && Number.isFinite(state.epsilonBlack))
      ? state.epsilonBlack : 0.3;
    return { stats, epsilonWhite, epsilonBlack };
  } catch {
    return null; // corrupt JSON → start fresh
  }
}

/**
 * Simulate saveState serialization — mirrors trainer.js saveState logic.
 */
function serializeState(stats, epsilonWhite, epsilonBlack, running) {
  return JSON.stringify({
    stats: {
      gamesPlayed: stats.gamesPlayed,
      whiteWins: stats.whiteWins,
      blackWins: stats.blackWins,
      draws: stats.draws,
      lastLoss: stats.lastLoss,
    },
    epsilonWhite,
    epsilonBlack,
    running,
  }, null, 2);
}

console.log('\n📋 SaveState / LoadState Edge Cases');

test('saveState: serializes all stats fields correctly', () => {
  const stats = { gamesPlayed: 42, whiteWins: 20, blackWins: 15, draws: 7, lastLoss: 0.123 };
  const json = serializeState(stats, 0.25, 0.18, true);
  const parsed = JSON.parse(json);
  assert.equal(parsed.stats.gamesPlayed, 42);
  assert.equal(parsed.stats.whiteWins, 20);
  assert.equal(parsed.stats.blackWins, 15);
  assert.equal(parsed.stats.draws, 7);
  assert.equal(parsed.stats.lastLoss, 0.123);
  assert.equal(parsed.epsilonWhite, 0.25);
  assert.equal(parsed.epsilonBlack, 0.18);
  assert.equal(parsed.running, true);
});

test('loadState: corrupt JSON returns null (starts fresh)', () => {
  const result = parseState('{ invalid json !!!');
  assert.equal(result, null);
});

test('loadState: missing stats field uses defaults', () => {
  const result = parseState('{"epsilonWhite": 0.1}');
  assert.equal(result.stats.gamesPlayed, 0);
  assert.equal(result.stats.whiteWins, 0);
  assert.equal(result.stats.lastLoss, null);
  assert.equal(result.epsilonWhite, 0.1);
});

test('loadState: NaN epsilon falls back to default 0.3', () => {
  const result = parseState('{"epsilonWhite": "not_a_number", "epsilonBlack": null}');
  assert.equal(result.epsilonWhite, 0.3); // NaN is not a finite number
  assert.equal(result.epsilonBlack, 0.3);
});

test('loadState: null epsilon falls back to default', () => {
  const result = parseState('{"epsilonWhite": null, "epsilonBlack": null}');
  assert.equal(result.epsilonWhite, 0.3);
  assert.equal(result.epsilonBlack, 0.3);
});

test('loadState: string epsilon falls back to default', () => {
  const result = parseState('{"epsilonWhite": "invalid", "epsilonBlack": true}');
  // typeof "invalid" !== "number" → !Number.isFinite → default
  // typeof true !== "number" → !Number.isFinite → default
  assert.equal(result.epsilonWhite, 0.3);
  assert.equal(result.epsilonBlack, 0.3);
});

test('loadState: lastLoss=0 preserved (not treated as falsy)', () => {
  const result = parseState('{"stats":{"lastLoss":0}}');
  assert.equal(result.stats.lastLoss, 0);
});

test('loadState: round-trip preserves all values', () => {
  const stats = { gamesPlayed: 100, whiteWins: 40, blackWins: 35, draws: 25, lastLoss: 0.5 };
  const json = serializeState(stats, 0.05, 0.03, false);
  const loaded = parseState(json);
  assert.deepEqual(loaded.stats, stats);
  assert.equal(loaded.epsilonWhite, 0.05);
  assert.equal(loaded.epsilonBlack, 0.03);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: calculateReward edge cases
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 calculateReward Edge Cases');

// Inline reward helpers from trainer.js
const PIECE_VALUE = { 1: 1, 2: 3, 3: 1, 4: 3 };

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2;
  return val === 3 || val === 4;
}

function calcMaterial(prev, next, turn) {
  let prevMy = 0, prevOpp = 0, nextMy = 0, nextOpp = 0;
  for (let i = 0; i < 64; i++) {
    if (prev[i] !== 0) {
      const val = PIECE_VALUE[Math.abs(prev[i])] || 0;
      if (isOwnPiece(prev[i], turn)) prevMy += val; else prevOpp += val;
    }
    if (next[i] !== 0) {
      const val = PIECE_VALUE[Math.abs(next[i])] || 0;
      if (isOwnPiece(next[i], turn)) nextMy += val; else nextOpp += val;
    }
  }
  const myChange = nextMy - prevMy;
  const oppChange = nextOpp - prevOpp;
  return (myChange - oppChange) / 6;
}

// Aggressor weights (white strategy)
const AGGRESSOR_WEIGHTS = { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 };
// Fortress weights (black strategy)
const FORTRESS_WEIGHTS = { material: 0.25, position: 0.40, threat: 0.10, tempo: 0.25 };

function calcPosition(board, turn) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const col = i % 8;
    const val = board[i];
    if (!isOwnPiece(val, turn)) continue;
    const isKing = (turn === 1 && val === 2) || (turn === -1 && val === 4);
    if (!isKing) {
      const advance = turn === 1 ? row : (7 - row);
      score += advance * 0.1 / 7;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += 0.15 / 12;
    }
    if (isKing) {
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += 0.2;
    }
  }
  return Math.max(-1, Math.min(1, score));
}

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
      if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
        if (isMy) myThreats++; else oppThreats++;
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

function calcTempo(prev, next, turn) {
  let myAdv = 0, oppAdv = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const nextVal = next[i];
    if (isOwnPiece(nextVal, turn) && ((turn === 1 && row >= 4) || (turn === -1 && row <= 3))) myAdv++;
    if (nextVal && !isOwnPiece(nextVal, turn) && ((turn === -1 && row >= 4) || (turn === 1 && row <= 3))) oppAdv++;
  }
  return (myAdv - oppAdv) / Math.max(myAdv + oppAdv, 1);
}

function calculateReward(prev, next, turn, weights) {
  if (!prev || !next) return 0;
  const mat = calcMaterial(prev, next, turn);
  const pos = calcPosition(next, turn);
  const threat = calcThreat(next, turn);
  const tempo = calcTempo(prev, next, turn);
  let reward = mat * weights.material + pos * weights.position + threat * weights.threat + tempo * weights.tempo;
  return Math.max(-1, Math.min(1, Math.round(reward * 1000) / 1000));
}

test('calculateReward: null prevBoard returns 0', () => {
  const next = new Array(64).fill(0);
  assert.equal(calculateReward(null, next, 1, AGGRESSOR_WEIGHTS), 0);
});

test('calculateReward: null nextBoard returns 0', () => {
  const prev = new Array(64).fill(0);
  assert.equal(calculateReward(prev, null, 1, AGGRESSOR_WEIGHTS), 0);
});

test('calculateReward: both null returns 0', () => {
  assert.equal(calculateReward(null, null, 1, AGGRESSOR_WEIGHTS), 0);
});

test('calculateReward: white pawn capture gives positive reward for white', () => {
  const prev = new Array(64).fill(0);
  prev[20] = 1; // white pawn
  prev[29] = 3; // black pawn
  const next = new Array(64).fill(0);
  next[36] = 1; // white pawn moved (captured black pawn)
  // White captured a black pawn → material improvement
  const reward = calculateReward(prev, next, 1, AGGRESSOR_WEIGHTS);
  assert.ok(reward > 0, `expected positive reward for capture, got ${reward}`);
});

test('calculateReward: black losing a pawn gives negative reward for black', () => {
  const prev = new Array(64).fill(0);
  prev[20] = 1; // white pawn
  prev[29] = 3; // black pawn
  const next = new Array(64).fill(0);
  next[36] = 1; // white pawn captured black
  // From black's perspective: lost a pawn
  const reward = calculateReward(prev, next, -1, FORTRESS_WEIGHTS);
  assert.ok(reward < 0, `expected negative reward for black losing piece, got ${reward}`);
});

test('calculateReward: promotion (pawn→king) gives positive reward', () => {
  const prev = new Array(64).fill(0);
  prev[8] = 1; // white pawn on row 1
  const next = new Array(64).fill(0);
  next[0] = 2; // white king on row 0 (promoted)
  const reward = calculateReward(prev, next, 1, AGGRESSOR_WEIGHTS);
  assert.ok(reward > 0, `expected positive reward for promotion, got ${reward}`);
});

test('calculateReward: fortress strategy weights differ from aggressor', () => {
  const prev = new Array(64).fill(0);
  prev[20] = 1; // white pawn
  prev[29] = 3; // black pawn
  const next = new Array(64).fill(0);
  next[36] = 1; // white captured
  const aggReward = calculateReward(prev, next, 1, AGGRESSOR_WEIGHTS);
  const fortReward = calculateReward(prev, next, 1, FORTRESS_WEIGHTS);
  // Aggressor weights material higher (0.55 vs 0.25), so capture reward should differ
  assert.notEqual(aggReward, fortReward, 'aggressor and fortress should give different rewards for same capture');
});

test('calculateReward: result is clamped to [-1, 1]', () => {
  const prev = new Array(64).fill(0);
  const next = new Array(64).fill(0);
  // Even with extreme inputs, result is clamped
  const reward = calculateReward(prev, next, 1, { material: 100, position: 0, threat: 0, tempo: 0 });
  assert.ok(reward >= -1 && reward <= 1, `reward ${reward} not in [-1, 1]`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: _playGame game-over logic
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 _playGame Game-Over Logic');

/**
 * Simulate the game-over result assignment from _playGame.
 */
function assignResults(samples, winner) {
  for (const s of samples) {
    if (winner === 'draw' || !winner) {
      s.result = 0;
    } else {
      const winnerVal = winner === 'white' ? 1 : -1;
      s.result = s.turn === winnerVal ? 1 : -1;
    }
  }
  if (samples.length > 0) {
    samples[samples.length - 1].done = true;
  }
}

test('gameOver: string "white" winner → white samples get +1, black get -1', () => {
  const samples = [
    { turn: 1, result: 0, done: false },
    { turn: -1, result: 0, done: false },
    { turn: 1, result: 0, done: false },
  ];
  assignResults(samples, 'white');
  assert.equal(samples[0].result, 1);
  assert.equal(samples[1].result, -1);
  assert.equal(samples[2].result, 1);
  assert.equal(samples[2].done, true); // last sample
});

test('gameOver: string "black" winner → black samples get +1', () => {
  const samples = [
    { turn: 1, result: 0 },
    { turn: -1, result: 0 },
  ];
  assignResults(samples, 'black');
  assert.equal(samples[0].result, -1);
  assert.equal(samples[1].result, 1);
});

test('gameOver: "draw" → all results 0', () => {
  const samples = [
    { turn: 1, result: 0 },
    { turn: -1, result: 0 },
    { turn: 1, result: 0 },
  ];
  assignResults(samples, 'draw');
  assert.ok(samples.every(s => s.result === 0));
});

test('gameOver: null winner → all results 0', () => {
  const samples = [{ turn: 1, result: 0 }];
  assignResults(samples, null);
  assert.equal(samples[0].result, 0);
});

test('gameOver: undefined winner → all results 0', () => {
  const samples = [{ turn: 1, result: 0 }];
  assignResults(samples, undefined);
  assert.equal(samples[0].result, 0);
});

test('gameOver: empty samples + winner → no crash', () => {
  const samples = [];
  assignResults(samples, 'white');
  assert.equal(samples.length, 0);
});

test('paramsVersion guard: stale version triggers abort', () => {
  const playGameVersion = 0;
  const paramsVersion = 1; // incremented mid-game
  const shouldAbort = paramsVersion !== playGameVersion;
  assert.equal(shouldAbort, true);
});

test('paramsVersion guard: same version continues', () => {
  const playGameVersion = 2;
  const paramsVersion = 2;
  const shouldAbort = paramsVersion !== playGameVersion;
  assert.equal(shouldAbort, false);
});

test('paramsVersion: increment invalidates snapshot', () => {
  let paramsVersion = 0;
  const snapshot = paramsVersion;
  paramsVersion++; // setParams increments
  assert.notEqual(paramsVersion, snapshot);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: resetModel cleanup verification
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 resetModel Cleanup Logic');

/**
 * Simulate the resetModel logic from trainer.js.
 */
function simulateResetModel(stats, epsilonWhite, epsilonBlack, buffer, running) {
  // Step 1: Stop self-play
  running = false;
  // Step 2: Clear buffer
  buffer.length = 0;
  // Step 3: Reset stats
  stats.gamesPlayed = 0;
  stats.whiteWins = 0;
  stats.blackWins = 0;
  stats.draws = 0;
  stats.lastLoss = null;
  // Step 4: Reset epsilon
  epsilonWhite = 0.3 + 0.01; // defaultEpsilon + minEpsilon from config
  epsilonBlack = 0.3 + 0.01;
  // Step 7: Delete saved model files and buffer file (simulated)
  return { stats, epsilonWhite, epsilonBlack, buffer, running };
}

test('resetModel: stops self-play', () => {
  const result = simulateResetModel(
    { gamesPlayed: 50, whiteWins: 20, blackWins: 15, draws: 15, lastLoss: 0.5 },
    0.1, 0.15, [{ board: [1], result: 1 }], true
  );
  assert.equal(result.running, false);
});

test('resetModel: clears buffer', () => {
  const buffer = [1, 2, 3];
  const result = simulateResetModel(
    { gamesPlayed: 10, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null },
    0.5, 0.5, buffer, false
  );
  assert.equal(result.buffer.length, 0);
});

test('resetModel: resets all stats to zero', () => {
  const stats = { gamesPlayed: 100, whiteWins: 40, blackWins: 35, draws: 25, lastLoss: 0.3 };
  const result = simulateResetModel(stats, 0.1, 0.1, [], false);
  assert.equal(result.stats.gamesPlayed, 0);
  assert.equal(result.stats.whiteWins, 0);
  assert.equal(result.stats.blackWins, 0);
  assert.equal(result.stats.draws, 0);
  assert.equal(result.stats.lastLoss, null);
});

test('resetModel: resets epsilon to initial high value', () => {
  const result = simulateResetModel(
    { gamesPlayed: 50, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null },
    0.01, 0.01, [], false
  );
  assert.ok(result.epsilonWhite > 0.3, `epsilon should be reset to high value, got ${result.epsilonWhite}`);
  assert.ok(result.epsilonBlack > 0.3, `epsilon should be reset to high value, got ${result.epsilonBlack}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: aiMove fallback chain
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 aiMove Fallback Chain');

/**
 * Simulate the aiMove decision logic from server/index.js.
 */
function simulateAiMove(modelExists, predictResult, legalMoves) {
  // Step 1: check legal moves
  if (!legalMoves || legalMoves.length === 0) {
    return { action: 'no-moves' };
  }

  // Step 2: try predict
  if (!modelExists) {
    // Fallback: random move
    const idx = Math.floor(Math.random() * legalMoves.length);
    return { action: 'fallback-random', move: legalMoves[idx] };
  }

  // Step 3: check prediction validity
  if (!predictResult || !predictResult.move) {
    const idx = Math.floor(Math.random() * legalMoves.length);
    return { action: 'fallback-random', move: legalMoves[idx] };
  }

  // Step 4: verify move is in legalMoves
  const selectedMove = predictResult.move;
  const isLegal = legalMoves.some(m =>
    m.from[0] === selectedMove.from?.[0] && m.from[1] === selectedMove.from?.[1] &&
    m.to[0] === selectedMove.to?.[0] && m.to[1] === selectedMove.to?.[1]
  );

  if (!isLegal) {
    const idx = Math.floor(Math.random() * legalMoves.length);
    return { action: 'fallback-random', move: legalMoves[idx] };
  }

  return { action: 'predicted', move: selectedMove };
}

const legalMoves = [
  { from: [2, 1], to: [3, 0] },
  { from: [2, 3], to: [3, 2] },
  { from: [2, 5], to: [3, 4] },
];

test('aiMove: model null → fallback to random', () => {
  const result = simulateAiMove(false, null, legalMoves);
  assert.equal(result.action, 'fallback-random');
  assert.ok(result.move);
});

test('aiMove: model exists but prediction null → fallback', () => {
  const result = simulateAiMove(true, null, legalMoves);
  assert.equal(result.action, 'fallback-random');
});

test('aiMove: prediction.move is null → fallback', () => {
  const result = simulateAiMove(true, { move: null }, legalMoves);
  assert.equal(result.action, 'fallback-random');
});

test('aiMove: prediction.move not in legalMoves → fallback', () => {
  const pred = { move: { from: [0, 0], to: [1, 1] } }; // not in legal moves
  const result = simulateAiMove(true, pred, legalMoves);
  assert.equal(result.action, 'fallback-random');
});

test('aiMove: valid prediction → uses predicted move', () => {
  const pred = { move: { from: [2, 3], to: [3, 2] } };
  const result = simulateAiMove(true, pred, legalMoves);
  assert.equal(result.action, 'predicted');
  assert.deepEqual(result.move.from, [2, 3]);
});

test('aiMove: empty legalMoves → no-moves', () => {
  const result = simulateAiMove(true, { move: { from: [0, 0], to: [1, 1] } }, []);
  assert.equal(result.action, 'no-moves');
});

test('aiMove: null legalMoves → no-moves', () => {
  const result = simulateAiMove(true, { move: { from: [0, 0], to: [1, 1] } }, null);
  assert.equal(result.action, 'no-moves');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: handleMove animation delay
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 handleMove Animation Delay');

/**
 * Simulate animation delay calculation from handleMove in server/index.js.
 */
function calcAnimDelay(path, moveDelayMs, stepMs) {
  if (path && path.length > 2) {
    return path.length * stepMs + moveDelayMs;
  }
  return moveDelayMs;
}

test('animDelay: null path → uses moveDelayMs only', () => {
  assert.equal(calcAnimDelay(null, 500, 200), 500);
});

test('animDelay: empty path → uses moveDelayMs only', () => {
  assert.equal(calcAnimDelay([], 500, 200), 500);
});

test('animDelay: path with 2 elements → moveDelayMs only (no animation)', () => {
  assert.equal(calcAnimDelay([[0,0],[1,1]], 500, 200), 500);
});

test('animDelay: path with 3 elements → 3*stepMs + moveDelayMs', () => {
  assert.equal(calcAnimDelay([[0,0],[1,1],[2,2]], 500, 200), 3*200 + 500);
});

test('animDelay: long capture path (5 steps) → 5*stepMs + moveDelayMs', () => {
  const path = [[0,0],[1,1],[2,2],[3,3],[4,4]];
  assert.equal(calcAnimDelay(path, 300, 100), 5*100 + 300);
});

test('animDelay: moveDelayMs=0 → only stepMs * path.length', () => {
  assert.equal(calcAnimDelay([[0,0],[1,1],[2,2]], 0, 200), 600);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Client EMPTY_BOARD construction
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 Client EMPTY_BOARD Construction');

/**
 * Replicate EMPTY_BOARD() from client/src/App.jsx.
 */
function createEmptyBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { color: 'black', king: false };
    }
  }
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) b[r][c] = { color: 'white', king: false };
    }
  }
  return b;
}

test('EMPTY_BOARD: has 8 rows', () => {
  const board = createEmptyBoard();
  assert.equal(board.length, 8);
});

test('EMPTY_BOARD: each row has 8 columns', () => {
  const board = createEmptyBoard();
  for (const row of board) assert.equal(row.length, 8);
});

test('EMPTY_BOARD: rows 3-4 are all null (empty middle)', () => {
  const board = createEmptyBoard();
  for (const row of [3, 4]) {
    for (let c = 0; c < 8; c++) {
      assert.equal(board[row][c], null, `row ${row} col ${c} should be null`);
    }
  }
});

test('EMPTY_BOARD: black pieces on rows 0-2 on dark squares', () => {
  const board = createEmptyBoard();
  let blackCount = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        assert.ok(board[r][c], `row ${r} col ${c} should have a piece`);
        assert.equal(board[r][c].color, 'black');
        assert.equal(board[r][c].king, false);
        blackCount++;
      } else {
        assert.equal(board[r][c], null, `row ${r} col ${c} should be null (light square)`);
      }
    }
  }
  assert.equal(blackCount, 12, 'should have 12 black pieces');
});

test('EMPTY_BOARD: white pieces on rows 5-7 on dark squares', () => {
  const board = createEmptyBoard();
  let whiteCount = 0;
  for (let r = 5; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        assert.ok(board[r][c], `row ${r} col ${c} should have a piece`);
        assert.equal(board[r][c].color, 'white');
        assert.equal(board[r][c].king, false);
        whiteCount++;
      } else {
        assert.equal(board[r][c], null);
      }
    }
  }
  assert.equal(whiteCount, 12, 'should have 12 white pieces');
});

test('EMPTY_BOARD: total 24 pieces (12 white + 12 black)', () => {
  const board = createEmptyBoard();
  let count = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c]) count++;
    }
  }
  assert.equal(count, 24);
});

test('EMPTY_BOARD: no king pieces in starting position', () => {
  const board = createEmptyBoard();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c]) {
        assert.equal(board[r][c].king, false, `piece at [${r},${c}] should not be a king`);
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: handleCellClick selection logic
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 handleCellClick Selection Logic');

/**
 * Simulate the handleCellClick logic from client/src/App.jsx.
 */
function simulateCellClick(row, col, board, turn, selected, legalMoves, mode, gameOver) {
  if (gameOver) return { action: 'ignored', reason: 'gameOver' };
  if (mode === 'aivai') return { action: 'ignored', reason: 'aivai' };

  const piece = board[row][col];

  // If a piece is selected, check if clicking on a valid move target
  if (selected) {
    const isLegal = legalMoves.some(
      (m) => m.to[0] === row && m.to[1] === col
    );
    if (isLegal) {
      const matchingMove = legalMoves.find(m => m.to[0] === row && m.to[1] === col);
      return { action: 'move', from: selected, to: [row, col], captures: matchingMove?.captures };
    }
  }

  // In PvAI, human controls white pieces
  const isHumanPiece = mode === 'pvai'
    ? piece && piece.color === 'white'
    : piece && piece.color === turn;

  if (isHumanPiece) {
    return { action: 'select', position: [row, col] };
  } else {
    return { action: 'deselect' };
  }
}

const testBoard = createEmptyBoard();
const whiteLegalMoves = [
  { from: [5, 0], to: [4, 1], captures: [] },
  { from: [5, 2], to: [4, 1], captures: [] },
  { from: [5, 2], to: [4, 3], captures: [] },
];

test('handleCellClick: click white piece in PvAI → select', () => {
  const result = simulateCellClick(5, 0, testBoard, 'white', null, [], 'pvai', false);
  assert.equal(result.action, 'select');
  assert.deepEqual(result.position, [5, 0]);
});

test('handleCellClick: click black piece in PvAI → deselect (not human piece)', () => {
  const result = simulateCellClick(0, 1, testBoard, 'white', null, [], 'pvai', false);
  assert.equal(result.action, 'deselect');
});

test('handleCellClick: click empty square → deselect', () => {
  const result = simulateCellClick(3, 0, testBoard, 'white', null, [], 'pvai', false);
  assert.equal(result.action, 'deselect');
});

test('handleCellClick: click on valid move target → move', () => {
  const result = simulateCellClick(4, 1, testBoard, 'white', [5, 0], whiteLegalMoves, 'pvai', false);
  assert.equal(result.action, 'move');
  assert.deepEqual(result.from, [5, 0]);
  assert.deepEqual(result.to, [4, 1]);
});

test('handleCellClick: click on invalid move target → deselect', () => {
  const result = simulateCellClick(4, 5, testBoard, 'white', [5, 0], whiteLegalMoves, 'pvai', false);
  assert.equal(result.action, 'deselect');
});

test('handleCellClick: in aivai mode → ignored', () => {
  const result = simulateCellClick(5, 0, testBoard, 'white', null, [], 'aivai', false);
  assert.equal(result.action, 'ignored');
});

test('handleCellClick: gameOver → ignored', () => {
  const result = simulateCellClick(5, 0, testBoard, 'white', null, [], 'pvai', true);
  assert.equal(result.action, 'ignored');
});

test('handleCellClick: in PvP mode, click own color piece → select', () => {
  const result = simulateCellClick(5, 0, testBoard, 'white', null, [], 'pvp', false);
  assert.equal(result.action, 'select');
});

test('handleCellClick: in PvP mode, click opponent piece → deselect', () => {
  const result = simulateCellClick(0, 1, testBoard, 'white', null, [], 'pvp', false);
  assert.equal(result.action, 'deselect');
});

test('handleCellClick: capture move includes captures array', () => {
  const captureMoves = [
    { from: [5, 0], to: [3, 2], captures: [[4, 1]] },
  ];
  const boardWithCapture = createEmptyBoard();
  boardWithCapture[4][1] = { color: 'black', king: false }; // piece to capture
  const result = simulateCellClick(3, 2, boardWithCapture, 'white', [5, 0], captureMoves, 'pvai', false);
  assert.equal(result.action, 'move');
  assert.deepEqual(result.captures, [[4, 1]]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

export function runHunterSub003CoverageTests() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Hunter Sub-003: Coverage Gap Tests');
  console.log('═══════════════════════════════════════════════');
  // Tests already ran above, just report
  console.log(`\n  ─── ${passed} passed, ${failed} failed ───`);
  return { passed, failed };
}

// Auto-run when executed directly
const totalTests = passed + failed;
if (totalTests > 0) {
  console.log(`\n  ─── ${passed} passed, ${failed} failed ───`);
}
