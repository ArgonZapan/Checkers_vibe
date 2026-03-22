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
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── Auto-save timers ────────────────────────────────────────────────────────
const MODEL_SAVE_INTERVAL = 5 * 60 * 1000;  // 5 min
const BUFFER_SAVE_INTERVAL = 10 * 60 * 1000; // 10 min

setInterval(async () => {
  try {
    if (trainer.modelWhite) await saveModel(trainer.modelWhite, path.join(MODEL_DIR, 'white'));
    if (trainer.modelBlack) await saveModel(trainer.modelBlack, path.join(MODEL_DIR, 'black'));
  } catch (err) {
    console.error('[AutoSave] Model save error:', err.message);
  }
}, MODEL_SAVE_INTERVAL);

setInterval(async () => {
  try {
    await trainer.buffer.save(BUFFER_FILE);
  } catch (err) {
    console.error('[AutoSave] Buffer save error:', err.message);
  }
}, BUFFER_SAVE_INTERVAL);

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

  httpServer.listen(PORT, () => {
    console.log(`[Server] Checkers server running on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
