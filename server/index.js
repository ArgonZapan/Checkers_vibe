process.env.TF_ENABLE_ONEDNN_OPTS = process.env.TF_ENABLE_ONEDNN_OPTS || '1';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import { setupProxy } from './proxy.js';
import { SelfPlay } from './ai/trainer.js';
import { predict, createModel, train } from './ai/model.js';
import { saveModel, loadModel, computePolicyIndex } from './ai/model.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import { boardFromCpp, boardToCpp } from './boardConvert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || CONFIG.server.port;
const MODEL_DIR = path.join(__dirname, '..', 'data', 'model');
const BUFFER_FILE = path.join(__dirname, '..', 'data', 'buffer.json');

const app = express();
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: CONFIG.server.corsOrigin || 'http://localhost:3000' }
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

    const result = await predict(model, board, legalMoves, turn);
    res.json(result);
  } catch (err) {
    console.error('[AI] Predict error:', err);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

app.post('/api/ai/train', async (req, res) => {
  try {
    const batch = req.body.batch || [];
    if (batch.length === 0) {
      return res.status(400).json({ error: 'Empty batch' });
    }
    const lossWhite = await train(trainer.modelWhite, batch, CONFIG.ai.trainEpochs);
    const lossBlack = await train(trainer.modelBlack, batch, CONFIG.ai.trainEpochs);
    const avgLoss = ((lossWhite.loss || 0) + (lossBlack.loss || 0)) / 2;
    io.emit('train', { loss: avgLoss });
    res.json({ loss: avgLoss });
  } catch (err) {
    console.error('[AI] Train error:', err);
    res.status(500).json({ error: 'Training failed' });
  }
});

app.post('/api/ai/params', (req, res) => {
  const { epsilon, networkSize, side = 'both' } = req.body;
  // Validate epsilon
  if (epsilon != null && (typeof epsilon !== 'number' || epsilon < 0 || epsilon > 1)) {
    return res.status(400).json({ error: 'epsilon must be 0-1' });
  }
  if (networkSize != null && !['small', 'medium', 'large'].includes(networkSize)) {
    return res.status(400).json({ error: 'networkSize must be small|medium|large' });
  }
  trainer.setParams(epsilon, networkSize, side);
  io.emit('paramsChange', { epsilon, networkSize, side });
  res.json({ ok: true, ...trainer.getStatus() });
});

app.post('/api/ai/reset', async (_req, res) => {
  try {
    await trainer.resetModel();
    // Reset C++ game state
    await cppFetch('/api/game/reset', { method: 'POST', body: '{}' }).catch(() => {});
    io.emit('selfPlayStatus', { active: false, gameNumber: 0, stats: trainer.stats });
    res.json({ ok: true, stats: trainer.getStatus().stats });
  } catch (err) {
    console.error('[AI] Reset error:', err);
    res.status(500).json({ error: 'Reset failed' });
  }
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
const CPP_BASE = CONFIG.server.cppBase;

// Helper: convert between client color strings and C++ int turns
const colorToTurn = (color) => color === 'white' ? 1 : -1;
const turnToColor = (turn) => {
  if (typeof turn === 'string') return turn; // already a color string (C++ engine format)
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return 'white'; // default fallback (e.g., turn === 0 for draw)
};

// Helper: fetch JSON from C++ backend with timeout
const CPP_FETCH_TIMEOUT_MS = CONFIG.server.fetchTimeoutMs;
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
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[cppFetch] ${opts.method || 'GET'} ${path} → ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
      throw new Error(`C++ ${path} → ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[cppFetch] Timeout after ${CPP_FETCH_TIMEOUT_MS}ms: ${opts.method || 'GET'} ${path}`);
      throw new Error(`C++ engine timeout (${CPP_FETCH_TIMEOUT_MS}ms) — engine may be crashed`);
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
      console.error(`[cppFetch] Connection failed: ${opts.method || 'GET'} ${path} — engine may be down`);
      throw new Error(`C++ engine unreachable — ${err.code}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Helper: get full game state from C++ engine and return client-friendly format
async function getGameState() {
  const [state, { moves: legalMoves }] = await Promise.all([
    cppFetch('/api/game/state'),
    cppFetch('/api/legal-moves'),
  ]);
  const board = boardFromCpp(state.board);
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

// ── Player move handler (extracted for serialization) ───────────────────────
async function handleMove(socket, { from, to, captures }) {
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
  // Player's move path for animation
  const playerPath = moveResult.path || null;
  const playerBoard = state.board;

  // 3. If PvAI and game not over → first emit player's move, then AI makes its move
  if (isPvAI && !state.gameOver) {
    // Emit player's state first (with animation path)
    const playerPayload = {
      ...state,
      lastMove: { from, to, captures: moveCaptures },
      path: playerPath,
    };
    socket.emit('state', playerPayload);

    // Wait for animation, then AI makes its move
    const animStepMs = CONFIG.animationStepDurationMs;
    const animDelay = (playerPath && playerPath.length > 2)
      ? playerPath.length * animStepMs + CONFIG.moveDelayMs
      : CONFIG.moveDelayMs;
    await new Promise(r => setTimeout(r, animDelay));
    await aiMove(state);
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
      socket.emit('error', { message: 'Failed to start game' });
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
      socket.emit('error', { message: 'Failed to get legal moves' });
    }
  });

  // ── Player move (PvAI / PvP) — serialized per-socket to prevent races ───
  socket.on('move', (data) => {
    // Validate move coordinates
    const { from, to, captures } = data || {};
    const isValidCoord = (c) =>
      Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1])
      && c[0] >= 0 && c[0] <= 7 && c[1] >= 0 && c[1] <= 7;

    if (!isValidCoord(from)) {
      socket.emit('error', { message: 'Invalid "from" coordinate — expected [row, col] with values 0-7' });
      return;
    }
    if (!isValidCoord(to)) {
      socket.emit('error', { message: 'Invalid "to" coordinate — expected [row, col] with values 0-7' });
      return;
    }
    if (captures != null && !Array.isArray(captures)) {
      socket.emit('error', { message: 'Invalid "captures" — expected an array' });
      return;
    }

    socket._moveQueue = (socket._moveQueue || Promise.resolve())
      .then(() => handleMove(socket, data))
      .catch(err => {
        console.error('[WS] move error:', err.message);
        socket.emit('error', { message: 'Move failed' });
      });
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
      socket.emit('error', { message: 'Failed to start self-play' });
    }
  });

  socket.on('stopSelfPlay', () => {
    console.log(`[WS] stopSelfPlay from ${socket.id}`);
    trainer.stop();
    io.emit('selfPlayStatus', { active: false });
  });

  // ── Model params ──────────────────────────────────────────────────────
  socket.on('setParams', async (newParams) => {
    try {
      // Auth: only allow in aivai mode — PvAI/PvP players must not change the model
      if (socket.gameMode !== 'aivai') {
        console.warn(`[WS] setParams rejected — mode is '${socket.gameMode}', not 'aivai'`);
        socket.emit('error', { message: 'Zmiana parametrów modelu dozwolona tylko w trybie AI vs AI' });
        return;
      }

      // Validate params ranges
      const errors = [];
      if (newParams.layers != null && (newParams.layers < 1 || newParams.layers > 5)) {
        errors.push(`layers=${newParams.layers} (zakres: 1-5)`);
      }
      if (newParams.neurons != null && (newParams.neurons < 32 || newParams.neurons > 512)) {
        errors.push(`neurons=${newParams.neurons} (zakres: 32-512)`);
      }
      if (newParams.batchSize != null && (newParams.batchSize < 8 || newParams.batchSize > 256)) {
        errors.push(`batchSize=${newParams.batchSize} (zakres: 8-256)`);
      }
      if (newParams.dropout != null && (newParams.dropout < 0 || newParams.dropout > 0.5)) {
        errors.push(`dropout=${newParams.dropout} (zakres: 0-0.5)`);
      }
      if (errors.length > 0) {
        console.warn(`[WS] setParams validation failed: ${errors.join(', ')}`);
        socket.emit('error', { message: `Nieprawidłowe parametry: ${errors.join('; ')}` });
        return;
      }

      console.log(`[WS] setParams from ${socket.id}:`, newParams);
      const wasRunning = trainer.running;
      // 1. Stop self-play
      trainer.stop();
      // 2. Increment params version to invalidate in-flight _playGame (#133)
      trainer.paramsVersion++;
      // 3. Update params
      trainer.setModelParams(newParams);
      // 4. Create fresh models with new architecture
      trainer.modelWhite = createModel({ ...trainer.modelParams });
      trainer.modelBlack = createModel({ ...trainer.modelParams });
      // 5. Clear buffer
      trainer.buffer.clear();
      // 6. Reset stats
      trainer.stats.gamesPlayed = 0;
      trainer.stats.whiteWins = 0;
      trainer.stats.blackWins = 0;
      trainer.stats.draws = 0;
      trainer.stats.lastLoss = null;
      // 7. Broadcast updated params
      io.emit('paramsUpdate', { modelParams: { ...trainer.modelParams } });
      io.emit('selfPlayStatus', { active: false, gameNumber: 0, stats: trainer.stats });
      // 8. Restart if was running
      if (wasRunning) {
        await trainer.start();
      }
      console.log('[WS] setParams complete — model reset');
    } catch (err) {
      console.error('[WS] setParams error:', err.message);
      socket.emit('error', { message: 'Failed to update parameters' });
    }
  });

  // ── Speed control ──────────────────────────────────────────────────────
  socket.on('setSpeed', (ms) => {
    // Validate: must be a number 0-10000, not NaN
    if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
      socket.emit('error', { message: 'Invalid speed value' });
      return;
    }
    const clamped = Math.max(0, Math.min(ms, 10000));
    CONFIG.server.aiMoveDelayMs = clamped;
    if (clamped > 0) CONFIG.server.normalModeDelayMs = clamped;
    console.log(`[WS] Speed set to ${clamped}ms`);
  });

  // ── Speed mode control ────────────────────────────────────────────────
  socket.on('setSpeedMode', (mode) => {
    if (mode === 'fast' || mode === 'normal') {
      CONFIG.server.speedMode = mode;
      console.log(`[WS] Speed mode set to: ${mode}`);
    }
  });

  // ── Full reset (model + stats + buffer + game) ─────────────────────────
  socket.on('reset', async () => {
    try {
      console.log(`[WS] reset from ${socket.id}`);
      await trainer.resetModel();
      // Reset C++ game state
      await cppFetch('/api/game/reset', { method: 'POST', body: '{}' }).catch(() => {});
      // Broadcast reset status to all clients
      io.emit('selfPlayStatus', { active: false, gameNumber: 0, stats: trainer.stats });
      io.emit('modelRestart', { side: 'both' });
      console.log('[WS] Full reset complete');
    } catch (err) {
      console.error('[WS] reset error:', err.message);
      socket.emit('error', { message: 'Reset failed' });
    }
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
    const movesWithIndex = legalMoves.map((m, i) => ({
      ...m,
      index: i,
      policyIndex: computePolicyIndex(m.from, m.to),
    }));

    // Predict best move (direct call instead of HTTP self-call)
    const turn = colorToTurn(currentState.turn);
    const boardFlat = boardToCpp(currentState.board);

    let prediction;
    try {
      const model = turn === 1 ? trainer.modelWhite : trainer.modelBlack;
      if (!model) throw new Error('Model not initialized');
      prediction = await predict(model, boardFlat, movesWithIndex, turn);
    } catch (err) {
      console.error('[AI] Predict failed:', err.message);
      // Fallback: random move
      const randomIdx = Math.floor(Math.random() * legalMoves.length);
      const randomMove = legalMoves[randomIdx];
      const fallbackBody = { from: randomMove.from, to: randomMove.to };
      if (randomMove.captures && randomMove.captures.length > 0) {
        fallbackBody.captures = randomMove.captures;
      }
      await cppFetch('/api/move', {
        method: 'POST',
        body: JSON.stringify(fallbackBody),
      });
      return;
    }

    // predict() returns { move: moveObject, ... } — use it directly
    // (prediction.move IS the selected legal move object, not an index)
    let selectedMove = prediction.move;
    // Safety: validate the predicted move is actually in legalMoves
    if (!selectedMove || !legalMoves.some(m => m.from === selectedMove.from && m.to === selectedMove.to)) {
      console.warn('[AI] Predicted move not in legal moves, falling back to random');
      selectedMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    // Execute AI move via C++
    const aiMoveBody = { from: selectedMove.from, to: selectedMove.to };
    if (selectedMove.captures && selectedMove.captures.length > 0) {
      aiMoveBody.captures = selectedMove.captures;
    }
    await cppFetch('/api/move', {
      method: 'POST',
      body: JSON.stringify(aiMoveBody),
    });

    console.log(`[AI] Played move: ${JSON.stringify(selectedMove.from)} → ${JSON.stringify(selectedMove.to)}`);
  } catch (err) {
    console.error('[AI] Move error:', err.message);
    // Fallback: try random move
    try {
      const { moves: legalMoves } = await cppFetch('/api/legal-moves');
      if (legalMoves && legalMoves.length > 0) {
        const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        const fbBody = { from: randomMove.from, to: randomMove.to };
        if (randomMove.captures && randomMove.captures.length > 0) {
          fbBody.captures = randomMove.captures;
        }
        await cppFetch('/api/move', {
          method: 'POST',
          body: JSON.stringify(fbBody),
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
  // Skip save if nothing changed since last save (#102)
  if (!trainer.dirty) return;
  _saving = true;
  try {
    const now = Date.now();

    // State: every 30s (only when dirty)
    await trainer.saveState();
    trainer.dirty = false; // reset after save (#102)

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
}, CONFIG.server.autoSaveMs);

// ── Start ───────────────────────────────────────────────────────────────────
async function main() {
  // Init models
  await trainer.init();

  // Load existing buffer if available (buffer.load() handles ENOENT internally)
  await trainer.buffer.load(BUFFER_FILE);

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
