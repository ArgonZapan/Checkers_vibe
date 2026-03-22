import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import { setupProxy } from './proxy.js';
import { SelfPlay } from './ai/trainer.js';
import { saveModel, loadModel } from './ai/model.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODEL_DIR = path.join(__dirname, '..', 'data', 'model');
const BUFFER_FILE = path.join(__dirname, '..', 'data', 'buffer.json');

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: '*' }
});

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// Serve React build (after `npm run build` in client/)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// ── SelfPlay trainer ────────────────────────────────────────────────────────
const trainer = new SelfPlay(io);

// ── AI endpoints (before proxy) ─────────────────────────────────────────────
app.get('/api/ai/info', (_req, res) => {
  const status = trainer.getStatus();
  res.json({
    modelWhite: trainer.networkSizeWhite,
    modelBlack: trainer.networkSizeBlack,
    epsilonWhite: trainer.epsilonWhite,
    epsilonBlack: trainer.epsilonBlack,
    gamesPlayed: status.stats.gamesPlayed,
    bufferSize: status.bufferSize,
    running: status.running
  });
});

app.post('/api/ai/predict', async (req, res) => {
  try {
    const { board, legalMoves, turn = 1 } = req.body;
    if (!board || !legalMoves) {
      return res.status(400).json({ error: 'Missing board or legalMoves' });
    }
    const model = turn === 1 ? trainer.modelWhite : trainer.modelBlack;
    if (!model) return res.status(503).json({ error: 'Model not initialized' });

    const { predict } = await import('./ai/model.js');
    const result = await predict(model, board, legalMoves, turn);
    res.json(result);
  } catch (err) {
    console.error('[AI] Predict error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/train', async (req, res) => {
  try {
    const { train } = await import('./ai/model.js');
    const batch = req.body.batch || [];
    if (batch.length === 0) {
      return res.status(400).json({ error: 'Empty batch' });
    }
    const lossWhite = await train(trainer.modelWhite, batch, 5);
    const lossBlack = await train(trainer.modelBlack, batch, 5);
    const avgLoss = ((lossWhite.loss || 0) + (lossBlack.loss || 0)) / 2;
    io.emit('train', { loss: avgLoss });
    res.json({ loss: avgLoss });
  } catch (err) {
    console.error('[AI] Train error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/params', (req, res) => {
  const { epsilon, networkSize, side = 'both' } = req.body;
  trainer.setParams(epsilon, networkSize, side);
  io.emit('paramsChange', { epsilon, networkSize, side });
  res.json({ ok: true, ...trainer.getStatus() });
});

app.post('/api/ai/restart', async (req, res) => {
  const { side = 'both' } = req.body;
  await trainer.restart(side);
  res.json({ ok: true });
});

app.get('/api/ai/stats', (_req, res) => {
  res.json(trainer.getStatus().stats);
});

// ── SelfPlay endpoints ──────────────────────────────────────────────────────
app.post('/api/selfplay/start', async (_req, res) => {
  await trainer.start();
  res.json({ ok: true, running: true });
});

app.post('/api/selfplay/stop', (_req, res) => {
  trainer.stop();
  res.json({ ok: true, running: false });
});

app.get('/api/selfplay/status', (_req, res) => {
  res.json(trainer.getStatus());
});

// ── Proxy to C++ (MUST be after AI/selfplay routes) ─────────────────────────
setupProxy(app);

// ── WebSocket ───────────────────────────────────────────────────────────────
const CPP_BASE = 'http://localhost:8080';

// Helper: convert between client color strings and C++ int turns
const colorToTurn = (color) => color === 'white' ? 1 : -1;
const turnToColor = (turn) => {
  if (typeof turn === 'string') return turn; // already a color string (C++ engine format)
  return turn === 1 ? 'white' : 'black';
};

// Helper: fetch JSON from C++ backend with timeout
const CPP_FETCH_TIMEOUT_MS = 5000;
async function cppFetch(path, opts = {}) {
  const url = `${CPP_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CPP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...opts,
    });
    if (!res.ok) throw new Error(`C++ ${path} → ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Helper: get full game state from C++ engine and return client-friendly format
async function getGameState() {
  const state = await cppFetch('/api/game/state');
  const { moves: legalMoves } = await cppFetch('/api/legal-moves');
  // Normalize board to 2D array
  let board2D = state.board;
  if (Array.isArray(state.board) && !Array.isArray(state.board[0])) {
    board2D = [];
    for (let r = 0; r < 8; r++) {
      board2D.push(state.board.slice(r * 8, r * 8 + 8));
    }
  }
  // Convert board ints to piece objects
  // C++ encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
  const board = board2D.map(row => row.map(val => {
    if (val === 0) return null;
    const isWhite = val === 1 || val === 2;
    const isKing = val === 2 || val === 4;
    return { color: isWhite ? 'white' : 'black', king: isKing };
  }));
  // Convert legal moves to client format
  const moves = (legalMoves || []).map(m => ({
    from: m.from,
    to: m.to,
    captures: m.captures || [],
    index: m.index,
  }));
  return {
    board,
    turn: turnToColor(state.turn ?? state.currentTurn ?? 1),
    legalMoves: moves,
    gameOver: state.gameOver ?? false,
    winner: state.winner != null ? turnToColor(state.winner) : null,
    lastMove: state.lastMove || null,
  };
}

io.on('connection', async (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.gameMode = 'pvai'; // default mode

  // Send current state to new client
  try {
    const state = await getGameState();
    socket.emit('state', state);
  } catch (err) {
    console.log('[WS] Could not get game state for new client:', err.message);
  }
  socket.emit('selfPlayStatus', { active: trainer.running, currentGame: trainer.stats.gamesPlayed, stats: trainer.stats });
  if (trainer.stats.lastLoss != null) {
    socket.emit('loss', { loss: trainer.stats.lastLoss });
  }

  // ── Start game ─────────────────────────────────────────────────────────
  socket.on('startGame', async ({ mode }) => {
    socket.gameMode = mode || 'pvai';
    // Stop self-play when starting a player game (C++ handles one game at a time)
    if (trainer.running && socket.gameMode !== 'aivai') {
      trainer.stop();
    }
    try {
      await cppFetch('/api/game/start', { method: 'POST', body: '{}' });
      const state = await getGameState();
      socket.emit('state', state);
      console.log(`[WS] Game started (${socket.gameMode}) for ${socket.id}`);
      // Auto-start trainer for aivai mode
      if (socket.gameMode === 'aivai') {
        await trainer.start();
      }
    } catch (err) {
      console.error('[WS] startGame error:', err.message);
      socket.emit('error', { message: err.message });
    }
  });

  // ── Get legal moves for a piece ────────────────────────────────────────
  socket.on('getLegalMoves', async ({ from }) => {
    try {
      const state = await getGameState();
      const filtered = state.legalMoves.filter(
        m => m.from[0] === from[0] && m.from[1] === from[1]
      );
      socket.emit('legalMoves', { from, moves: filtered });
    } catch (err) {
      console.error('[WS] getLegalMoves error:', err.message);
      socket.emit('error', { message: err.message });
    }
  });

  // ── Player move (PvAI / PvP) ──────────────────────────────────────────
  socket.on('move', async ({ from, to, captures }) => {
    try {
      // 1. Execute player's move via C++ (include captures for disambiguation)
      const moveBody = { from, to };
      if (captures && captures.length > 0) moveBody.captures = captures;
      const moveResult = await cppFetch('/api/move', {
        method: 'POST',
        body: JSON.stringify(moveBody),
      });

      // 2. Get updated state after player move
      let state = await getGameState();
      const isPvAI = socket.gameMode === 'pvai';
      const moveCaptures = moveResult.captures || captures || [];

      // 3. If PvAI and game not over → AI makes its move
      if (isPvAI && !state.gameOver) {
        await aiMove(state);
        // Re-fetch state after AI moved
        state = await getGameState();
      }

      // 4. Emit new state — in PvP broadcast to all, in PvAI emit to requesting client
      const statePayload = {
        ...state,
        lastMove: state.lastMove || { from, to, captures: moveCaptures },
      };
      if (socket.gameMode === 'pvp') {
        io.emit('state', statePayload);
      } else {
        socket.emit('state', statePayload);
      }

      // 5. If game over, emit gameOver event and resume self-play (only in aivai mode)
      if (state.gameOver) {
        io.emit('gameOver', {
          winner: state.winner,
          moves: 0,
        });
        // Only restart self-play for aivai mode, not after player games
        if (socket.gameMode === 'aivai') {
          setTimeout(() => trainer.start(), 3000);
        }
      }
    } catch (err) {
      console.error('[WS] move error:', err.message);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });

  // ── SelfPlay controls ─────────────────────────────────────────────────
  socket.on('startSelfPlay', async () => {
    try {
      console.log(`[WS] startSelfPlay from ${socket.id}`);
      await trainer.start();
      io.emit('selfPlayStatus', { active: true, gameNumber: trainer.getStatus().stats.gamesPlayed });
    } catch (err) {
      console.error('[WS] startSelfPlay error:', err.message);
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('stopSelfPlay', () => {
    console.log(`[WS] stopSelfPlay from ${socket.id}`);
    trainer.stop();
    io.emit('selfPlayStatus', { active: false });
  });
});

// ── AI move helper ──────────────────────────────────────────────────────────
async function aiMove(currentState) {
  try {
    // Get legal moves for AI
    const { moves: legalMoves } = await cppFetch('/api/legal-moves');
    if (!legalMoves || legalMoves.length === 0) {
      console.log('[AI] No legal moves for AI');
      return;
    }

    // Assign index to each legal move (C++ engine doesn't provide it)
    // Use array position as index — model policy maps to these indices
    const movesWithIndex = legalMoves.map((m, i) => ({ ...m, index: i }));

    // Predict best move
    const turn = colorToTurn(currentState.turn);
    // Convert board back to flat int array for model
    // C++ encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
    const boardFlat = currentState.board.flat().map(p => {
      if (!p) return 0;
      if (p.color === 'white') return p.king ? 2 : 1;
      return p.king ? 4 : 3;
    });

    const predRes = await fetch('http://localhost:3000/api/ai/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: boardFlat, legalMoves: movesWithIndex, turn }),
    });

    if (!predRes.ok) {
      console.error('[AI] Predict failed:', predRes.status);
      // Fallback: random move
      const randomIdx = Math.floor(Math.random() * legalMoves.length);
      const randomMove = legalMoves[randomIdx];
      await cppFetch('/api/move', {
        method: 'POST',
        body: JSON.stringify({ from: randomMove.from, to: randomMove.to }),
      });
      return;
    }

    const prediction = await predRes.json();
    const moveIndex = prediction.move;

    // Find the actual move from legalMoves by index
    let selectedMove = legalMoves[moveIndex] || legalMoves[0];

    // Execute AI move via C++
    await cppFetch('/api/move', {
      method: 'POST',
      body: JSON.stringify({ from: selectedMove.from, to: selectedMove.to }),
    });

    console.log(`[AI] Played move: ${JSON.stringify(selectedMove.from)} → ${JSON.stringify(selectedMove.to)}`);
  } catch (err) {
    console.error('[AI] Move error:', err.message);
    // Fallback: try random move
    try {
      const { moves: legalMoves } = await cppFetch('/api/legal-moves');
      if (legalMoves && legalMoves.length > 0) {
        const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        await cppFetch('/api/move', {
          method: 'POST',
          body: JSON.stringify({ from: randomMove.from, to: randomMove.to }),
        });
      }
    } catch (_) { /* give up */ }
  }
}

// ── Auto-save timers ────────────────────────────────────────────────────────
// Single coherent save schedule: state every 30s, buffer every 2min, model every 5min
let _saving = false;
let _lastBufferSave = 0;
let _lastModelSave = 0;

setInterval(async () => {
  if (_saving) return;
  _saving = true;
  try {
    const now = Date.now();

    // State: every 30s
    await trainer.saveState();

    // Buffer: every 2 minutes
    if (now - _lastBufferSave >= 2 * 60 * 1000) {
      await trainer.buffer.save(BUFFER_FILE);
      _lastBufferSave = now;
    }

    // Models: every 5 minutes
    if (now - _lastModelSave >= 5 * 60 * 1000) {
      if (trainer.modelWhite) await saveModel(trainer.modelWhite, path.join(MODEL_DIR, 'white'));
      if (trainer.modelBlack) await saveModel(trainer.modelBlack, path.join(MODEL_DIR, 'black'));
      _lastModelSave = now;
    }
  } catch (err) {
    console.error('[AutoSave] Save error:', err.message);
  } finally {
    _saving = false;
  }
}, 30 * 1000);

// ── Start ───────────────────────────────────────────────────────────────────
async function main() {
  // Init models
  await trainer.init();

  // Load existing buffer if available
  try {
    await trainer.buffer.load(BUFFER_FILE);
  } catch (err) {
    console.log('[Server] No existing buffer to load');
  }

  // Load persistent state (stats, epsilon, etc.)
  await trainer.loadState();

  httpServer.listen(PORT, () => {
    console.log(`[Server] Checkers server running on http://localhost:${PORT}`);
  });

  // Auto-start self-play
  try {
    await trainer.start();
    console.log('[Server] Self-play auto-started');
  } catch (err) {
    console.error('[Server] Self-play auto-start failed:', err.message);
  }
}

main().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
