// Polyfill util.isNullOrUndefined removed in Node.js 24+
import { createRequire } from 'node:module';
const _util = createRequire(import.meta.url)('util');
if (!_util.isNullOrUndefined) {
  _util.isNullOrUndefined = (val) => val === null || val === undefined;
}
import * as tf from '@tensorflow/tfjs-node';
import path from 'node:path';

// ── Network size configs ─────────────────────────────────────────────────────
const NETWORK_CONFIGS = {
  small:  { layers: [128, 64] },
  medium: { layers: [256, 128, 64] },
  large:  { layers: [512, 256, 128, 64] }
};

// ── Create model ─────────────────────────────────────────────────────────────
// Accepts either a size string ('small'|'medium'|'large') or an options object:
//   { layers, neurons, activation, dropout, lr }
export function createModel(sizeOrOpts = 'small') {
  let layerSizes, activation, dropout, lr, modelName;

  if (typeof sizeOrOpts === 'object') {
    let { layers: numLayers = 3, neurons = 128, activation: act = 'relu', dropout: drop = 0, lr: learningRate = 0.001 } = sizeOrOpts;

    // ── Validation ───────────────────────────────────────────────────────
    if (numLayers < 1 || numLayers > 5) {
      console.warn(`[Model] Invalid layers=${numLayers}, clamping to 1-5`);
      numLayers = Math.max(1, Math.min(5, numLayers));
    }
    if (neurons < 32 || neurons > 512) {
      console.warn(`[Model] Invalid neurons=${neurons}, clamping to 32-512`);
      neurons = Math.max(32, Math.min(512, neurons));
    }
    if (learningRate < 0.0001 || learningRate > 0.1) {
      console.warn(`[Model] Invalid lr=${learningRate}, clamping to 0.0001-0.1`);
      learningRate = Math.max(0.0001, Math.min(0.1, learningRate));
    }
    if (drop < 0 || drop > 0.5) {
      console.warn(`[Model] Invalid dropout=${drop}, clamping to 0-0.5`);
      drop = Math.max(0, Math.min(0.5, drop));
    }
    const validActivations = ['relu', 'tanh', 'sigmoid', 'leaky_relu'];
    if (!validActivations.includes(act)) {
      console.warn(`[Model] Invalid activation='${act}', using 'relu'`);
      act = 'relu';
    }
    // ── End validation ───────────────────────────────────────────────────

    // Build uniform layer sizes: each hidden layer has `neurons` units
    layerSizes = Array.from({ length: numLayers }, () => neurons);
    activation = act;
    dropout = drop;
    lr = learningRate;
    modelName = `checkers-custom-${numLayers}x${neurons}`;
  } else {
    const config = NETWORK_CONFIGS[sizeOrOpts] || NETWORK_CONFIGS.small;
    layerSizes = config.layers;
    activation = 'relu';
    dropout = 0;
    lr = 0.001;
    modelName = `checkers-${sizeOrOpts}`;
  }

  const input = tf.input({ shape: [257] });

  // Shared trunk
  let x = input;
  for (const units of layerSizes) {
    if (activation === 'leaky_relu') {
      x = tf.layers.dense({ units, activation: 'linear' }).apply(x);
      x = tf.layers.leakyReLU({ alpha: 0.1 }).apply(x);
    } else {
      x = tf.layers.dense({ units, activation }).apply(x);
    }
    if (dropout > 0) {
      x = tf.layers.dropout({ rate: dropout }).apply(x);
    }
  }

  // Policy head — 48 possible moves (max)
  const policyHead = tf.layers.dense({ units: 48, activation: 'softmax', name: 'policy' }).apply(x);

  // Value head
  const valueHead = tf.layers.dense({ units: 1, activation: 'tanh', name: 'value' }).apply(x);

  const model = tf.model({
    inputs: input,
    outputs: [policyHead, valueHead],
    name: modelName
  });

  model.compile({
    optimizer: tf.train.adam(lr),
    loss: ['categoricalCrossentropy', 'meanSquaredError']
  });

  return model;
}

// ── Board to tensor ─────────────────────────────────────────────────────────
export function boardToTensor(boardArray, turn) {
  // boardArray: 8x8 int array (flat 64 or 2D 8x8)
  // C++ engine encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
  if (!Array.isArray(boardArray)) {
    throw new Error(`boardToTensor: expected array, got ${typeof boardArray}`);
  }
  // Handle 1D array (64 elements) — wrap into 2D
  if (boardArray.length === 64 && !Array.isArray(boardArray[0])) {
    const wrapped = [];
    for (let r = 0; r < 8; r++) {
      wrapped.push(boardArray.slice(r * 8, r * 8 + 8));
    }
    boardArray = wrapped;
  }
  // Flatten to 1D — no board flipping
  const flat = boardArray.flat();

  if (flat.length !== 64) {
    throw new Error(`boardToTensor: expected 64 cells, got ${flat.length}`);
  }

  const input = new Float32Array(257);
  for (let i = 0; i < 64; i++) {
    const val = flat[i];
    const base = i * 4;
    if (val === 0) {
      input[base] = 1;           // empty
    } else {
      const absVal = Math.abs(val);
      // white pieces: 1 (pawn), 2 (king) — positive
      // black pieces: 3 (pawn), 4 (king) — or negative equivalents
      const isWhite = val > 0 && (absVal === 1 || absVal === 2);
      const isKing = absVal === 2 || absVal === 4;
      if (isWhite) {
        input[base + 1] = 1;     // white channel
      } else {
        input[base + 2] = 1;     // black/opponent channel
      }
      if (isKing) {
        input[base + 3] = 1;     // king flag
      }
    }
  }
  input[256] = turn; // store the turn value

  return tf.tensor2d([Array.from(input)]);
}

// ── Build input array without creating a tensor ─────────────────────────────
export function buildInputArray(boardArray, turn) {
  // Same encoding as boardToTensor() but returns Float32Array(257) — no tensor created
  if (!Array.isArray(boardArray)) {
    throw new Error(`buildInputArray: expected array, got ${typeof boardArray}`);
  }
  let board = boardArray;
  if (board.length === 64 && !Array.isArray(board[0])) {
    const wrapped = [];
    for (let r = 0; r < 8; r++) {
      wrapped.push(board.slice(r * 8, r * 8 + 8));
    }
    board = wrapped;
  }
  const flat = board.flat();
  if (flat.length !== 64) {
    throw new Error(`buildInputArray: expected 64 cells, got ${flat.length}`);
  }

  const input = new Float32Array(257);
  for (let i = 0; i < 64; i++) {
    const val = flat[i];
    const base = i * 4;
    if (val === 0) {
      input[base] = 1;
    } else {
      const absVal = Math.abs(val);
      const isWhite = val > 0 && (absVal === 1 || absVal === 2);
      const isKing = absVal === 2 || absVal === 4;
      if (isWhite) {
        input[base + 1] = 1;
      } else {
        input[base + 2] = 1;
      }
      if (isKing) {
        input[base + 3] = 1;
      }
    }
  }
  input[256] = turn;
  return input;
}

// ── Canonical Policy Index ──────────────────────────────────────────────────
// Compute canonical policy index (0-47) from move geometry.
// Convert [row,col] array or scalar 0-63 to scalar board index
function toScalar(idx) {
  if (Array.isArray(idx)) return idx[0] * 8 + idx[1];
  return idx;
}

// 32 dark squares × 4 directions (NE, NW, SE, SW) = 128 max, but
// only forward directions are valid for pawns → 48 effective slots.
// fromSquare: 0-63 board index or [row,col] array; toSquare: same
const DIRECTION_MAP = { '-1,1': 0, '-1,-1': 1, '1,1': 2, '1,-1': 3 };

export function computePolicyIndex(fromSquare, toSquare) {
  const from = toScalar(fromSquare);
  const to = toScalar(toSquare);
  const fromRow = Math.floor(from / 8);
  const fromCol = from % 8;
  // Dark square index: 0-31 (only dark squares are playable in checkers)
  const darkFrom = Math.floor((fromRow * 8 + fromCol) / 2);
  const toRow = Math.floor(to / 8);
  const toCol = to % 8;
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  const dirKey = `${Math.sign(dr)},${Math.sign(dc)}`;
  const dirIdx = DIRECTION_MAP[dirKey];
  if (dirIdx === undefined) return 0; // fallback for invalid direction
  return darkFrom * 4 + dirIdx;
}

// ── Predict ─────────────────────────────────────────────────────────────────
export async function predict(model, boardArray, legalMoves, turn = 1) {
  const tensor = boardToTensor(boardArray, turn);
  let policyTensor, valueTensor;
  try {
    [policyTensor, valueTensor] = model.predictOnBatch(tensor);

    const policy = await policyTensor.data();
    const value = (await valueTensor.data())[0];

    // Mask illegal moves — use canonical policyIndex, not array index
    const legalIndices = legalMoves.map(m => {
      if (typeof m === 'number') return m;
      return m.policyIndex ?? m.index ?? m;
    });

    if (legalIndices.length === 0) {
      return { move: 0, probabilities: {}, value: 0 };
    }

    let maskedPolicy = Array.from(policy);

    // Compute softmax probabilities for legal moves (temperature=1.0)
    const expProbs = {};
    let maxLogit = -Infinity;
    for (const idx of legalIndices) {
      const val = maskedPolicy[idx] || 0;
      if (val > maxLogit) maxLogit = val;
    }
    let totalExp = 0;
    for (const idx of legalIndices) {
      expProbs[idx] = Math.exp((maskedPolicy[idx] || 0) - maxLogit);
      totalExp += expProbs[idx];
    }
    const normalizedProbs = {};
    for (const idx of legalIndices) {
      normalizedProbs[idx] = expProbs[idx] / totalExp;
    }

    // Sample from distribution instead of argmax (prevents determinism with fresh models)
    let r = Math.random();
    let bestIdx = legalIndices[0];
    let cumulative = 0;
    for (const idx of legalIndices) {
      cumulative += normalizedProbs[idx];
      if (r <= cumulative) { bestIdx = idx; break; }
    }

    // Return the full move object from legalMoves, not just the policy index.
    // bestIdx is a canonical policy vector index (0-47), not an array index.
    const selectedMove = legalMoves.find(m => {
      const idx = typeof m === 'number' ? m : (m.policyIndex ?? m.index ?? m);
      return idx === bestIdx;
    }) || legalMoves[0];

    return {
      move: selectedMove,
      probabilities: normalizedProbs,
      value
    };
  } finally {
    tensor.dispose();
    if (policyTensor) policyTensor.dispose();
    if (valueTensor) valueTensor.dispose();
  }
}

// ── Train ───────────────────────────────────────────────────────────────────
import { CONFIG } from '../../config.js';
const GAMMA = CONFIG.ai.gamma; // discount factor for Bellman equation

export async function train(model, batch, epochs = 5) {
  if (batch.length === 0) return { loss: 0 };

  // Pre-compute next-state Q-values for Bellman targets (batch prediction)
  const hasShapedRewards = batch.some(s => s.nextState != null && s.reward !== undefined);

  let nextQValues = null;
  if (hasShapedRewards) {
    // Collect samples that have nextState for Bellman update
    const withNext = [];
    const withNextIdx = [];
    for (let i = 0; i < batch.length; i++) {
      if (batch[i].nextState != null) {
        withNext.push(batch[i]);
        withNextIdx.push(i);
      }
    }

    if (withNext.length > 0) {
      // Batch predict Q(nextState) for all samples with nextState
      const nextBoards = [];
      for (const s of withNext) {
        const nextFlat = Array.isArray(s.nextState) ? s.nextState.flat() : s.nextState;
        nextBoards.push(Array.from(buildInputArray(nextFlat, -s.turn)));
      }

      const nextTensor = tf.tensor2d(nextBoards);
      const [, nextValues] = model.predictOnBatch(nextTensor);
      const nextVals = await nextValues.data();
      nextTensor.dispose();
      nextValues.dispose();

      nextQValues = new Float32Array(batch.length).fill(0);
      for (let j = 0; j < withNext.length; j++) {
        nextQValues[withNextIdx[j]] = nextVals[j];
      }
    }
  }

  const boards = [];
  const policyTargets = [];
  const valueTargets = [];

  for (let i = 0; i < batch.length; i++) {
    const sample = batch[i];
    const { board, legalMoves, chosenMove, result, turn = 1 } = sample;
    boards.push(Array.from(buildInputArray(board, turn)));

    // Policy target: one-hot on chosen move (use canonical policyIndex)
    const policyTarget = new Float32Array(48).fill(0);
    const moveIdx = typeof chosenMove === 'number' ? chosenMove
      : (chosenMove.policyIndex ?? chosenMove.index ?? chosenMove);
    if (moveIdx >= 0 && moveIdx < 48) {
      policyTarget[moveIdx] = 1;
    }
    policyTargets.push(Array.from(policyTarget));

    // Value target: Bellman equation with negated opponent Q (zero-sum game)
    let valueTarget;
    if (hasShapedRewards && sample.reward !== undefined && nextQValues != null) {
      const done = sample.done ? 1 : 0;
      // nextQValues[i] is from opponent's perspective — negate for zero-sum
      valueTarget = sample.reward + GAMMA * (-nextQValues[i]) * (1 - done);
      // Clamp to [-1, 1] (matches tanh output range)
      valueTarget = Math.max(-1, Math.min(1, valueTarget));
    } else {
      valueTarget = result;
    }
    valueTargets.push([valueTarget]);
  }

  const xTensor = tf.tensor2d(boards);
  const yPolicyTensor = tf.tensor2d(policyTargets);
  const yValueTensor = tf.tensor2d(valueTargets);

  const history = await model.fit(xTensor, [yPolicyTensor, yValueTensor], {
    epochs,
    batchSize: Math.min(batch.length, 256),
    verbose: 0
  });

  const loss = history.history.loss[history.history.loss.length - 1];

  xTensor.dispose();
  yPolicyTensor.dispose();
  yValueTensor.dispose();

  return { loss: Array.isArray(loss) ? loss[0] : loss };
}

// ── Save / Load ─────────────────────────────────────────────────────────────
import { rename, mkdir, rm } from 'node:fs/promises';

export async function saveModel(model, dirPath) {
  const tmpDir = dirPath + '.tmp';
  // Clean up any leftover tmp dir from a previous interrupted save
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });
  await model.save(`file://${tmpDir}`);
  // Atomic swap: rename tmp → target (overwrites on Linux)
  // rm first because renameSync/rename cannot overwrite non-empty directories on Linux
  await rm(dirPath, { recursive: true, force: true });
  await rename(tmpDir, dirPath);
  console.log(`[Model] Saved to ${dirPath}`);
}

export async function loadModel(dirPath) {
  const model = await tf.loadLayersModel(`file://${dirPath}/model.json`);
  model.compile({
    optimizer: tf.train.adam(CONFIG.ai.modelParams.lr),
    loss: ['categoricalCrossentropy', 'meanSquaredError']
  });
  console.log(`[Model] Loaded from ${dirPath}`);
  return model;
}
