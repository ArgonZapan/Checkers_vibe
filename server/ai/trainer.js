import { createModel, predict, train, saveModel, loadModel, boardToTensor } from './model.js';
import { ReplayBuffer } from './buffer.js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../config.js';

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
const PIECE_VALUE = { 1: 1, 2: 3, 3: 1, 4: 3 }; // white pawn=1, white king=3, black pawn=3(val=1), black king=4(val=3)

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
        if (isMy) myThreats++; else oppThreats++;
      }
    }
  }
  return (oppThreats - myThreats) / Math.max(oppThreats + myThreats, 1);
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
 * Weighted sum: material (0.4) + position (0.25) + mobility (0.15) + threat (0.1) + tempo (0.1)
 * @param {number[]|null} prevBoardFlat - flat 64 array before the move (null for first move)
 * @param {number[]} nextBoardFlat - flat 64 array after the move
 * @param {number} turn - 1 (white) or -1 (black)
 * @returns {number} shaped reward in [-1, 1]
 */
function calculateReward(prevBoardFlat, nextBoardFlat, turn) {
  if (!prevBoardFlat || !nextBoardFlat) return 0;

  let reward = 0;

  // 1. Materiał (0.4)
  const matReward = calcMaterial(prevBoardFlat, nextBoardFlat, turn);
  reward += matReward * 0.4;

  // 2. Pozycja (0.25)
  const posReward = calcPosition(nextBoardFlat, turn);
  reward += posReward * 0.25;

  // 3. Mobilność (0.15) — skipped here (requires MoveGenerator), handled via captures in tempo

  // 4. Zagrożenie (0.1)
  const threatReward = calcThreat(nextBoardFlat, turn);
  reward += threatReward * 0.1;

  // 5. Tempo (0.1)
  const tempoReward = calcTempo(prevBoardFlat, nextBoardFlat, turn);
  reward += tempoReward * 0.1;

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
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export class SelfPlay {
  constructor(io) {
    this.io = io;
    this.running = false;

    // Parameters per side
    this.epsilonWhite = CONFIG.ai.defaultEpsilon;
    this.epsilonBlack = CONFIG.ai.defaultEpsilon;
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
      epsilonBlack: this.epsilonBlack
    };

    // Timing
    this.roundTimes = []; // last 10 round times in ms
    this.totalTimeMs = 0; // cumulative training time
  }

  async init() {
    this.modelWhite = createModel({ ...this.modelParams });
    this.modelBlack = createModel({ ...this.modelParams });
    console.log('[SelfPlay] Models initialized');
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

  setParams(epsilon, networkSize, side) {
    if (side === 'white' || side === 'both') {
      if (epsilon !== undefined) this.epsilonWhite = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeWhite = networkSize;
        this.modelWhite = createModel({ ...this.modelParams });
      }
    }
    if (side === 'black' || side === 'both') {
      if (epsilon !== undefined) this.epsilonBlack = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeBlack = networkSize;
        this.modelBlack = createModel({ ...this.modelParams });
      }
    }
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
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
    this.epsilonWhite = CONFIG.ai.defaultEpsilon;
    this.epsilonBlack = CONFIG.ai.defaultEpsilon;
    this.stats.epsilonWhite = CONFIG.ai.defaultEpsilon;
    this.stats.epsilonBlack = CONFIG.ai.defaultEpsilon;

    // 5. Create fresh models
    this.modelWhite = createModel({ ...this.modelParams });
    this.modelBlack = createModel({ ...this.modelParams });

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
      this.modelWhite = createModel({ ...this.modelParams });
      this.stats.whiteWins = 0;
    }
    if (side === 'black' || side === 'both') {
      this.modelBlack = createModel({ ...this.modelParams });
      this.stats.blackWins = 0;
    }
    if (side === 'both') {
      this.buffer.clear();
      this.stats.gamesPlayed = 0;
      this.stats.draws = 0;
      this.stats.lastLoss = null;
      this.epsilonWhite = CONFIG.ai.defaultEpsilon;
      this.epsilonBlack = CONFIG.ai.defaultEpsilon;
    }
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
      await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[SelfPlay] saveState error:', err.message);
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
      this.epsilonWhite = state.epsilonWhite ?? CONFIG.ai.defaultEpsilon;
      this.epsilonBlack = state.epsilonBlack ?? CONFIG.ai.defaultEpsilon;
      this.stats.epsilonWhite = this.epsilonWhite;
      this.stats.epsilonBlack = this.epsilonBlack;
      console.log(`[SelfPlay] Loaded state: ${this.stats.gamesPlayed} games played, εW=${this.epsilonWhite}, εB=${this.epsilonBlack}`);
    } catch (err) {
      console.log('[SelfPlay] No previous state found, starting fresh');
    }
  }

  // ── Internal game loop ───────────────────────────────────────────────────
  async _loop() {
    this.io?.emit('selfPlayStatus', { active: true, gameNumber: this.stats.gamesPlayed, stats: this.stats });
    while (this.running) {
      try {
        await this._playGame();
        // Delay between rounds = 3x move delay
        if (CONFIG.server.aiMoveDelayMs > 0) await this._sleep(CONFIG.server.aiMoveDelayMs * 3);
      } catch (err) {
        console.error('[SelfPlay] Game error:', err.message);
        // Brief pause before retry
        await this._sleep(2000);
      }
    }
  }

  async _playGame() {
    const roundStart = Date.now();

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

    // 2. Play game
    while (true) {
      // Get game state (board, legal moves, gameOver, winner)
      const stateRes = await fetch(`${CPP_BASE}/api/game/state`);
      if (!stateRes.ok) throw new Error(`Game state failed: ${stateRes.status}`);
      const stateData = await stateRes.json();
      const boardArray = stateData.board;
      const gameOver = stateData.gameOver;
      const winner = stateData.winner;

      if (gameOver) {
        // Record result
        let result = 0;
        if (winner === 1 || winner === 'white') {
          result = 1;
          this.stats.whiteWins++;
        } else if (winner === -1 || winner === 'black') {
          result = -1;
          this.stats.blackWins++;
        } else {
          this.stats.draws++;
        }
        this.stats.gamesPlayed++;

        // Assign terminal results to samples (backward-compatible field)
        const winnerTurn = result; // 1, -1, or 0
        for (const s of samples) {
          s.result = s.turn === winnerTurn ? 1 : winnerTurn === 0 ? 0 : -1;
        }
        // Mark last sample as terminal
        if (samples.length > 0) {
          samples[samples.length - 1].done = true;
        }

        // Add to buffer
        for (const s of samples) this.buffer.add(s);

        this.io?.emit('gameOver', { winner: winner || 'draw', moves: samples.length });

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
      if (CONFIG.server.aiMoveDelayMs > 0) await this._sleep(CONFIG.server.aiMoveDelayMs);

      // Get legal moves
      const lmRes = await fetch(`${CPP_BASE}/api/legal-moves`);
      if (!lmRes.ok) throw new Error(`Legal moves failed: ${lmRes.status}`);
      const { moves: legalMoves } = await lmRes.json();

      // Choose model based on turn
      const model = turn === 1 ? this.modelWhite : this.modelBlack;
      const epsilon = turn === 1 ? this.epsilonWhite : this.epsilonBlack;

      // Epsilon-greedy: explore or exploit
      let chosenMove;
      if (Math.random() < epsilon) {
        // Random legal move
        const randomIdx = Math.floor(Math.random() * legalMoves.length);
        chosenMove = typeof legalMoves[randomIdx] === 'number'
          ? legalMoves[randomIdx]
          : legalMoves[randomIdx].index ?? randomIdx;
      } else {
        const pred = await predict(model, boardArray, legalMoves, turn);
        chosenMove = pred.move;
      }

      // Save board state before move for reward calculation
      const prevBoardFlat = flattenBoard(boardArray);

      // Save sample (result will be assigned later at game end)
      samples.push({
        board: Array.isArray(boardArray) ? boardArray.flat() : boardArray,
        legalMoves,
        chosenMove,
        turn,
        result: 0, // placeholder — terminal reward assigned at game end
        reward: 0, // placeholder — shaped intermediate reward set below
        nextState: null, // placeholder — set below
        done: false
      });

      // Make move — send from/to coordinates (C++ engine format)
      const moveIdx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index ?? chosenMove;
      const selectedMove = legalMoves[moveIdx] || legalMoves[0];
      const moveBody = { from: selectedMove.from, to: selectedMove.to };
      if (selectedMove.captures && selectedMove.captures.length > 0) {
        moveBody.captures = selectedMove.captures;
      }
      const moveRes = await fetch(`${CPP_BASE}/api/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moveBody)
      });
      if (!moveRes.ok) throw new Error(`Move failed: ${moveRes.status}`);

      // Emit state after move so React can update the board
      const newStateRes = await fetch(`${CPP_BASE}/api/game/state`);
      const newState = await newStateRes.json();
      const lmRes2 = await fetch(`${CPP_BASE}/api/legal-moves`);
      const { moves: newLegalMoves } = await lmRes2.json();

      // Calculate shaped intermediate reward for the sample we just pushed
      const nextBoardFlat = flattenBoard(newState.board);
      const currentSample = samples[samples.length - 1];
      currentSample.reward = calculateReward(prevBoardFlat, nextBoardFlat, turn);
      currentSample.nextState = Array.isArray(newState.board) ? newState.board.flat() : newState.board;

      // Convert board from C++ ints to React objects
      let board2D = newState.board;
      if (Array.isArray(newState.board) && !Array.isArray(newState.board[0])) {
        board2D = [];
        for (let r = 0; r < 8; r++) {
          board2D.push(newState.board.slice(r * 8, r * 8 + 8));
        }
      }
      const boardReact = board2D.map(row => row.map(val => {
        if (val === 0) return null;
        return { color: (val === 1 || val === 2) ? 'white' : 'black', king: (val === 2 || val === 4) };
      }));

      const turnColor = newState.turn === 1 || newState.turn === 'white' ? 'white' : 'black';
      this.io?.emit('state', {
        board: boardReact,
        turn: turnColor,
        legalMoves: [],
        gameOver: newState.gameOver ?? false,
        winner: newState.winner || null,
      });

      turn = -turn;

      // Train after each move (continuous learning) — 3 epochs, fresh batch each time
      if (this.buffer.size() >= this.modelParams.batchSize) {
        let lastLoss = 0;
        for (let epoch = 0; epoch < 3; epoch++) {
          const batch = this.buffer.sample(this.modelParams.batchSize);
          const batchWhite = [];
          const batchBlack = [];
          for (const s of batch) {
            if (s.turn === 1) batchWhite.push(s);
            else batchBlack.push(s);
          }
          const lw = batchWhite.length > 0 ? await train(this.modelWhite, batchWhite, 1) : { loss: 0 };
          const lb = batchBlack.length > 0 ? await train(this.modelBlack, batchBlack, 1) : { loss: 0 };
          lastLoss = ((lw.loss || 0) + (lb.loss || 0)) / 2;
        }
        this.stats.lastLoss = lastLoss;
        this.io?.emit('loss', { loss: lastLoss });
      }

      // Small delay so clients can observe the move
      if (CONFIG.server.aiMoveDelayMs > 0) await this._sleep(CONFIG.server.aiMoveDelayMs);
    }

    // 3. Decay epsilon after each game
    this.epsilonWhite = Math.max(CONFIG.ai.minEpsilon, this.epsilonWhite - CONFIG.ai.epsilonDecay);
    this.epsilonBlack = Math.max(CONFIG.ai.minEpsilon, this.epsilonBlack - CONFIG.ai.epsilonDecay);
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;

    // 4. Save state after each game
    await this.saveState();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
