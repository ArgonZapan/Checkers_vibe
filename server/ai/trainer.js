import { createModel, predict, train, saveModel, loadModel } from './model.js';
import { ReplayBuffer } from './buffer.js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'state.json');

const CPP_BASE = 'http://localhost:8080';
const FETCH_TIMEOUT_MS = 5000;

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
    this.epsilonWhite = 0.3;
    this.epsilonBlack = 0.3;
    this.networkSizeWhite = 'small';
    this.networkSizeBlack = 'small';

    // Models
    this.modelWhite = null;
    this.modelBlack = null;

    // Replay buffer
    this.buffer = new ReplayBuffer(10000);

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
  }

  async init() {
    this.modelWhite = createModel(this.networkSizeWhite);
    this.modelBlack = createModel(this.networkSizeBlack);
    console.log('[SelfPlay] Models initialized');
  }

  setParams(epsilon, networkSize, side) {
    if (side === 'white' || side === 'both') {
      if (epsilon !== undefined) this.epsilonWhite = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeWhite = networkSize;
        this.modelWhite = createModel(networkSize);
      }
    }
    if (side === 'black' || side === 'both') {
      if (epsilon !== undefined) this.epsilonBlack = epsilon;
      if (networkSize !== undefined) {
        this.networkSizeBlack = networkSize;
        this.modelBlack = createModel(networkSize);
      }
    }
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
  }

  async restart(side) {
    if (side === 'white' || side === 'both') {
      this.modelWhite = createModel(this.networkSizeWhite);
      this.stats.whiteWins = 0;
    }
    if (side === 'black' || side === 'both') {
      this.modelBlack = createModel(this.networkSizeBlack);
      this.stats.blackWins = 0;
    }
    if (side === 'both') {
      this.buffer.clear();
      this.stats.gamesPlayed = 0;
      this.stats.draws = 0;
      this.stats.lastLoss = null;
      this.epsilonWhite = 0.3;
      this.epsilonBlack = 0.3;
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
    return {
      running: this.running,
      stats: this.stats,
      bufferSize: this.buffer.size(),
      networkSizeWhite: this.networkSizeWhite,
      networkSizeBlack: this.networkSizeBlack
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
      this.epsilonWhite = state.epsilonWhite ?? 0.3;
      this.epsilonBlack = state.epsilonBlack ?? 0.3;
      this.stats.epsilonWhite = this.epsilonWhite;
      this.stats.epsilonBlack = this.epsilonBlack;
      console.log(`[SelfPlay] Loaded state: ${this.stats.gamesPlayed} games played, εW=${this.epsilonWhite}, εB=${this.epsilonBlack}`);
    } catch (err) {
      console.log('[SelfPlay] No previous state found, starting fresh');
    }
  }

  // ── Internal game loop ───────────────────────────────────────────────────
  async _loop() {
    this.io?.emit('selfPlayStatus', { active: true, gameNumber: this.stats.gamesPlayed });
    while (this.running) {
      try {
        await this._playGame();
      } catch (err) {
        console.error('[SelfPlay] Game error:', err.message);
        // Brief pause before retry
        await this._sleep(2000);
      }
    }
  }

  async _playGame() {
    // 1. Start new game
    const startRes = await cppFetch(`${CPP_BASE}/api/game/start`, { method: 'POST' });
    if (!startRes.ok) throw new Error(`Game start failed: ${startRes.status}`);
    const gameState = await startRes.json();

    this.io?.emit('selfPlayStatus', {
      active: true,
      gameNumber: this.stats.gamesPlayed + 1,
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

        // Assign results to samples
        // result is already 1 (white wins), -1 (black wins), or 0 (draw)
        const winnerTurn = result; // 1, -1, or 0
        for (const s of samples) {
          s.result = s.turn === winnerTurn ? 1 : winnerTurn === 0 ? 0 : -1;
        }

        // Add to buffer
        for (const s of samples) this.buffer.add(s);

        this.io?.emit('gameOver', { winner: winner || 'draw', moves: samples.length });
        this.io?.emit('selfPlayStatus', { active: this.running, gameNumber: this.stats.gamesPlayed });
        break;
      }

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

      // Save sample (result will be assigned later)
      samples.push({
        board: Array.isArray(boardArray) ? boardArray.flat() : boardArray,
        legalMoves,
        chosenMove,
        turn,
        result: 0 // placeholder
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

      // Small delay so clients can observe the move
      await this._sleep(200);
    }

    // 3. Train on mini-batch after each game
    if (this.buffer.size() >= 256) {
      const batch = this.buffer.sample(256);

      // Pre-split batch by turn to avoid repeated filtering
      const batchWhite = [];
      const batchBlack = [];
      for (const s of batch) {
        if (s.turn === 1) batchWhite.push(s);
        else batchBlack.push(s);
      }

      // Train both models
      const lossWhite = await train(this.modelWhite, batchWhite, 5);
      const lossBlack = await train(this.modelBlack, batchBlack, 5);

      const avgLoss = ((lossWhite.loss || 0) + (lossBlack.loss || 0)) / 2;
      this.stats.lastLoss = avgLoss;
      this.io?.emit('loss', { loss: avgLoss });
    }

    // 4. Decay epsilon
    this.epsilonWhite = Math.max(0.01, this.epsilonWhite - 0.001);
    this.epsilonBlack = Math.max(0.01, this.epsilonBlack - 0.001);
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;

    // 5. Save state after each game
    await this.saveState();
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
