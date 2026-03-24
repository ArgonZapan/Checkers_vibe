process.env.TF_ENABLE_ONEDNN_OPTS = process.env.TF_ENABLE_ONEDNN_OPTS || '1';
import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIO } from 'socket.io';
import { setupProxy } from './proxy.js';
import { SelfPlay } from './ai/trainer.js';
import { predict, createModel, train } from './ai/model.js';
import { saveModel, computePolicyIndex } from './ai/model.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import { boardFromCpp, boardToCpp } from './boardConvert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || CONFIG.server.port;
const MODEL_DIR = path.join(__dirname, '..', 'data', 'model');
const BUFFER_FILE = path.join(__dirname, '..', 'data', 'buffer.json');

const app = express();
app.set('trust proxy', false); // SEC: prevent IP spoofing via X-Forwarded-For
app.disable('X-Powered-By'); // SEC-001: prevent framework disclosure
const httpServer = createServer(app);
// SEC #158: WebSocket origin validation — if CORS_ORIGIN=* don't allow any origin on WS upgrade
const CORS_ORIGIN = CONFIG.server.corsOrigin || 'http://localhost:3000';
const _corsOriginList = CORS_ORIGIN === '*' ? [] : CORS_ORIGIN.split(',').map(s => s.trim());

function _isAllowedWsOrigin(origin) {
  if (!origin) return true; // same-origin or non-browser (no Origin header)
  if (CORS_ORIGIN === '*') return false; // wildcard CORS ≠ wildcard WS — block unknown origins
  return _corsOriginList.some(allowed => origin === allowed);
}

const io = new SocketIO(httpServer, {
  cors: { origin: CORS_ORIGIN },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!_isAllowedWsOrigin(origin)) {
      return callback(null, false); // reject handshake
    }
    callback(null, true);
  },
});

// ── Security Headers (LEAK-001) ─────────────────────────────────────────────
app.use((_req, res, next) => {
  res.removeHeader('X-Powered-By'); // SEC-001: defense-in-depth
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // SEC: bare `ws:` scheme allows unencrypted WS to any origin — only allow in local dev (CSP_ALLOW_WS=true)
  const wsDirectives = process.env.CSP_ALLOW_WS === 'true' ? 'ws: wss:' : 'wss:';
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${wsDirectives}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
  next();
});

// ── Rate Limiting (LEAK-002) ────────────────────────────────────────────────
const _rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 min
const RATE_LIMIT_MAX = 120; // 120 req/min per IP
const RATE_LIMIT_MAX_ENTRIES = 10_000;

// Periodic cleanup of expired rate limit entries to prevent unbounded memory growth
const _rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      _rateLimitMap.delete(ip);
    }
  }
  // Hard cap: if still over limit after cleanup, evict oldest entries
  if (_rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    const sorted = [..._rateLimitMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const evictCount = _rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES;
    for (let i = 0; i < evictCount; i++) {
      _rateLimitMap.delete(sorted[i][0]);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  let entry = _rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // SEC #161: guard against OOM — if map is full and this is a new IP, evict oldest or reject
    if (!entry && _rateLimitMap.size >= RATE_LIMIT_MAX_ENTRIES) {
      // Evict oldest entry (smallest windowStart)
      let oldestIp = null;
      let oldestTime = Infinity;
      for (const [k, v] of _rateLimitMap) {
        if (v.windowStart < oldestTime) {
          oldestTime = v.windowStart;
          oldestIp = k;
        }
      }
      if (oldestIp) _rateLimitMap.delete(oldestIp);
    }
    entry = { windowStart: now, count: 0 };
    _rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

// ── Auth middleware (SEC #157) ───────────────────────────────────────────────
function requireApiToken(req, res, next) {
  const token = process.env.API_TOKEN;
  if (!token) return next(); // dev mode — no token set
  const provided = req.headers['authorization']?.replace(/^Bearer\s+/i, '')
    || req.query?.token;
  if (provided !== token) {
    return res.status(401).json({ error: 'Unauthorized — valid token required' });
  }
  next();
}

// ── WS auth helper (SEC #157) ───────────────────────────────────────────────
function wsAuth(socket) {
  const token = process.env.API_TOKEN;
  if (!token) return true; // dev mode — no token set
  const provided = socket.handshake.auth?.token
    || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '').trim();
  return provided === token;
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

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
      return res.status(400).json({ error: 'Invalid request: missing required fields' });
    }
    if (!Array.isArray(board) || board.length !== 64) {
      return res.status(400).json({ error: 'Invalid request: bad board format' });
    }
    for (let i = 0; i < board.length; i++) {
      if (typeof board[i] !== 'number' || !Number.isInteger(board[i]) || board[i] < 0 || board[i] > 4) {
        return res.status(400).json({ error: 'Invalid request: bad board data' });
      }
    }
    if (!Array.isArray(legalMoves)) {
      return res.status(400).json({ error: 'Invalid request: bad moves format' });
    }
    // Validate each legal move has valid from/to coordinates
    for (let i = 0; i < legalMoves.length; i++) {
      const m = legalMoves[i];
      if (!m || typeof m !== 'object') {
        return res.status(400).json({ error: 'Invalid request: bad move data' });
      }
      const isValidCoord = (c) => Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] >= 0 && c[0] <= 7 && c[1] >= 0 && c[1] <= 7;
      if (!isValidCoord(m.from)) {
        return res.status(400).json({ error: 'Invalid request: bad move data' });
      }
      if (!isValidCoord(m.to)) {
        return res.status(400).json({ error: 'Invalid request: bad move data' });
      }
      if (m.captures != null) {
        if (!Array.isArray(m.captures)) {
          return res.status(400).json({ error: 'Invalid request: bad move data' });
        }
        for (let j = 0; j < m.captures.length; j++) {
          if (!isValidCoord(m.captures[j])) {
            return res.status(400).json({ error: 'Invalid request: bad move data' });
          }
        }
      }
    }
    // Compute canonical policyIndex for each legal move (predict() uses it for policy masking)
    const movesWithPolicy = legalMoves.map(m => ({
      ...m,
      policyIndex: computePolicyIndex(m.from, m.to),
    }));
    // Acquire model lock — prevent dispose during prediction (#160)
    let modelRelease;
    try {
      modelRelease = await trainer.acquireModelLock();
      const model = turn === 1 ? trainer.modelWhite : trainer.modelBlack;
      if (!model) return res.status(503).json({ error: 'Model not initialized' });
      const result = await predict(model, board, movesWithPolicy, turn);
      res.json(result);
    } finally {
      if (modelRelease) modelRelease();
    }
  } catch (err) {
    console.error('[AI] Predict error:', err.message);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

app.post('/api/ai/train', requireApiToken, async (req, res) => {
  try {
    const batch = req.body.batch || [];
    if (batch.length === 0) {
      return res.status(400).json({ error: 'Invalid request: empty batch' });
    }
    if (batch.length > 10000) {
      return res.status(400).json({ error: 'Invalid request: batch too large' });
    }
    // Validate batch structure (LEAK-007) — validate ALL samples
    for (let i = 0; i < batch.length; i++) {
      const s = batch[i];
      if (!s || typeof s !== 'object') {
        return res.status(400).json({ error: 'Invalid request: bad sample data' });
      }
      if (!Array.isArray(s.board) || s.board.length !== 64) {
        return res.status(400).json({ error: 'Invalid request: bad sample data' });
      }
      // Validate board element values — prevent NaN/string corruption in training
      for (let j = 0; j < s.board.length; j++) {
        if (typeof s.board[j] !== 'number' || !Number.isInteger(s.board[j]) || s.board[j] < 0 || s.board[j] > 4) {
          return res.status(400).json({ error: 'Invalid request: bad sample data' });
        }
      }
      if (s.turn !== 1 && s.turn !== -1) {
        return res.status(400).json({ error: 'Invalid request: bad sample data' });
      }
    }
    // Filter batch by turn — each model should only train on its own samples
    const batchWhite = batch.filter(s => s.turn === 1);
    const batchBlack = batch.filter(s => s.turn === -1);
    // Acquire model lock — prevent dispose during training (#160)
    let trainRelease;
    try {
      trainRelease = await trainer.acquireModelLock();
      const lossWhite = batchWhite.length > 0 ? await train(trainer.modelWhite, batchWhite, CONFIG.ai.trainEpochs) : { loss: 0 };
      const lossBlack = batchBlack.length > 0 ? await train(trainer.modelBlack, batchBlack, CONFIG.ai.trainEpochs) : { loss: 0 };
      const avgLoss = ((lossWhite.loss || 0) + (lossBlack.loss || 0)) / 2;
      io.emit('train', { loss: avgLoss });
      res.json({ loss: avgLoss });
    } finally {
      if (trainRelease) trainRelease();
    }
  } catch (err) {
    console.error('[AI] Train error:', err.message);
    res.status(500).json({ error: 'Training failed' });
  }
});

app.post('/api/ai/params', requireApiToken, (req, res) => {
  const { epsilon, networkSize, side = 'both' } = req.body;
  // Validate epsilon — reject NaN, Infinity, and out-of-range values
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return res.status(400).json({ error: 'epsilon must be a finite number 0-1' });
  }
  if (networkSize != null && !['small', 'medium', 'large'].includes(networkSize)) {
    return res.status(400).json({ error: 'networkSize must be small|medium|large' });
  }
  // trainer.setParams() already recreates models when networkSize changes via _replaceModel
  trainer.setParams(epsilon, networkSize, side);
  io.emit('paramsChange', { epsilon, networkSize, side });
  res.json({ ok: true, ...trainer.getStatus() });
});

app.post('/api/ai/reset', requireApiToken, async (_req, res) => {
  try {
    // BUG-008: Acquire lock so resetModel waits for any in-progress save
    let release;
    try {
      release = await acquireLock();
    } catch (_) { return res.status(503).json({ error: 'Reset locked' }); }
    try {
      await trainer.resetModel();
    } finally {
      release();
    }
    // Reset C++ game state
    await cppFetch('/api/game/reset', { method: 'POST', body: '{}' }).catch(() => {});
    io.emit('selfPlayStatus', { active: false, gameNumber: 0, stats: trainer.stats });
    res.json({ ok: true, stats: trainer.getStatus().stats });
  } catch (err) {
    console.error('[AI] Reset error:', err.message);
    res.status(500).json({ error: 'Reset failed' });
  }
});

app.post('/api/ai/restart', requireApiToken, async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Bad request: expected JSON body' });
  }
  const { side = 'both' } = req.body;
  if (!['white', 'black', 'both'].includes(side)) {
    return res.status(400).json({ error: 'side must be white|black|both' });
  }
  await trainer.restart(side);
  res.json({ ok: true });
});

app.get('/api/ai/stats', (_req, res) => {
  res.json(trainer.getStatus().stats);
});

// ── SelfPlay endpoints ──────────────────────────────────────────────────────
app.post('/api/selfplay/start', requireApiToken, async (_req, res) => {
  await trainer.start();
  res.json({ ok: true, running: true });
});

app.post('/api/selfplay/stop', requireApiToken, (_req, res) => {
  trainer.stop();
  res.json({ ok: true, running: false });
});

app.get('/api/selfplay/status', requireApiToken, (_req, res) => {
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
  return null; // 0 = draw/no turn — don't misleadingly return 'white'
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
      // Don't log response body — could leak internal C++ errors/paths
      await res.text().catch(() => '');
      console.error(`[cppFetch] ${opts.method || 'GET'} ${path} → ${res.status}`);
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
  try {
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
  } catch (err) {
    console.error('[getGameState] Error fetching game state:', err.message);
    return {
      board: Array(64).fill(0),
      turn: 'white',
      legalMoves: [],
      gameOver: true,
      winner: null,
      lastMove: null,
      error: 'Failed to fetch game state',
    };
  }
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
  let aiLastMove = null; // track AI move for lastMove in final state
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
    const aiMoveResult = await aiMove(state);

    // Use AI move response for animation path and lastMove tracking
    if (aiMoveResult) {
      // Extract AI's move from the C++ response for lastMove
      if (aiMoveResult.from && aiMoveResult.to) {
        aiLastMove = {
          from: Array.isArray(aiMoveResult.from) ? aiMoveResult.from : [Math.floor(aiMoveResult.from / 8), aiMoveResult.from % 8],
          to: Array.isArray(aiMoveResult.to) ? aiMoveResult.to : [Math.floor(aiMoveResult.to / 8), aiMoveResult.to % 8],
          captures: aiMoveResult.captures || [],
        };
      }
      if (aiMoveResult.path && aiMoveResult.path.length > 2) {
        const aiPath = aiMoveResult.path;
        const aiAnimDelay = aiPath.length * animStepMs + CONFIG.moveDelayMs;
        // Emit intermediate state with animation path for AI move
        const aiBoard = boardFromCpp(aiMoveResult.board);
        const aiStatePayload = {
          board: aiBoard,
          turn: turnToColor(aiMoveResult.turn ?? aiMoveResult.currentTurn ?? 1),
          legalMoves: [],
          gameOver: aiMoveResult.gameOver ?? false,
          winner: aiMoveResult.winner != null ? turnToColor(aiMoveResult.winner) : null,
          lastMove: aiLastMove || state.lastMove,
          path: aiPath,
        };
        socket.emit('state', aiStatePayload);
        await new Promise(r => setTimeout(r, aiAnimDelay));
      } else {
        // Fallback: no path data, add move delay for consistency
        if (CONFIG.moveDelayMs > 0) await new Promise(r => setTimeout(r, CONFIG.moveDelayMs));
      }
    }

    // Fetch final state after AI move
    state = await getGameState();
  }

  // 4. Emit new state — in PvP broadcast to all, in PvAI emit to requesting client
  // In PvAI, use AI's lastMove if available, otherwise fall back to player's move
  const finalLastMove = isPvAI && aiLastMove
    ? aiLastMove
    : (state.lastMove || { from, to, captures: moveCaptures });
  const statePayload = {
    ...state,
    lastMove: finalLastMove,
  };
  if (socket.gameMode === 'pvp') {
    io.emit('state', statePayload);
  } else {
    socket.emit('state', statePayload);
  }

  // 5. If game over, emit gameOver event and resume self-play (only in aivai mode)
  if (state.gameOver) {
    const gameOverPayload = { winner: state.winner, moves: 0 };
    if (socket.gameMode === 'pvp') {
      io.emit('gameOver', gameOverPayload);
    } else {
      socket.emit('gameOver', gameOverPayload);
    }
    // Only restart self-play for aivai mode, not after player games
    if (socket.gameMode === 'aivai') {
      setTimeout(() => trainer.start(), 3000);
    }
  }
}

// Per-socket throttle helper (LEAK-012)
function wsThrottle(socket, key, minIntervalMs) {
  const now = Date.now();
  const last = socket._throttle?.[key] || 0;
  if (now - last < minIntervalMs) return false;
  if (!socket._throttle) socket._throttle = {};
  socket._throttle[key] = now;
  return true;
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
  socket.emit('selfPlayStatus', { active: trainer.running, gameNumber: trainer.stats.gamesPlayed, stats: trainer.stats });
  // Send current model params so UI matches server state on connect
  socket.emit('paramsUpdate', {
    modelParams: { ...trainer.modelParams },
    whiteEpsilon: trainer.epsilonWhite,
    blackEpsilon: trainer.epsilonBlack,
    whiteNetworkSize: trainer.networkSizeWhite,
    blackNetworkSize: trainer.networkSizeBlack,
    speedMode: CONFIG.server.speedMode,
    aiMoveDelayMs: CONFIG.server.aiMoveDelayMs,
    whiteStrategy: CONFIG.ai.strategy.white,
    blackStrategy: CONFIG.ai.strategy.black,
  });
  if (trainer.stats.lastLoss != null) {
    socket.emit('loss', { loss: trainer.stats.lastLoss });
  }

  // ── Start game — serialized per-socket to avoid C++ state conflict with ongoing move (#159) ──
  socket.on('startGame', async ({ mode }) => {
    // Throttle: max 1 startGame per 1s per socket
    if (!wsThrottle(socket, 'startGame', 1000)) return;
    // Queue onto move queue — wait for any in-flight move to finish before starting new game
    socket._moveQueue = (socket._moveQueue || Promise.resolve())
      .then(async () => {
        const validModes = ['pvai', 'pvp', 'aivai'];
        socket.gameMode = validModes.includes(mode) ? mode : 'pvai';
        // Stop self-play when starting a player game (C++ handles one game at a time)
        if (trainer.running && socket.gameMode !== 'aivai') {
          trainer.stop();
          // Invalidate any in-flight self-play game to prevent C++ state conflict
          trainer.paramsVersion++;
        }
        await cppFetch('/api/game/start', { method: 'POST', body: '{}' });
        const state = await getGameState();
        socket.emit('state', state);
        console.log(`[WS] Game started (${socket.gameMode}) for ${socket.id}`);
        // Auto-start trainer for aivai mode
        if (socket.gameMode === 'aivai') {
          await trainer.start();
        }
      })
      .catch(err => {
        console.error('[WS] startGame error:', err.message);
        socket.emit('error', { message: 'Failed to start game' });
        socket._moveQueue = Promise.resolve();
      });
  });

  // ── Get legal moves for a piece ────────────────────────────────────────
  socket.on('getLegalMoves', async ({ from }) => {
    // Throttle: max 1 getLegalMoves per 50ms per socket (called on hover)
    if (!wsThrottle(socket, 'getLegalMoves', 50)) return;
    // Validate from coordinate
    if (!Array.isArray(from) || from.length !== 2
      || !Number.isInteger(from[0]) || !Number.isInteger(from[1])
      || from[0] < 0 || from[0] > 7 || from[1] < 0 || from[1] > 7) {
      socket.emit('error', { message: 'Invalid request data' });
      return;
    }
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
    // Throttle: max 1 move per 50ms per socket (prevents spam)
    if (!wsThrottle(socket, 'move', 50)) return;
    // Validate move coordinates
    const { from, to, captures } = data || {};
    const isValidCoord = (c) =>
      Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1])
      && c[0] >= 0 && c[0] <= 7 && c[1] >= 0 && c[1] <= 7;

    if (!isValidCoord(from)) {
      socket.emit('error', { message: 'Invalid move data' });
      return;
    }
    if (!isValidCoord(to)) {
      socket.emit('error', { message: 'Invalid move data' });
      return;
    }
    if (captures != null && !Array.isArray(captures)) {
      socket.emit('error', { message: 'Invalid move data' });
      return;
    }
    // Validate captures elements are valid coordinates (LEAK-010)
    if (Array.isArray(captures)) {
      for (let i = 0; i < captures.length; i++) {
        if (!isValidCoord(captures[i])) {
          socket.emit('error', { message: 'Invalid move data' });
          return;
        }
      }
    }

    socket._moveQueue = (socket._moveQueue || Promise.resolve())
      .then(() => handleMove(socket, data))
      .catch(err => {
        console.error('[WS] move error:', err.message);
        socket.emit('error', { message: 'Move failed' });
        socket._moveQueue = Promise.resolve();
      });
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });

  // ── SelfPlay controls ─────────────────────────────────────────────────
  socket.on('startSelfPlay', async () => {
    // Throttle: max 1 startSelfPlay per 1s per socket
    if (!wsThrottle(socket, 'startSelfPlay', 1000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
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
    // Throttle: max 1 stopSelfPlay per 1s per socket
    if (!wsThrottle(socket, 'stopSelfPlay', 1000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    console.log(`[WS] stopSelfPlay from ${socket.id}`);
    trainer.stop();
    io.emit('selfPlayStatus', { active: false });
  });

  // ── Model params ──────────────────────────────────────────────────────
  socket.on('setParams', async (newParams) => {
    // Throttle: max 1 setParams per 1s per socket
    if (!wsThrottle(socket, 'setParams', 1000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    try {
      // Type-check input (LEAK-005)
      if (!newParams || typeof newParams !== 'object' || Array.isArray(newParams)) {
        socket.emit('error', { message: 'Invalid params — expected object' });
        return;
      }

      // Whitelist allowed keys to prevent prototype pollution (LEAK-011)
      const ALLOWED_PARAMS = new Set([
        'layers', 'neurons', 'activation', 'lr', 'batchSize', 'dropout',
        'minEpsilon', 'epsilonDecay', 'gamma', 'bufferSize', 'epochs',
        'rewardCapture', 'rewardLosePiece', 'rewardAdvance', 'rewardPromotion', 'rewardWin', 'rewardLose',
        'speedMode', 'aiMoveDelayMs', // speed settings (applied to CONFIG, not model)
        'whiteStrategy', 'blackStrategy', // strategy selection (DQN vs minimax)
        'minimaxDepth', // minimax search depth
      ]);
      const filtered = {};
      for (const key of Object.keys(newParams)) {
        if (ALLOWED_PARAMS.has(key)) {
          filtered[key] = newParams[key];
        }
      }
      newParams = filtered;

      // Auth: only allow in aivai mode — PvAI/PvP players must not change the model
      if (socket.gameMode !== 'aivai') {
        console.warn(`[WS] setParams rejected — mode is '${socket.gameMode}', not 'aivai'`);
        socket.emit('error', { message: 'Zmiana parametrów modelu dozwolona tylko w trybie AI vs AI' });
        return;
      }

      // Validate params ranges (NaN passes all comparisons, so check isFinite first)
      const errors = [];
      const numericKeys = ['layers', 'neurons', 'batchSize', 'dropout', 'lr', 'gamma', 'epochs', 'bufferSize',
        'minEpsilon', 'epsilonDecay', 'rewardCapture', 'rewardLosePiece', 'rewardPromotion', 'rewardWin', 'rewardLose'];
      for (const key of numericKeys) {
        if (newParams[key] != null && (typeof newParams[key] !== 'number' || !Number.isFinite(newParams[key]))) {
          errors.push(`${key}=${newParams[key]} (expected finite number)`);
        }
      }
      if (newParams.layers != null && Number.isFinite(newParams.layers) && (newParams.layers < 1 || newParams.layers > 5)) {
        errors.push(`layers=${newParams.layers} (zakres: 1-5)`);
      }
      if (newParams.neurons != null && Number.isFinite(newParams.neurons) && (newParams.neurons < 32 || newParams.neurons > 512)) {
        errors.push(`neurons=${newParams.neurons} (zakres: 32-512)`);
      }
      if (newParams.batchSize != null && Number.isFinite(newParams.batchSize) && (newParams.batchSize < 8 || newParams.batchSize > 256)) {
        errors.push(`batchSize=${newParams.batchSize} (zakres: 8-256)`);
      }
      if (newParams.dropout != null && Number.isFinite(newParams.dropout) && (newParams.dropout < 0 || newParams.dropout > 0.5)) {
        errors.push(`dropout=${newParams.dropout} (zakres: 0-0.5)`);
      }
      if (errors.length > 0) {
        console.warn(`[WS] setParams validation failed: ${errors.join(', ')}`);
        socket.emit('error', { message: `Nieprawidłowe parametry: ${errors.join('; ')}` });
        return;
      }

      console.log(`[WS] setParams from ${socket.id}:`, {
        speedMode: newParams.speedMode,
        aiMoveDelayMs: newParams.aiMoveDelayMs,
      });
      const wasRunning = trainer.running;

      // Handle speed settings (applied to CONFIG, no model reset needed)
      if (newParams.speedMode != null) {
        if (newParams.speedMode === 'fast' || newParams.speedMode === 'normal') {
          CONFIG.server.speedMode = newParams.speedMode;
        }
      }
      if (newParams.aiMoveDelayMs != null && typeof newParams.aiMoveDelayMs === 'number' && Number.isFinite(newParams.aiMoveDelayMs)) {
        const clamped = Math.max(0, Math.min(newParams.aiMoveDelayMs, 10000));
        CONFIG.server.aiMoveDelayMs = clamped;
        if (clamped > 0) CONFIG.server.normalModeDelayMs = clamped;
      }

      // Handle strategy changes (DQN vs minimax)
      const validStrategies = Object.keys(CONFIG.ai.strategies);
      if (newParams.whiteStrategy != null && validStrategies.includes(newParams.whiteStrategy)) {
        CONFIG.ai.strategy.white = newParams.whiteStrategy;
      }
      if (newParams.blackStrategy != null && validStrategies.includes(newParams.blackStrategy)) {
        CONFIG.ai.strategy.black = newParams.blackStrategy;
      }
      // Handle minimax depth — copy-on-write since strategies are deeply frozen
      if (newParams.minimaxDepth != null && typeof newParams.minimaxDepth === 'number' && Number.isFinite(newParams.minimaxDepth)) {
        if (CONFIG.ai.strategies.minimax) {
          const depth = Math.max(1, Math.min(8, Math.round(newParams.minimaxDepth)));
          CONFIG.ai.strategies.minimax = Object.freeze({ ...CONFIG.ai.strategies.minimax, depth });
        }
      }

      // Handle per-strategy reward weight updates (rewardAdvance, etc.)
      // These modify the active strategy config so calculateReward() uses new values.
      // Copy-on-write since strategies are deeply frozen.
      const STRATEGY_WEIGHT_KEYS = ['rewardCapture', 'rewardLosePiece', 'rewardAdvance', 'rewardPromotion', 'rewardWin', 'rewardLose'];
      for (const key of STRATEGY_WEIGHT_KEYS) {
        if (newParams[key] != null && typeof newParams[key] === 'number' && Number.isFinite(newParams[key])) {
          // Apply to both active strategies
          for (const stratName of [CONFIG.ai.strategy.white, CONFIG.ai.strategy.black]) {
            const strat = CONFIG.ai.strategies[stratName];
            if (strat && Object.hasOwn(strat, key)) {
              CONFIG.ai.strategies[stratName] = Object.freeze({ ...strat, [key]: newParams[key] });
            }
          }
        }
      }

      // 1. Stop self-play
      trainer.stop();
      // 2. Increment params version to invalidate in-flight _playGame (#133)
      trainer.paramsVersion++;
      // 3. Update non-model params (epsilon, etc.) — don't trigger model recreation here
      trainer.setModelParams(newParams);
      if (newParams.networkSize != null) {
        trainer.networkSizeWhite = newParams.networkSize;
        trainer.networkSizeBlack = newParams.networkSize;
      }
      // 4. Create fresh models with new architecture (use _replaceModel for proper lock chaining, #160)
      //    This unconditionally recreates — avoids double-creation with setModelParams above
      trainer.modelWhite = trainer._replaceModel(trainer.modelWhite, { ...trainer.modelParams });
      trainer.modelBlack = trainer._replaceModel(trainer.modelBlack, { ...trainer.modelParams });
      // 5. Clear buffer
      trainer.buffer.clear();
      // 6. Reset stats
      trainer.stats.gamesPlayed = 0;
      trainer.stats.whiteWins = 0;
      trainer.stats.blackWins = 0;
      trainer.stats.draws = 0;
      trainer.stats.lastLoss = null;
      // 7. Broadcast updated params
      io.emit('paramsUpdate', {
        modelParams: { ...trainer.modelParams },
        whiteEpsilon: trainer.epsilonWhite,
        blackEpsilon: trainer.epsilonBlack,
        whiteNetworkSize: trainer.networkSizeWhite,
        blackNetworkSize: trainer.networkSizeBlack,
        speedMode: CONFIG.server.speedMode,
        aiMoveDelayMs: CONFIG.server.aiMoveDelayMs,
        whiteStrategy: CONFIG.ai.strategy.white,
        blackStrategy: CONFIG.ai.strategy.black,
      });
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
    // Throttle: max 1 per 1s per socket
    if (!wsThrottle(socket, 'setSpeed', 1000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    // Auth: only allow in aivai mode (LEAK-006)
    if (socket.gameMode !== 'aivai') {
      console.warn(`[WS] setSpeed rejected — mode is '${socket.gameMode}', not 'aivai'`);
      socket.emit('error', { message: 'Zmiana prędkości dozwolona tylko w trybie AI vs AI' });
      return;
    }
    // Validate: must be a number 0-10000, not NaN (LEAK-006)
    if (typeof ms !== 'number' || ms < 0 || ms > 10000 || Number.isNaN(ms)) {
      socket.emit('error', { message: 'Invalid speed value — expected number 0-10000' });
      return;
    }
    const clamped = Math.max(0, Math.min(ms, 10000));
    CONFIG.server.aiMoveDelayMs = clamped;
    if (clamped > 0) CONFIG.server.normalModeDelayMs = clamped;
    else CONFIG.server.normalModeDelayMs = 0; // reset to 0 when speed is 0 (no fallback to stale value)
    io.emit('speedUpdate', { aiMoveDelayMs: clamped });
    console.log(`[WS] Speed set to ${clamped}ms`);
  });

  // ── Speed mode control ────────────────────────────────────────────────
  socket.on('setSpeedMode', (mode) => {
    // Throttle: max 1 per 1s per socket
    if (!wsThrottle(socket, 'setSpeedMode', 1000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    // Auth: only allow in aivai mode (LEAK-006)
    if (socket.gameMode !== 'aivai') {
      console.warn(`[WS] setSpeedMode rejected — mode is '${socket.gameMode}', not 'aivai'`);
      socket.emit('error', { message: 'Zmiana trybu prędkości dozwolona tylko w trybie AI vs AI' });
      return;
    }
    // Validate: must be a string (LEAK-006)
    if (typeof mode !== 'string') {
      socket.emit('error', { message: 'Invalid speed mode — expected string' });
      return;
    }
    if (mode === 'fast' || mode === 'normal') {
      CONFIG.server.speedMode = mode;
      socket.emit('speedUpdate', { speedMode: mode, confirmed: true });
      io.emit('speedUpdate', { speedMode: mode });
      console.log(`[WS] Speed mode set to: ${mode}`);
    } else {
      socket.emit('error', { message: `Invalid speed mode '${mode}' — expected 'fast' or 'normal'` });
      console.warn(`[WS] setSpeedMode rejected — invalid value: '${mode}'`);
    }
  });

  // ── Full reset (model + stats + buffer + game) ─────────────────────────
  socket.on('reset', async () => {
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    try {
      console.log(`[WS] reset from ${socket.id}`);
      // BUG-008: Acquire lock so resetModel waits for any in-progress save
      let release;
      try {
        release = await acquireLock();
      } catch (_) {
        socket.emit('error', { message: 'Reset locked — save in progress' });
        return;
      }
      try {
        await trainer.resetModel();
      } finally {
        release();
      }
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

  // ── Model restart (white/black/both) — resets model weights without clearing game state ──
  socket.on('restart', async ({ side }) => {
    // Throttle: max 1 restart per 2s per socket
    if (!wsThrottle(socket, 'restart', 2000)) return;
    // Auth (SEC #157)
    if (!wsAuth(socket)) { socket.emit('error', { message: 'Unauthorized' }); return; }
    // Validate side
    if (!['white', 'black', 'both'].includes(side)) {
      socket.emit('error', { message: 'Invalid side — expected white|black|both' });
      return;
    }
    try {
      console.log(`[WS] restart (${side}) from ${socket.id}`);
      await trainer.restart(side);
      io.emit('modelRestart', { side });
    } catch (err) {
      console.error('[WS] restart error:', err.message);
      socket.emit('error', { message: 'Restart failed' });
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
    let aiMoveRelease;
    try {
      // Acquire model lock — prevent dispose during prediction (#160)
      aiMoveRelease = await trainer.acquireModelLock();
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
      const fbRes = await cppFetch('/api/move', {
        method: 'POST',
        body: JSON.stringify(fallbackBody),
      });
      return fbRes;
    } finally {
      if (aiMoveRelease) aiMoveRelease();
    }

    // predict() returns { move: moveObject, ... } — use it directly
    // (prediction.move IS the selected legal move object, not an index)
    let selectedMove = prediction.move;
    // Safety: validate the predicted move is actually in legalMoves
    // Compare array elements (C++ returns from/to as [row,col] arrays)
    if (!selectedMove || !legalMoves.some(m =>
      m.from[0] === selectedMove.from?.[0] && m.from[1] === selectedMove.from?.[1] &&
      m.to[0] === selectedMove.to?.[0] && m.to[1] === selectedMove.to?.[1]
    )) {
      console.warn('[AI] Predicted move not in legal moves, falling back to random');
      selectedMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

      // Execute AI move via C++
    const aiMoveBody = { from: selectedMove.from, to: selectedMove.to };
    if (selectedMove.captures && selectedMove.captures.length > 0) {
      aiMoveBody.captures = selectedMove.captures;
    }
    const aiMoveRes = await cppFetch('/api/move', {
      method: 'POST',
      body: JSON.stringify(aiMoveBody),
    });

    console.log(`[AI] Played move: ${JSON.stringify(selectedMove.from)} → ${JSON.stringify(selectedMove.to)}`);
    // Return move result so handleMove can emit animation path
    return aiMoveRes;
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
        const fbRes = await cppFetch('/api/move', {
          method: 'POST',
          body: JSON.stringify(fbBody),
        });
        return fbRes;
      }
    } catch (_) { /* give up */ }
    return null;
  }
}

// ── Auto-save timers ────────────────────────────────────────────────────────
// Single coherent save schedule: state every 30s, buffer every 2min, model every 5min
// BUG-008: Promise-based locking to prevent resetModel and auto-save from racing
let _saving = false;
let _saveLock = Promise.resolve();
let _lastBufferSave = 0;
let _lastModelSave = 0;

// Helper: acquire exclusive lock. Returns a release() function.
// If another operation is in progress, waits for it to finish first.
function acquireLock() {
  let release;
  const prev = _saveLock;
  _saveLock = new Promise(resolve => { release = resolve; });
  return prev.then(() => release);
}

const _autoSaveInterval = setInterval(async () => {
  if (_saving) return;
  // Acquire lock — waits for any in-progress reset
  let release;
  try {
    release = await acquireLock();
  } catch (_) { return; }
  // Skip save if nothing changed since last save (#102)
  if (!trainer.dirty) { release(); return; }
  try {
    _saving = true;
    // Snapshot dirty flag BEFORE async save — if dirty is set again during save,
    // the reset here won't clobber it and the next cycle will catch it (BUG-003)
    trainer.dirty = false;
    const now = Date.now();

    // State: every 30s (only when dirty)
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
    trainer.dirty = true; // restore dirty so next cycle retries the save
  } finally {
    _saving = false;
    release();
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

  const HOST = process.env.HOST || '127.0.0.1';
  httpServer.listen(PORT, HOST, () => {
    console.log(`[Server] Checkers server running on http://${HOST}:${PORT}`);
  });

  // Auto-start self-play only if it was running before restart
  if (trainer.running) {
    try {
      await trainer.start();
      console.log('[Server] Self-play auto-started (resumed from saved state)');
    } catch (err) {
      console.error('[Server] Self-play auto-start failed:', err.message);
    }
  }
}

main().catch(err => {
  console.error('[Server] Fatal error:', err.message);
  process.exit(1);
});

// Graceful shutdown: clear intervals so process can exit cleanly
function shutdown() {
  clearInterval(_rateLimitCleanupInterval);
  clearInterval(_autoSaveInterval);
  trainer.stop(); // stop self-play loop before closing HTTP server
  // Close WebSocket connections first so in-flight ops can finish
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Global unhandledRejection handler (Node 15+ crashes on unhandled rejections) ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection]', reason instanceof Error ? reason.stack || reason.message : reason);
});
