/**
 * configAiBoard.test.js — Tests for CONFIG.ai and CONFIG.board properties.
 *
 * Covers: AI hyperparameters, model params, board colors, animation config,
 * cellSize — all static values from config.js that were never directly verified.
 *
 * Uses direct import of CONFIG from config.js.
 */

import assert from 'node:assert/strict';
import { CONFIG } from '../config.js';

export async function runConfigAiBoardTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG.board
  // ═══════════════════════════════════════════════════════════════════════

  test('board.cellSize is 60', () => {
    assert.equal(CONFIG.board.cellSize, 60);
  });

  test('board.colors.light is a valid CSS color', () => {
    assert.ok(CONFIG.board.colors.light);
    assert.ok(typeof CONFIG.board.colors.light === 'string');
    assert.ok(CONFIG.board.colors.light.startsWith('#') || CONFIG.board.colors.light.startsWith('rgb'));
  });

  test('board.colors.dark is a valid CSS color', () => {
    assert.ok(CONFIG.board.colors.dark);
    assert.ok(typeof CONFIG.board.colors.dark === 'string');
  });

  test('board.colors.highlight contains rgba with alpha', () => {
    assert.ok(CONFIG.board.colors.highlight.includes('rgba'));
  });

  test('board.colors.selected contains rgba with alpha', () => {
    assert.ok(CONFIG.board.colors.selected.includes('rgba'));
  });

  test('board.colors.validMove contains rgba with alpha', () => {
    assert.ok(CONFIG.board.colors.validMove.includes('rgba'));
  });

  test('board.colors.validDot contains rgba with alpha', () => {
    assert.ok(CONFIG.board.colors.validDot.includes('rgba'));
  });

  test('board.colors.white piece color exists', () => {
    assert.ok(CONFIG.board.colors.white);
    assert.ok(CONFIG.board.colors.white.startsWith('#'));
  });

  test('board.colors.whiteStroke exists', () => {
    assert.ok(CONFIG.board.colors.whiteStroke);
  });

  test('board.colors.black piece color exists', () => {
    assert.ok(CONFIG.board.colors.black);
    assert.ok(CONFIG.board.colors.black.startsWith('#'));
  });

  test('board.colors.blackStroke exists', () => {
    assert.ok(CONFIG.board.colors.blackStroke);
  });

  test('board.colors.kingWhite exists (overlay for white king)', () => {
    assert.ok(CONFIG.board.colors.kingWhite);
  });

  test('board.colors.kingBlack exists (overlay for black king)', () => {
    assert.ok(CONFIG.board.colors.kingBlack);
  });

  test('board.colors has all expected keys', () => {
    const expected = ['light', 'dark', 'highlight', 'selected', 'validMove', 'validDot', 'white', 'whiteStroke', 'black', 'blackStroke', 'kingWhite', 'kingBlack'];
    for (const key of expected) {
      assert.ok(key in CONFIG.board.colors, `Missing color key: ${key}`);
    }
  });

  test('board.animation.stepDurationMs is 50', () => {
    assert.equal(CONFIG.board.animation.stepDurationMs, 50);
  });

  test('board.animation.easeOut is true', () => {
    assert.equal(CONFIG.board.animation.easeOut, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG.server (static values)
  // ═══════════════════════════════════════════════════════════════════════

  test('server.port is 3000', () => {
    assert.equal(CONFIG.server.port, 3000);
  });

  test('server.cppBase is localhost:8080', () => {
    assert.equal(CONFIG.server.cppBase, 'http://localhost:8080');
  });

  test('server.fetchTimeoutMs is 5000', () => {
    assert.equal(CONFIG.server.fetchTimeoutMs, 5000);
  });

  test('server.aiMoveDelayMs is 0 (minimal)', () => {
    assert.equal(CONFIG.server.aiMoveDelayMs, 0);
  });

  test('server.autoSaveMs is 30000', () => {
    assert.equal(CONFIG.server.autoSaveMs, 30000);
  });

  test('server.speedMode is "normal"', () => {
    assert.equal(CONFIG.server.speedMode, 'normal');
  });

  test('server.normalModeDelayMs is 500', () => {
    assert.equal(CONFIG.server.normalModeDelayMs, 500);
  });

  test('server.corsOrigin is set', () => {
    assert.ok(CONFIG.server.corsOrigin);
    assert.equal(typeof CONFIG.server.corsOrigin, 'string');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG.ai
  // ═══════════════════════════════════════════════════════════════════════

  test('ai.defaultEpsilon is 0.3', () => {
    assert.equal(CONFIG.ai.defaultEpsilon, 0.3);
  });

  test('ai.minEpsilon is 0.01', () => {
    assert.equal(CONFIG.ai.minEpsilon, 0.01);
  });

  test('ai.epsilonDecay is 0.01', () => {
    assert.equal(CONFIG.ai.epsilonDecay, 0.01);
  });

  test('ai.gamma is 0.95', () => {
    assert.equal(CONFIG.ai.gamma, 0.95);
  });

  test('ai.bufferSize is 10000', () => {
    assert.equal(CONFIG.ai.bufferSize, 10000);
  });

  test('ai.trainEpochs is 5', () => {
    assert.equal(CONFIG.ai.trainEpochs, 5);
  });

  test('ai.gamma is between 0 and 1', () => {
    assert.ok(CONFIG.ai.gamma > 0 && CONFIG.ai.gamma < 1);
  });

  test('ai.defaultEpsilon is between minEpsilon and 1', () => {
    assert.ok(CONFIG.ai.defaultEpsilon >= CONFIG.ai.minEpsilon);
    assert.ok(CONFIG.ai.defaultEpsilon <= 1);
  });

  test('ai.minEpsilon is greater than 0', () => {
    assert.ok(CONFIG.ai.minEpsilon > 0);
  });

  test('ai.bufferSize is positive', () => {
    assert.ok(CONFIG.ai.bufferSize > 0);
  });

  test('ai.trainEpochs is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.trainEpochs));
    assert.ok(CONFIG.ai.trainEpochs > 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG.ai.modelParams
  // ═══════════════════════════════════════════════════════════════════════

  test('ai.modelParams.layers is 3', () => {
    assert.equal(CONFIG.ai.modelParams.layers, 3);
  });

  test('ai.modelParams.neurons is 128', () => {
    assert.equal(CONFIG.ai.modelParams.neurons, 128);
  });

  test('ai.modelParams.activation is "relu"', () => {
    assert.equal(CONFIG.ai.modelParams.activation, 'relu');
  });

  test('ai.modelParams.lr is 0.001', () => {
    assert.equal(CONFIG.ai.modelParams.lr, 0.001);
  });

  test('ai.modelParams.batchSize is 64', () => {
    assert.equal(CONFIG.ai.modelParams.batchSize, 64);
  });

  test('ai.modelParams.dropout is 0', () => {
    assert.equal(CONFIG.ai.modelParams.dropout, 0);
  });

  test('ai.modelParams has all expected keys', () => {
    const expected = ['layers', 'neurons', 'activation', 'lr', 'batchSize', 'dropout'];
    for (const key of expected) {
      assert.ok(key in CONFIG.ai.modelParams, `Missing modelParams key: ${key}`);
    }
  });

  test('ai.modelParams.lr is positive', () => {
    assert.ok(CONFIG.ai.modelParams.lr > 0);
  });

  test('ai.modelParams.layers is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.modelParams.layers));
    assert.ok(CONFIG.ai.modelParams.layers > 0);
  });

  test('ai.modelParams.neurons is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.modelParams.neurons));
    assert.ok(CONFIG.ai.modelParams.neurons > 0);
  });

  test('ai.modelParams.batchSize is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.modelParams.batchSize));
    assert.ok(CONFIG.ai.modelParams.batchSize > 0);
  });

  test('ai.modelParams.dropout is in valid range [0, 1]', () => {
    assert.ok(CONFIG.ai.modelParams.dropout >= 0);
    assert.ok(CONFIG.ai.modelParams.dropout < 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG integrity — no undefined/NaN in critical fields
  // ═══════════════════════════════════════════════════════════════════════

  test('CONFIG has no undefined values in ai section', () => {
    for (const [key, val] of Object.entries(CONFIG.ai)) {
      if (key === 'modelParams') continue;
      assert.notEqual(val, undefined, `CONFIG.ai.${key} is undefined`);
      assert.ok(!Number.isNaN(val), `CONFIG.ai.${key} is NaN`);
    }
  });

  test('CONFIG has no undefined values in modelParams', () => {
    for (const [key, val] of Object.entries(CONFIG.ai.modelParams)) {
      assert.notEqual(val, undefined, `CONFIG.ai.modelParams.${key} is undefined`);
      assert.ok(!Number.isNaN(val), `CONFIG.ai.modelParams.${key} is NaN`);
    }
  });

  test('CONFIG has no undefined values in server', () => {
    for (const [key, val] of Object.entries(CONFIG.server)) {
      assert.notEqual(val, undefined, `CONFIG.server.${key} is undefined`);
      if (typeof val === 'number') {
        assert.ok(!Number.isNaN(val), `CONFIG.server.${key} is NaN`);
      }
    }
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Config AI & Board Tests');

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`   ─── ${passed} passed, ${failed} failed ───`);
  return { passed, failed };
}
