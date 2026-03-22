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
    const { layers: numLayers = 3, neurons = 128, activation: act = 'relu', dropout: drop = 0, lr: learningRate = 0.001 } = sizeOrOpts;
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
  // Validate 2D 8x8
  const flat = boardArray.flat();
  if (flat.length !== 64) {
    throw new Error(`boardToTensor: expected 64 cells, got ${flat.length}`);
  }
  if (boardArray.length !== 8) {
    throw new Error(`boardToTensor: expected 8 rows, got ${boardArray.length}`);
  }

  const input = new Float32Array(257);
  for (let i = 0; i < 64; i++) {
    const val = flat[i];
    // 4 channels: empty, white piece, black piece, king
    // Piece encoding: 0=empty, 1=white pawn, 2=white king, 3=black pawn, 4=black king
    // Also supports sign encoding: positive=white, negative=black, |val|=2 for king
    const base = i * 4;
    if (val === 0) {
      input[base] = 1;           // empty
    } else {
      const isBlack = val === 3 || val === 4 || val < 0;
      const isKing = val === 2 || val === 4 || Math.abs(val) === 2;
      if (isBlack) {
        input[base + 2] = 1;     // black channel
      } else {
        input[base + 1] = 1;     // white channel
      }
      if (isKing) {
        input[base + 3] = 1;     // king flag
      }
    }
  }
  input[256] = turn; // turn indicator

  return tf.tensor2d([Array.from(input)]);
}

// ── Predict ─────────────────────────────────────────────────────────────────
export async function predict(model, boardArray, legalMoves, turn = 1) {
  const tensor = boardToTensor(boardArray, turn);
  let policyTensor, valueTensor;
  try {
    [policyTensor, valueTensor] = model.predict(tensor);

    const policy = await policyTensor.data();
    const value = (await valueTensor.data())[0];

    // Mask illegal moves
    const legalIndices = legalMoves.map(m => {
      if (typeof m === 'number') return m;
      // Convert from move object to index if needed
      return m.index ?? m;
    });

    if (legalIndices.length === 0) {
      return { move: 0, probabilities: {}, value: 0 };
    }

    let maskedPolicy = Array.from(policy);
    const totalProb = legalIndices.reduce((sum, idx) => sum + (maskedPolicy[idx] || 0), 0) || 1;

    // Pick move (argmax among legal)
    let bestIdx = legalIndices[0];
    let bestProb = -1;
    for (const idx of legalIndices) {
      if (maskedPolicy[idx] > bestProb) {
        bestProb = maskedPolicy[idx];
        bestIdx = idx;
      }
    }

    // Normalize probabilities for legal moves only
    const normalizedProbs = {};
    for (const idx of legalIndices) {
      normalizedProbs[idx] = (maskedPolicy[idx] || 0) / totalProb;
    }

    return {
      move: bestIdx,
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
export async function train(model, batch, epochs = 5) {
  if (batch.length === 0) return { loss: 0 };

  const boards = [];
  const policyTargets = [];
  const valueTargets = [];

  for (const sample of batch) {
    const { board, legalMoves, chosenMove, result, turn = 1 } = sample;
    const tensor = boardToTensor(board, turn);
    const data = await tensor.data();
    boards.push(Array.from(data));

    // Policy target: one-hot on chosen move
    const policyTarget = new Float32Array(48).fill(0);
    const moveIdx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index ?? chosenMove;
    if (moveIdx >= 0 && moveIdx < 48) {
      policyTarget[moveIdx] = 1;
    }
    policyTargets.push(Array.from(policyTarget));

    // Value target: game result from perspective of current player
    valueTargets.push([result]);

    tensor.dispose();
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
export async function saveModel(model, dirPath) {
  await model.save(`file://${dirPath}`);
  console.log(`[Model] Saved to ${dirPath}`);
}

export async function loadModel(dirPath) {
  const model = await tf.loadLayersModel(`file://${dirPath}/model.json`);
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: ['categoricalCrossentropy', 'meanSquaredError']
  });
  console.log(`[Model] Loaded from ${dirPath}`);
  return model;
}
