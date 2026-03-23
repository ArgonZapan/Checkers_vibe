import { createModel, predict, train, saveModel, computePolicyIndex } from './model.js';
import { ReplayBuffer } from './buffer.js';
import { minimaxSearch, applyMove, generateLegalMoves, evaluate } from './minimax.js';
import { writeFile, readFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../config.js';
import { boardFromCpp } from '../boardConvert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Shaped Reward Calculation ────────────────────────────────────────────────

function flattenBoard(board) {
  if (!Array.isArray(board)) return null;
  if (board.length === 64 && !Array.isArray(board[0])) return [...board];
  if (board.length === 8 && Array.isArray(board[0])) return board.flat();
  return null;
}

function isOwnPiece(val, turn) {
  if (turn === 1) return val === 1 || val === 2; // white
  return val === 3 || val === 4;                  // black
}

function isPawn(val, turn) {
  return turn === 1 ? val === 1 : val === 3;
}

function isKing(val, turn) {
  return turn === 1 ? val === 2 : val === 4;
}

// ── Piece Values ─────────────────────────────────────────────────────────────
const PIECE_VALUE = { 1: 1, 2: 3, 3: 1, 4: 3 }; // C++ encoding → value: 1=white pawn(1), 2=white king(3), 3=black pawn(1), 4=black king(3)

// ── Helper: calcMaterial ─────────────────────────────────────────────────────
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
  return (myChange - oppChange) / 6; // normalize to [-1, 1]
}

// ── Helper: calcPosition ─────────────────────────────────────────────────────
function calcPosition(board, turn) {
  let score = 0;
  const PAWN_ADVANCE = 0.1;
  const CENTER_BONUS = 0.15;
  const EDGE_PENALTY = -0.1;
  const KING_CENTER = 0.2;
  const KING_EDGE = -0.15;

  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const col = i % 8;
    const val = board[i];
    if (!isOwnPiece(val, turn)) continue;

    // Pawn advancement
    if (isPawn(val, turn)) {
      const advance = turn === 1 ? row : (7 - row);
      score += advance * PAWN_ADVANCE / 7;
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += CENTER_BONUS / 12;
      if (col === 0 || col === 7) score += EDGE_PENALTY / 12;
    }
    // King position
    if (isKing(val, turn)) {
      if (col >= 2 && col <= 5 && row >= 2 && row <= 5) score += KING_CENTER;
      else if (col === 0 || col === 7 || row === 0 || row === 7) score += KING_EDGE;
    }
  }
  return Math.max(-1, Math.min(1, score));
}

// ── Helper: calcThreat ───────────────────────────────────────────────────────
function calcThreat(board, turn) {
  let myThreats = 0, oppThreats = 0;
  // Simplified: check if pieces have opponent pieces adjacent that could capture
  for (let i = 0; i < 64; i++) {
    if (!board[i]) continue;
    const row = Math.floor(i / 8);
    const col = i % 8;
    const isMy = isOwnPiece(board[i], turn);
    // Check diagonals for opponent pieces that could capture this piece
    for (const [dr, dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const adjR = row + dr, adjC = col + dc;
      const jumpR = row - dr, jumpC = col - dc;
      if (adjR < 0 || adjR > 7 || adjC < 0 || adjC > 7) continue;
      if (jumpR < 0 || jumpR > 7 || jumpC < 0 || jumpC > 7) continue;
      const adjIdx = adjR * 8 + adjC;
      const jumpIdx = jumpR * 8 + jumpC;
      if (board[adjIdx] && !isOwnPiece(board[adjIdx], turn) && !board[jumpIdx]) {
        // Check if opponent pawn can actually capture in this direction
        // Pawns can only capture forward: white captures downward (+row), black captures upward (-row)
        // dr is direction from us to opponent; opponent captures toward us if direction matches
        const oppVal = board[adjIdx];
        const oppAbsVal = Math.abs(oppVal);
        const oppIsKing = oppAbsVal === 2 || oppAbsVal === 4;
        if (!oppIsKing) {
          const oppIsWhite = oppVal > 0 && (oppAbsVal === 1 || oppAbsVal === 2);
          // White captures downward: must be above us (dr = -1) to jump over us
          // Black captures upward: must be below us (dr = 1) to jump over us
          if (oppIsWhite && dr !== -1) continue;
          if (!oppIsWhite && dr !== 1) continue;
        }
        if (isMy) myThreats++; else oppThreats++;
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
}

// ── Helper: calcAdvance ──────────────────────────────────────────────────────
function calcAdvance(prev, next, turn) {
  // Compare total pawn advancement score between boards.
  // For white: closer to row 0 = more advanced. For black: closer to row 7 = more advanced.
  let totalAdvance = 0;
  let prevTotalAdvance = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    if (isPawn(next[i], turn)) {
      const adv = turn === 1 ? (7 - row) / 7 : row / 7;
      totalAdvance += adv;
    }
    if (isPawn(prev[i], turn)) {
      const adv = turn === 1 ? (7 - row) / 7 : row / 7;
      prevTotalAdvance += adv;
    }
  }
  const delta = totalAdvance - prevTotalAdvance;
  return Math.max(-1, Math.min(1, delta));
}

// ── Helper: calcTempo ────────────────────────────────────────────────────────
function calcTempo(prev, next, turn) {
  // Count pieces in advanced positions (rows 4-6 for white, rows 1-3 for black)
  let myAdv = 0, oppAdv = 0;
  for (let i = 0; i < 64; i++) {
    const row = Math.floor(i / 8);
    const nextVal = next[i];
    if (isOwnPiece(nextVal, turn) && ((turn === 1 && row >= 4) || (turn === -1 && row <= 3))) myAdv++;
    if (nextVal && !isOwnPiece(nextVal, turn) && ((turn === -1 && row >= 4) || (turn === 1 && row <= 3))) oppAdv++;
  }
  return (myAdv - oppAdv) / Math.max(myAdv + oppAdv, 1);
}

/**
 * Calculate shaped intermediate reward from the perspective of `turn` (the player who just moved).
 * Uses dual-strategy weights based on side (white=aggressor, black=fortress).
 * @param {number[]|null} prevBoardFlat - flat 64 array before the move (null for first move)
 * @param {number[]} nextBoardFlat - flat 64 array after the move
 * @param {number} turn - 1 (white) or -1 (black)
 * @param {string} side - 'white' or 'black'
 * @returns {number} shaped reward in [-1, 1]
 */
function calculateReward(prevBoardFlat, nextBoardFlat, turn, side = 'white') {
  if (!prevBoardFlat || !nextBoardFlat) return 0;

  const strategyName = CONFIG.ai.strategy[side];
  const strat = CONFIG.ai.strategies[strategyName];
  const weights = strat.weights;

  let reward = 0;

  // 1. Materiał
  const matReward = calcMaterial(prevBoardFlat, nextBoardFlat, turn);
  reward += matReward * weights.material;

  // 2. Pozycja
  const posReward = calcPosition(nextBoardFlat, turn);
  reward += posReward * weights.position;

  // 3. Zagrożenie
  const threatReward = calcThreat(nextBoardFlat, turn);
  reward += threatReward * weights.threat;

  // 4. Tempo
  const tempoReward = calcTempo(prevBoardFlat, nextBoardFlat, turn);
  reward += tempoReward * weights.tempo;

  // 5. Advance (bonus for pawns moving toward promotion)
  const advanceReward = calcAdvance(prevBoardFlat, nextBoardFlat, turn);
  reward += advanceReward * (strat.rewardAdvance ?? weights.advance ?? 0);

  return Math.max(-1, Math.min(1, Math.round(reward * 1000) / 1000));
}
const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');

const CPP_BASE = CONFIG.server.cppBase;
const FETCH_TIMEOUT_MS = CONFIG.server.fetchTimeoutMs;

async function cppFetch(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      // Don't log response body — could leak internal C++ errors/paths
      await res.text().catch(() => '');
      console.error(`[Trainer cppFetch] ${opts.method || 'GET'} ${url} → ${res.status}`);
      throw new Error(`C++ engine error: ${opts.method || 'GET'} ${url} → ${res.status}`);
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[Trainer cppFetch] Timeout after ${FETCH_TIMEOUT_MS}ms: ${opts.method || 'GET'} ${url}`);
      throw new Error(`C++ engine timeout (${FETCH_TIMEOUT_MS}ms) — engine may be crashed`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      console.error(`[Trainer cppFetch] Connection failed: ${opts.method || 'GET'} ${url} — ${err.code}`);
      throw new Error(`C++ engine unreachable — ${err.code}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Move Validation (issue #120) ────────────────────────────────────────────

/**
 * Validate a move object before sending to C++ engine.
 * Returns { valid: true, move } or { valid: false, reason }.
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
  // Validate captures array if present
  if (move.captures != null) {
    if (!Array.isArray(move.captures)) {
      return { valid: false, reason: `captures is not an array: ${typeof move.captures}` };
    }
    for (let i = 0; i < move.captures.length; i++) {
      const c = move.captures[i];
      if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])
        || c[0] < 0 || c[0] > 7 || c[1] < 0 || c[1] > 7) {
        return { valid: false, reason: `invalid capture at index ${i}: ${JSON.stringify(c)}` };
      }
    }
  }
  return { valid: true, move };
}

/**
 * Check if a move is in the list of legal moves.
 * Compares from/to (and captures if present).
 */
function isMoveLegal(move, legalMoves) {
  if (!move || !Array.isArray(legalMoves) || legalMoves.length === 0) return false;
  return legalMoves.some(lm => {
    const sameFrom = Array.isArray(lm.from) ? lm.from[0] === move.from?.[0] && lm.from[1] === move.from?.[1] : lm.from === move.from;
    const sameTo = Array.isArray(lm.to) ? lm.to[0] === move.to?.[0] && lm.to[1] === move.to?.[1] : lm.to === move.to;
    if (!sameFrom || !sameTo) return false;
    // If move has captures, they must match
    if (move.captures && move.captures.length > 0) {
      if (!lm.captures || lm.captures.length !== move.captures.length) return false;
      return move.captures.every((c, i) => c[0] === lm.captures[i]?.[0] && c[1] === lm.captures[i]?.[1]);
    }
    return true;
  });
}

export class SelfPlay {
  constructor(io) {
    this.io = io;
    this.running = false;

    // Parameters per side
    const stratWhite = CONFIG.ai.strategies[CONFIG.ai.strategy.white];
    const stratBlack = CONFIG.ai.strategies[CONFIG.ai.strategy.black];
    this.epsilonWhite = (stratWhite.minEpsilon ?? 0.01) + 0.7; // start high
    this.epsilonBlack = (stratBlack.minEpsilon ?? 0.01) + 0.7;
    this.networkSizeWhite = 'small';
    this.networkSizeBlack = 'small';

    // Custom model architecture params
    this.modelParams = {
      layers: CONFIG.ai.modelParams.layers,
      neurons: CONFIG.ai.modelParams.neurons,
      activation: CONFIG.ai.modelParams.activation,
      lr: CONFIG.ai.modelParams.lr,
      batchSize: CONFIG.ai.modelParams.batchSize,
      dropout: CONFIG.ai.modelParams.dropout,
    };

    // Models
    this.modelWhite = null;
    this.modelBlack = null;

    // Replay buffer
    this.buffer = new ReplayBuffer(CONFIG.ai.bufferSize);

    // Stats
    this.stats = {
      gamesPlayed: 0,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
      lastLoss: null,
      epsilonWhite: this.epsilonWhite,
      epsilonBlack: this.epsilonBlack,
    };

    // Race condition guard (#133)
    this.paramsVersion = 0;

    // Timing
    this.roundTimes = []; // last 10 round times in ms
    this.totalTimeMs = 0; // cumulative training time

    // Auto-save dirty flag (#102)
    this.dirty = false;
  }

  async init() {
    this.modelWhite = createModel({ ...this.modelParams });
    this.modelBlack = createModel({ ...this.modelParams });
    console.log('[SelfPlay] Models initialized');
  }

  // ── Engine Health & Recovery (issue #120) ────────────────────────────────

  /**
   * Check if C++ engine is responsive.
   */
  async isEngineUp() {
    try {
      const res = await cppFetch(`${CPP_BASE}/api/game/state`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Wait for engine to come back up (after crash or restart).
   * Tries up to `maxAttempts` times with `delayMs` between checks.
   */
  async waitForEngine(maxAttempts = 10, delayMs = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isEngineUp()) {
        console.log(`[SelfPlay] Engine is up (attempt ${i + 1}/${maxAttempts})`);
        return true;
      }
      console.log(`[SelfPlay] Engine not responding, waiting... (${i + 1}/${maxAttempts})`);
      await this._sleep(delayMs);
    }
    console.error('[SelfPlay] Engine did not recover after max attempts');
    return false;
  }

  /**
   * Pick a random legal move from the list.
   */
  _randomLegalMove(legalMoves) {
    if (!legalMoves || legalMoves.length === 0) return null;
    const idx = Math.floor(Math.random() * legalMoves.length);
    return legalMoves[idx];
  }

  /**
   * Validate and select a move. If the chosen move is invalid, fall back to a random legal move.
   * Returns a valid move object with { from, to, captures? }.
   */
  _validateAndFallback(chosenMove, legalMoves) {
    // Resolve chosen move to a full move object
    let selectedMove;
    if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
      const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
      selectedMove = legalMoves[idx] || null;
    } else if (chosenMove && typeof chosenMove === 'object' && 'from' in chosenMove) {
      selectedMove = chosenMove;
    }

    // Validate the selected move
    const validation = validateMove(selectedMove);
    if (!validation.valid) {
      console.warn(`[SelfPlay] Invalid AI move (${validation.reason}), falling back to random`);
      return this._randomLegalMove(legalMoves);
    }

    // Check if move is actually legal
    if (!isMoveLegal(selectedMove, legalMoves)) {
      console.warn(`[SelfPlay] AI move not in legal moves list (from=${selectedMove.from}, to=${selectedMove.to}), falling back to random`);
      return this._randomLegalMove(legalMoves);
    }

    return selectedMove;
  }

  setModelParams(newParams) {
    // Validate batchSize
    if (newParams.batchSize !== undefined) {
      const bs = newParams.batchSize;
      if (bs < 8 || bs > 256) {
        console.warn(`[SelfPlay] Invalid batchSize=${bs}, clamping to 8-256`);
        newParams.batchSize = Math.max(8, Math.min(256, bs));
      }
    }
    Object.assign(this.modelParams, newParams);
    console.log('[SelfPlay] Model params updated:', this.modelParams);
  }

  _replaceModel(old, ...createArgs) {
    if (old) { try { old.dispose(); } catch {} }
    return createModel(...createArgs);
  }

  setParams(epsilon, networkSize, side) {
    // Guard: reject NaN/Infinity epsilon to prevent corrupt training state
    if (epsilon !== undefined && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
      console.warn(`[Trainer] Ignoring invalid epsilon: ${epsilon}`);
      epsilon = undefined; // treat as not-set
    }
    if (side === 'white' || side === 'both') {
      if (epsilon !== undefined) this.epsilonWhite = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeWhite = networkSize;
        this.modelWhite = this._replaceModel(this.modelWhite, { ...this.modelParams });
      }
    }
    if (side === 'black' || side === 'both') {
      if (epsilon !== undefined) this.epsilonBlack = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeBlack = networkSize;
        this.modelBlack = this._replaceModel(this.modelBlack, { ...this.modelParams });
      }
    }
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
    this.dirty = true; // params changed (#102)
  }

  async resetModel() {
    // 1. Stop self-play
    this.running = false;

    // 2. Clear replay buffer
    this.buffer.clear();

    // 3. Reset all stats
    this.stats.gamesPlayed = 0;
    this.stats.whiteWins = 0;
    this.stats.blackWins = 0;
    this.stats.draws = 0;
    this.stats.lastLoss = null;

    // 4. Reset epsilon
    const stratWhite = CONFIG.ai.strategies[CONFIG.ai.strategy.white];
    const stratBlack = CONFIG.ai.strategies[CONFIG.ai.strategy.black];
    this.epsilonWhite = (stratWhite.minEpsilon ?? 0.01) + 0.7;
    this.epsilonBlack = (stratBlack.minEpsilon ?? 0.01) + 0.7;
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;

    // 5. Create fresh models
    this.modelWhite = this._replaceModel(this.modelWhite, { ...this.modelParams });
    this.modelBlack = this._replaceModel(this.modelBlack, { ...this.modelParams });

    // 6. Save reset state
    await this.saveState();

    // 7. Delete saved model files from disk
    try {
      const { rm } = await import('node:fs/promises');
      const modelDir = path.join(__dirname, '..', '..', 'data', 'model');
      await rm(modelDir, { recursive: true, force: true });
      console.log('[SelfPlay] Deleted saved model files');
    } catch (err) {
      console.error('[SelfPlay] Could not delete model files:', err.message);
    }

    // 8. Delete buffer file from disk
    try {
      const { rm } = await import('node:fs/promises');
      const bufferFile = path.join(__dirname, '..', '..', 'data', 'buffer.json');
      await rm(bufferFile, { force: true });
      console.log('[SelfPlay] Deleted buffer file');
    } catch (err) {
      console.error('[SelfPlay] Could not delete buffer file:', err.message);
    }

    this.io?.emit('selfPlayStatus', { active: false, gameNumber: 0, stats: this.stats });
    console.log('[SelfPlay] Model fully reset — fresh weights, cleared buffer, zero stats');
  }

  async restart(side) {
    if (side === 'white' || side === 'both') {
      this.modelWhite = this._replaceModel(this.modelWhite, { ...this.modelParams });
      this.stats.whiteWins = 0;
    }
    if (side === 'black' || side === 'both') {
      this.modelBlack = this._replaceModel(this.modelBlack, { ...this.modelParams });
      this.stats.blackWins = 0;
    }
    if (side === 'both') {
      this.buffer.clear();
      this.stats.gamesPlayed = 0;
      this.stats.draws = 0;
      this.stats.lastLoss = null;
      const stratWhite = CONFIG.ai.strategies[CONFIG.ai.strategy.white];
      const stratBlack = CONFIG.ai.strategies[CONFIG.ai.strategy.black];
      this.epsilonWhite = (stratWhite.minEpsilon ?? 0.01) + 0.7;
      this.epsilonBlack = (stratBlack.minEpsilon ?? 0.01) + 0.7;
    }
    this.dirty = true; // model restarted (#102)
    this.io?.emit('modelRestart', { side });
    console.log(`[SelfPlay] Model restarted (${side})`);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log('[SelfPlay] Started');
    this._loop();
  }

  stop() {
    this.running = false;
    this.io?.emit('selfPlayStatus', { active: false });
    console.log('[SelfPlay] Stopped');
  }

  getStatus() {
    const avgRoundTimeMs = this.roundTimes.length > 0
      ? Math.round(this.roundTimes.reduce((a, b) => a + b, 0) / this.roundTimes.length)
      : 0;
    return {
      running: this.running,
      stats: this.stats,
      bufferSize: this.buffer.size(),
      networkSizeWhite: this.networkSizeWhite,
      networkSizeBlack: this.networkSizeBlack,
      modelParams: { ...this.modelParams },
      avgRoundTimeMs,
      last10Times: [...this.roundTimes],
      totalTimeMs: this.totalTimeMs,
    };
  }

  async saveState() {
    // Serialize concurrent saveState calls to prevent file corruption
    // (_playGame, resetModel, and auto-save can all call this concurrently)
    const prev = this._saveStateLock || Promise.resolve();
    let unlock;
    this._saveStateLock = new Promise(r => { unlock = r; });
    await prev;
    try {
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      const state = {
        stats: {
          gamesPlayed: this.stats.gamesPlayed,
          whiteWins: this.stats.whiteWins,
          blackWins: this.stats.blackWins,
          draws: this.stats.draws,
          lastLoss: this.stats.lastLoss,
        },
        epsilonWhite: this.epsilonWhite,
        epsilonBlack: this.epsilonBlack,
        running: this.running,
      };
      // Atomic write: temp file → rename (prevents corruption on crash)
      const tmpFile = STATE_FILE + '.tmp';
      await writeFile(tmpFile, JSON.stringify(state, null, 2));
      await rename(tmpFile, STATE_FILE);
    } catch (err) {
      console.error('[SelfPlay] saveState error:', err.message);
    } finally {
      unlock();
    }
  }

  async loadState() {
    try {
      const raw = await readFile(STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      if (state.stats) {
        this.stats.gamesPlayed = state.stats.gamesPlayed ?? 0;
        this.stats.whiteWins = state.stats.whiteWins ?? 0;
        this.stats.blackWins = state.stats.blackWins ?? 0;
        this.stats.draws = state.stats.draws ?? 0;
        this.stats.lastLoss = state.stats.lastLoss ?? null;
      }
      this.epsilonWhite = (typeof state.epsilonWhite === 'number' && Number.isFinite(state.epsilonWhite)) ? state.epsilonWhite : CONFIG.ai.defaultEpsilon;
      this.epsilonBlack = (typeof state.epsilonBlack === 'number' && Number.isFinite(state.epsilonBlack)) ? state.epsilonBlack : CONFIG.ai.defaultEpsilon;
      this.stats.epsilonWhite = this.epsilonWhite;
      this.stats.epsilonBlack = this.epsilonBlack;
      console.log(`[SelfPlay] Loaded state: ${this.stats.gamesPlayed} games played, εW=${this.epsilonWhite}, εB=${this.epsilonBlack}`);
      this.dirty = true; // loaded state should be persisted on next save cycle
    } catch (err) {
      console.log('[SelfPlay] No previous state found, starting fresh');
    }
  }

  // ── Internal game loop ───────────────────────────────────────────────────
  async _loop() {
    this.io?.emit('selfPlayStatus', { active: true, gameNumber: this.stats.gamesPlayed, stats: this.stats });
    let consecutiveErrors = 0;
    while (this.running) {
      try {
        await this._playGame();
        consecutiveErrors = 0;
        // Delay between rounds = 3x move delay
        if (CONFIG.moveDelayMs > 0) await this._sleep(CONFIG.moveDelayMs * 3);
      } catch (err) {
        consecutiveErrors++;
        console.error(`[SelfPlay] Game error (${consecutiveErrors}/3):`, err.message);
        if (consecutiveErrors >= 3) {
          console.error('[SelfPlay] Too many errors (3), stopping self-play');
          this.running = false;
          this.io?.emit('selfPlayStatus', { active: false, gameNumber: this.stats.gamesPlayed, stats: this.stats });
          break;
        }
        // Brief pause then try to recover engine before next attempt
        await this._sleep(2000);
        if (!await this.isEngineUp()) {
          console.warn('[SelfPlay] Engine appears down, waiting for recovery...');
          await this.waitForEngine(10, 1000);
        }
      }
    }
  }

  async _playGame() {
    const roundStart = Date.now();
    const playGameVersion = this.paramsVersion; // snapshot version for race guard (#133)

    // 0. Health check — ensure engine is up before starting (issue #120)
    if (!await this.isEngineUp()) {
      console.warn('[SelfPlay] Engine not responding before game start, waiting for recovery...');
      const recovered = await this.waitForEngine(10, 1000);
      if (!recovered) throw new Error('Engine not available — cannot start game');
    }

    // 1. Start new game
    const startRes = await cppFetch(`${CPP_BASE}/api/game/start`, { method: 'POST' });
    if (!startRes.ok) throw new Error(`Game start failed: ${startRes.status}`);
    const gameState = await startRes.json();

    this.io?.emit('selfPlayStatus', {
      active: true,
      gameNumber: this.stats.gamesPlayed + 1,
      stats: this.stats,
    });
    const samples = [];
    let turn = 1; // 1 = white, -1 = black
    let moveCount = 0;
    const MAX_MOVES = 300; // safety limit to prevent infinite games

    // 2. Play game
    while (true) {
      moveCount++;
      // Get game state and legal moves in parallel
      const [stateRes, lmResInit] = await Promise.all([
        cppFetch(`${CPP_BASE}/api/game/state`),
        cppFetch(`${CPP_BASE}/api/legal-moves`),
      ]);
      if (!stateRes.ok) throw new Error(`Game state failed: ${stateRes.status}`);
      if (!lmResInit.ok) throw new Error(`Legal moves failed: ${lmResInit.status}`);
      const stateData = await stateRes.json();
      const boardArray = stateData.board;
      let gameOver = stateData.gameOver;
      let winner = stateData.winner;

      // Safety: force draw if too many moves
      if (moveCount >= MAX_MOVES && !gameOver) {
        gameOver = true;
        winner = 'draw';
      }

      if (gameOver) {
        // Guard: skip if params changed mid-game (#133)
        if (this.paramsVersion !== playGameVersion) {
          console.warn('[SelfPlay] _playGame aborted — params changed mid-game');
          break;
        }

        // Record result
        let result = 0;
        if (winner === 'white') {
          result = 1;
          this.stats.whiteWins++;
        } else if (winner === 'black') {
          result = -1;
          this.stats.blackWins++;
        } else {
          this.stats.draws++;
        }
        this.stats.gamesPlayed++;

        // Assign terminal results to samples (backward-compatible field)
        // s.turn is numeric: 1 (white) or -1 (black); winner is string: "white"/"black"/"draw"
        for (const s of samples) {
          if (winner === 'draw' || !winner) {
            s.result = 0;
          } else {
            const winnerVal = winner === 'white' ? 1 : -1;
            s.result = s.turn === winnerVal ? 1 : -1;
          }
        }
        // Mark last sample as terminal
        if (samples.length > 0) {
          samples[samples.length - 1].done = true;
        }

        // Add to buffer
        for (const s of samples) this.buffer.add(s);

        this.io?.emit('gameOver', { winner: winner || 'draw', moves: samples.length, source: 'selfPlay' });

        // Track round time
        const roundTime = Date.now() - roundStart;
        this.roundTimes.push(roundTime);
        if (this.roundTimes.length > 10) this.roundTimes.shift();
        this.totalTimeMs += roundTime;

        const avgTime = this.roundTimes.length > 0
          ? Math.round(this.roundTimes.reduce((a, b) => a + b, 0) / this.roundTimes.length)
          : 0;

        this.io?.emit('selfPlayStatus', {
          active: this.running,
          gameNumber: this.stats.gamesPlayed,
          stats: this.stats,
          avgTime,
          roundTimes: [...this.roundTimes],
          totalTimeMs: this.totalTimeMs,
        });
        break;
      }

      // Delay between AI moves (so humans can see the game)
      if (CONFIG.moveDelayMs > 0) await this._sleep(CONFIG.moveDelayMs);

      // Get legal moves (already fetched in parallel with state above)
      const { moves: legalMoves } = await lmResInit.json();

      // Safety net: if engine says game is not over but has no legal moves,
      // treat as draw. This duplicates the gameOver block above intentionally —
      // it catches the edge case where engine state and legal moves are out of sync. (#121)
      if (!legalMoves || legalMoves.length === 0) {
        console.warn('[SelfPlay] No legal moves available — game should be over');
        // Guard: skip if params changed mid-game (#133)
        if (this.paramsVersion !== playGameVersion) {
          console.warn('[SelfPlay] _playGame aborted — params changed mid-game');
          break;
        }
        // Force game over as draw (engine state may not reflect this yet)
        gameOver = true;
        winner = 'draw';
        // Re-enter the gameOver handling block above
        // We break here and let the next iteration handle it, or just record as draw
        let result = 0;
        this.stats.draws++;
        this.stats.gamesPlayed++;
        for (const s of samples) {
          s.result = 0;
        }
        if (samples.length > 0) {
          samples[samples.length - 1].done = true;
        }
        for (const s of samples) this.buffer.add(s);
        this.io?.emit('gameOver', { winner: 'draw', moves: samples.length, source: 'selfPlay' });
        const roundTime = Date.now() - roundStart;
        this.roundTimes.push(roundTime);
        if (this.roundTimes.length > 10) this.roundTimes.shift();
        this.totalTimeMs += roundTime;
        this.io?.emit('selfPlayStatus', {
          active: this.running,
          gameNumber: this.stats.gamesPlayed,
          stats: this.stats,
          totalTimeMs: this.totalTimeMs,
        });
        break;
      }

      const movesWithIndex = legalMoves.map((m, i) => ({
        ...m,
        index: i,
        policyIndex: computePolicyIndex(m.from, m.to),
      }));

      // Choose move based on strategy
      const strategyName = turn === 1 ? CONFIG.ai.strategy.white : CONFIG.ai.strategy.black;
      const strategyConfig = CONFIG.ai.strategies[strategyName];
      let chosenMove;

      if (strategyConfig && strategyConfig.type === 'minimax') {
        // ── Minimax path: pure JS search, no DQN ─────────────────────
        const depth = strategyConfig.depth || 4;
        const flatBoard = flattenBoard(boardArray);
        if (!flatBoard) throw new Error('minimax: invalid board');
        const result = minimaxSearch(flatBoard, turn, depth);
        chosenMove = result.move;
        if (!chosenMove) {
          // Fallback to random if minimax returns nothing
          const randomIdx = Math.floor(Math.random() * legalMoves.length);
          chosenMove = legalMoves[randomIdx];
        }
      } else {
        // ── DQN path (existing) ──────────────────────────────────────
        const model = turn === 1 ? this.modelWhite : this.modelBlack;
        const epsilon = turn === 1 ? this.epsilonWhite : this.epsilonBlack;

        // Epsilon-greedy: explore or exploit
        if (Math.random() < epsilon) {
          // Random legal move
          const randomIdx = Math.floor(Math.random() * legalMoves.length);
          chosenMove = legalMoves[randomIdx];
        } else {
          const pred = await predict(model, boardArray, movesWithIndex, turn);
          // pred.move is the selected move object from movesWithIndex
          chosenMove = pred.move;
        }
      }

      // Save board state before move for reward calculation
      const prevBoardFlat = flattenBoard(boardArray);

      // Validate move and fallback to random if invalid (issue #120)
      const validatedMove = this._validateAndFallback(chosenMove, legalMoves);
      if (!validatedMove) {
        throw new Error('No valid move available — legal moves list is empty');
      }

      // Save sample (result will be assigned later at game end)
      samples.push({
        board: Array.isArray(boardArray) ? boardArray.flat() : boardArray,
        legalMoves,
        chosenMove: validatedMove,
        turn,
        result: 0, // placeholder — terminal reward assigned at game end
        reward: 0, // placeholder — shaped intermediate reward set below
        nextState: null, // placeholder — set below
        done: false
      });

      // Make move with retry on 400 (issue #120)
      // Use a separate copy for retries so validatedMove (stored in sample) is never mutated (#124)
      let attemptedMove = {
        from: validatedMove.from,
        to: validatedMove.to,
        captures: validatedMove.captures ? [...validatedMove.captures] : undefined,
      };
      let moveRes;
      let lastError;
      const MAX_MOVE_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_MOVE_RETRIES; attempt++) {
        const moveBody = { from: attemptedMove.from, to: attemptedMove.to };
        if (attemptedMove.captures && attemptedMove.captures.length > 0) {
          moveBody.captures = attemptedMove.captures;
        }
        moveRes = await cppFetch(`${CPP_BASE}/api/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(moveBody)
        });
        if (moveRes.ok) break; // success

        lastError = `Move failed: ${moveRes.status}`;
        console.warn(`[SelfPlay] ${lastError} (attempt ${attempt + 1}/${MAX_MOVE_RETRIES})`);

        if (moveRes.status === 400) {
          // Engine rejected the move — try a different random legal move
          const altMove = this._randomLegalMove(legalMoves);
          if (altMove) {
            attemptedMove.from = altMove.from;
            attemptedMove.to = altMove.to;
            attemptedMove.captures = altMove.captures ? [...altMove.captures] : undefined;
          }
        }

        // Check if engine is still alive after error
        if (!await this.isEngineUp()) {
          console.warn('[SelfPlay] Engine went down after move error, waiting for recovery...');
          await this.waitForEngine(10, 1000);
        }
      }
      if (!moveRes || !moveRes.ok) throw new Error(lastError || 'Move failed after retries');

      // /api/move already returns full game state — no need for extra /api/game/state call
      const newState = await moveRes.json();

      // Calculate shaped intermediate reward for the sample we just pushed
      const nextBoardFlat = flattenBoard(newState.board);
      const currentSample = samples[samples.length - 1];
      currentSample.reward = calculateReward(prevBoardFlat, nextBoardFlat, turn, turn === 1 ? 'white' : 'black');
      currentSample.nextState = Array.isArray(newState.board) ? newState.board.flat() : newState.board;

      const boardReact = boardFromCpp(newState.board);

      const turnColor = newState.turn;
      this.io?.emit('state', {
        board: boardReact,
        turn: turnColor,
        legalMoves: [],
        gameOver: newState.gameOver ?? false,
        winner: newState.winner || null,
        source: 'selfPlay',
      });

      turn = -turn;

      // Small delay so clients can observe the move
      if (CONFIG.moveDelayMs > 0) await this._sleep(CONFIG.moveDelayMs);
    }

    // Train once per round — 2048 samples, 1 epoch (skip if params changed mid-game, #133)
    if (this.buffer.size() >= 2048 && this.paramsVersion === playGameVersion) {
      const batch = this.buffer.sample(2048);
      const batchWhite = [];
      const batchBlack = [];
      for (const s of batch) {
        if (s.turn === 1) batchWhite.push(s);
        else batchBlack.push(s);
      }
      const lw = batchWhite.length > 0 ? await train(this.modelWhite, batchWhite, 1) : { loss: 0 };
      const lb = batchBlack.length > 0 ? await train(this.modelBlack, batchBlack, 1) : { loss: 0 };
      const avgLoss = ((lw.loss || 0) + (lb.loss || 0)) / 2;
      this.stats.lastLoss = avgLoss;
      this.dirty = true; // model trained (#102)
      this.io?.emit('loss', { loss: avgLoss });
    }

    // 3. Decay epsilon after each game (skip if params changed mid-game, #133)
    if (this.paramsVersion !== playGameVersion) {
      console.warn('[SelfPlay] Skipping epsilon decay — params changed mid-game');
      return;
    }
    const stratWhite = CONFIG.ai.strategies[CONFIG.ai.strategy.white];
    const stratBlack = CONFIG.ai.strategies[CONFIG.ai.strategy.black];
    if (stratWhite.epsilonDecay != null) {
      this.epsilonWhite = Math.max(stratWhite.minEpsilon, this.epsilonWhite - stratWhite.epsilonDecay);
    }
    if (stratBlack.epsilonDecay != null) {
      this.epsilonBlack = Math.max(stratBlack.minEpsilon, this.epsilonBlack - stratBlack.epsilonDecay);
    }
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
    this.dirty = true; // epsilon changed — auto-save must persist it (#132)

    // 4. Save state after each game
    await this.saveState();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
