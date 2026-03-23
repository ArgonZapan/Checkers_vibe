import assert from 'node:assert/strict';
import * as tf from '@tensorflow/tfjs-node';
import { createModel, boardToTensor, predict, train, saveModel, loadModel } from '../ai/model.js';

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(0));
}

function fakeLegalMoves(n = 5) {
  return Array.from({ length: n }, (_, i) => i);
}

import { describe, it } from '@jest/globals';

describe('Model', () => {


  // boardToTensor
  it('boardToTensor — shape [1, 257]', () => {
    const board = emptyBoard();
    const tensor = boardToTensor(board, 1);
    assert.deepEqual(tensor.shape, [1, 257]);
    tensor.dispose();
  });

  it('boardToTensor — empty board encoding', () => {
    const board = emptyBoard();
    const tensor = boardToTensor(board, 0);
    const data = tensor.arraySync()[0];
    // Every 4th element starting at 0 should be 1 (empty channel)
    for (let i = 0; i < 64; i++) {
      assert.equal(data[i * 4], 1, `cell ${i} empty channel should be 1`);
      assert.equal(data[i * 4 + 1], 0);
      assert.equal(data[i * 4 + 2], 0);
      assert.equal(data[i * 4 + 3], 0);
    }
    assert.equal(data[256], 0); // turn = 0
    tensor.dispose();
  });

  it('boardToTensor — white piece encoding', () => {
    const board = emptyBoard();
    board[0][0] = 1; // white pawn
    const tensor = boardToTensor(board, 1);
    const data = tensor.arraySync()[0];
    assert.equal(data[0], 0);  // not empty
    assert.equal(data[1], 1);  // white channel
    assert.equal(data[2], 0);
    assert.equal(data[3], 0);
    assert.equal(data[256], 1); // turn
    tensor.dispose();
  });

  it('boardToTensor — black king encoding', () => {
    const board = emptyBoard();
    board[3][3] = -2; // black king
    const tensor = boardToTensor(board, -1);
    const data = tensor.arraySync()[0];
    const base = (3 * 8 + 3) * 4;
    assert.equal(data[base], 0);
    assert.equal(data[base + 1], 0);
    assert.equal(data[base + 2], 1); // black channel
    assert.equal(data[base + 3], 1); // king channel
    assert.equal(data[256], -1);
    tensor.dispose();
  });

  it('boardToTensor — throws on wrong size', () => {
    assert.throws(() => boardToTensor([[1, 2, 3]], 1), /expected 64 cells/);
  });

  // createModel
  it('createModel("small") — output shapes', () => {
    const model = createModel('small');
    // Input shape
    assert.deepEqual(model.inputs[0].shape, [null, 257]);
    // Policy output: 48 classes
    assert.deepEqual(model.outputs[0].shape, [null, 48]);
    // Value output: 1 scalar
    assert.deepEqual(model.outputs[1].shape, [null, 1]);
    model.dispose();
  });

  it('createModel("small") — layer sizes 128, 64', () => {
    const model = createModel('small');
    const denseLayers = model.layers.filter(l => l.getClassName() === 'Dense');
    // trunk: 128, 64, then policy(48), value(1)
    assert.equal(denseLayers[0].units, 128);
    assert.equal(denseLayers[1].units, 64);
    assert.equal(denseLayers[2].units, 48); // policy
    assert.equal(denseLayers[3].units, 1);  // value
    model.dispose();
  });

  it('createModel("medium") — layer sizes 256, 128, 64', () => {
    const model = createModel('medium');
    const denseLayers = model.layers.filter(l => l.getClassName() === 'Dense');
    assert.equal(denseLayers[0].units, 256);
    assert.equal(denseLayers[1].units, 128);
    assert.equal(denseLayers[2].units, 64);
    model.dispose();
  });

  it('createModel("large") — layer sizes 512, 256, 128, 64', () => {
    const model = createModel('large');
    const denseLayers = model.layers.filter(l => l.getClassName() === 'Dense');
    assert.equal(denseLayers[0].units, 512);
    assert.equal(denseLayers[1].units, 256);
    assert.equal(denseLayers[2].units, 128);
    assert.equal(denseLayers[3].units, 64);
    model.dispose();
  });

  // predict
  it('predict — returns {move, probabilities, value}', async () => {
    const model = createModel('small');
    const board = emptyBoard();
    const legalMoves = fakeLegalMoves(5);
    const result = await predict(model, board, legalMoves, 1);
    assert.ok(typeof result.move === 'number');
    assert.ok(legalMoves.includes(result.move));
    assert.ok(typeof result.value === 'number');
    assert.ok(result.value >= -1 && result.value <= 1);
    assert.ok(typeof result.probabilities === 'object');
    // All legal moves should have probabilities
    for (const m of legalMoves) {
      assert.ok(m in result.probabilities);
    }
    model.dispose();
  });

  it('predict — probabilities sum to ~1', async () => {
    const model = createModel('small');
    const board = emptyBoard();
    const legalMoves = [0, 1, 2, 3];
    const result = await predict(model, board, legalMoves, 1);
    const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.01, `probabilities sum = ${sum}, expected ~1`);
    model.dispose();
  });

  // train
  it('train — returns loss number', async () => {
    const model = createModel('small');
    const batch = [
      { board: emptyBoard(), legalMoves: fakeLegalMoves(), chosenMove: 0, result: 1, turn: 1 },
      { board: emptyBoard(), legalMoves: fakeLegalMoves(), chosenMove: 2, result: -1, turn: 1 },
    ];
    const { loss } = await train(model, batch, 2);
    assert.ok(typeof loss === 'number', `loss should be number, got ${typeof loss}`);
    assert.ok(!isNaN(loss), 'loss should not be NaN');
    model.dispose();
  });

  it('train — empty batch returns {loss: 0}', async () => {
    const model = createModel('small');
    const result = await train(model, [], 1);
    assert.equal(result.loss, 0);
    model.dispose();
  });

  // save / load
  it('saveModel + loadModel — roundtrip weights match', async () => {
    const model = createModel('small');
    const dirPath = '/tmp/test-model';
    await saveModel(model, dirPath);

    const loaded = await loadModel(dirPath);
    // Compare layer counts
    assert.equal(model.layers.length, loaded.layers.length);
    // Compare weights
    const origWeights = model.getWeights();
    const loadWeights = loaded.getWeights();
    assert.equal(origWeights.length, loadWeights.length);
    for (let i = 0; i < origWeights.length; i++) {
      const orig = await origWeights[i].array();
      const loaded_ = await loadWeights[i].array();
      assert.deepEqual(orig, loaded_, `weight ${i} mismatch`);
    }
    model.dispose();
    loaded.dispose();
  });

  // Run

}
