import { createModel, predict, train, saveModel, loadModel } from './model.js';
import { ReplayBuffer } from './buffer.js';

const CPP_BASE = 'http://localhost:8080';

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

  // ── Internal game loop ───────────────────────────────────────────────────
  async _loop() {
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
    const startRes = await fetch(`${CPP_BASE}/api/game/start`, { method: 'POST' });
    if (!startRes.ok) throw new Error(`Game start failed: ${startRes.status}`);
    const gameState = await startRes.json();

    this.io?.emit('gameStart', { gameId: Date.now() });
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
        for (const s of samples) {
          // Result from perspective of the player who made the move
          s.result = s.turn === (result > 0 ? 1 : result < 0 ? -1 : 0) ? Math.abs(result) : -Math.abs(result);
        }

        // Add to buffer
        for (const s of samples) this.buffer.add(s);

        this.io?.emit('gameEnd', { result, stats: this.stats });
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

      this.io?.emit('move', { moveIndex: moveIdx, turn });
      turn = -turn;
    }

    // 3. Train on mini-batch after each game
    if (this.buffer.size() >= 256) {
      const batch = this.buffer.sample(256);

      // Train both models
      const lossWhite = await train(this.modelWhite, batch.filter(s => s.turn === 1), 5);
      const lossBlack = await train(this.modelBlack, batch.filter(s => s.turn === -1), 5);

      const avgLoss = ((lossWhite.loss || 0) + (lossBlack.loss || 0)) / 2;
      this.stats.lastLoss = avgLoss;
      this.io?.emit('train', { loss: avgLoss, gamesPlayed: this.stats.gamesPlayed });
    }

    // 4. Decay epsilon
    this.epsilonWhite = Math.max(0.01, this.epsilonWhite - 0.001);
    this.epsilonBlack = Math.max(0.01, this.epsilonBlack - 0.001);
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
