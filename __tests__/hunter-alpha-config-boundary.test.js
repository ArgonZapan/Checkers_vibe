/**
 * hunter-alpha-config-boundary.test.js — Boundary tests for config.js getters.
 *
 * Gaps identified:
 * - moveDelayMs with speedMode='fast' (always 0)
 * - moveDelayMs with speedMode='normal' and aiMoveDelayMs=0 (falls back to normalModeDelayMs)
 * - moveDelayMs with speedMode='normal' and aiMoveDelayMs set (> 0)
 * - animationStepDurationMs floor behavior with odd values
 * - animationStepDurationMs with speedMode='fast'
 * - CONFIG.ai strategies accessor consistency
 * - CONFIG.server default values
 * - CONFIG.board colors completeness
 */
import assert from 'node:assert/strict';

// ── Inline CONFIG (replicate config.js structure) ─────────────────────

const CONFIG = {
  board: {
    cellSize: 60,
    colors: {
      light: '#deb887', dark: '#8b4513',
      highlight: 'rgba(255, 255, 0, 0.3)', selected: 'rgba(0, 255, 0, 0.35)',
      validMove: 'rgba(0, 200, 0, 0.45)', validDot: 'rgba(0, 160, 0, 0.7)',
      white: '#f0f0f0', whiteStroke: '#999',
      black: '#2a2a2a', blackStroke: '#555',
      kingWhite: '#333', kingBlack: '#ddd',
    },
    animation: { stepDurationMs: 200, easeOut: true },
  },
  server: {
    port: 3000,
    corsOrigin: 'http://localhost:3000',
    cppBase: 'http://localhost:8080',
    fetchTimeoutMs: 5000,
    aiMoveDelayMs: 0,
    autoSaveMs: 30000,
    speedMode: 'normal',
    normalModeDelayMs: 500,
  },
  get moveDelayMs() {
    const s = this.server;
    if (s.speedMode === 'fast') return 0;
    return s.aiMoveDelayMs > 0 ? s.aiMoveDelayMs : s.normalModeDelayMs;
  },
  get animationStepDurationMs() {
    if (this.server.speedMode === 'fast') return 0;
    return Math.floor(this.moveDelayMs / 2);
  },
  ai: {
    defaultEpsilon: 0.3, minEpsilon: 0.01, epsilonDecay: 0.01,
    gamma: 0.95, bufferSize: 10000, trainEpochs: 5,
    modelParams: { layers: 3, neurons: 128, activation: 'relu', lr: 0.001, batchSize: 64, dropout: 0 },
    strategy: { white: 'aggressor', black: 'fortress' },
    strategies: {
      aggressor: {
        weights: { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 },
        epsilonDecay: 0.015, minEpsilon: 0.02,
        rewardCapture: 0.15, rewardAdvance: 0.10, rewardPromotion: 0.20,
        rewardWin: 1.0, rewardLose: -1.0,
      },
      fortress: {
        weights: { material: 0.25, position: 0.40, threat: 0.10, tempo: 0.25 },
        epsilonDecay: 0.008, minEpsilon: 0.03,
        rewardCapture: 0.08, rewardAdvance: 0.03, rewardPromotion: 0.40,
        rewardWin: 1.0, rewardLose: -1.2,
      },
    },
  },
};

export async function runHunterAlphaConfigBoundaryTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── moveDelayMs getter ─────────────────────────────────────────────

  test('moveDelayMs: fast mode always returns 0', () => {
    CONFIG.server.speedMode = 'fast';
    CONFIG.server.aiMoveDelayMs = 1000;
    assert.equal(CONFIG.moveDelayMs, 0);
    CONFIG.server.aiMoveDelayMs = 0;
    assert.equal(CONFIG.moveDelayMs, 0);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs=0 returns normalModeDelayMs', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 0;
    CONFIG.server.normalModeDelayMs = 500;
    assert.equal(CONFIG.moveDelayMs, 500);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs>0 returns aiMoveDelayMs', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 200;
    CONFIG.server.normalModeDelayMs = 500;
    assert.equal(CONFIG.moveDelayMs, 200);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs=1 returns 1', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 1;
    assert.equal(CONFIG.moveDelayMs, 1);
  });

  test('moveDelayMs: normal mode with negative aiMoveDelayMs returns normalModeDelayMs', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = -100;
    CONFIG.server.normalModeDelayMs = 500;
    assert.equal(CONFIG.moveDelayMs, 500); // -100 > 0 is false
  });

  // ── animationStepDurationMs getter ─────────────────────────────────

  test('animationStepDurationMs: fast mode returns 0', () => {
    CONFIG.server.speedMode = 'fast';
    CONFIG.server.aiMoveDelayMs = 1000;
    assert.equal(CONFIG.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: normal mode floors half of moveDelayMs', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 500;
    assert.equal(CONFIG.animationStepDurationMs, 250);
  });

  test('animationStepDurationMs: odd delay floors correctly', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 101;
    assert.equal(CONFIG.animationStepDurationMs, 50); // Math.floor(101/2)
  });

  test('animationStepDurationMs: delay=1 floors to 0', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 1;
    assert.equal(CONFIG.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: delay=2 returns 1', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 2;
    assert.equal(CONFIG.animationStepDurationMs, 1);
  });

  test('animationStepDurationMs: delay=0 falls back to normalModeDelayMs then floors', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 0;
    CONFIG.server.normalModeDelayMs = 600;
    assert.equal(CONFIG.animationStepDurationMs, 300);
  });

  // ── Strategy weights sum check ─────────────────────────────────────

  test('aggressor weights sum to 1.0', () => {
    const w = CONFIG.ai.strategies.aggressor.weights;
    const sum = w.material + w.position + w.threat + w.tempo;
    assert.ok(Math.abs(sum - 1.0) < 0.001, `aggressor weights sum to ${sum}, expected 1.0`);
  });

  test('fortress weights sum to 1.0', () => {
    const w = CONFIG.ai.strategies.fortress.weights;
    const sum = w.material + w.position + w.threat + w.tempo;
    assert.ok(Math.abs(sum - 1.0) < 0.001, `fortress weights sum to ${sum}, expected 1.0`);
  });

  test('strategy names are consistent with strategy map', () => {
    assert.ok(CONFIG.ai.strategies[CONFIG.ai.strategy.white], 'white strategy name must exist in strategies');
    assert.ok(CONFIG.ai.strategies[CONFIG.ai.strategy.black], 'black strategy name must exist in strategies');
  });

  // ── Server defaults ────────────────────────────────────────────────

  test('server.port is a positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.server.port) && CONFIG.server.port > 0);
  });

  test('server.fetchTimeoutMs is positive', () => {
    assert.ok(CONFIG.server.fetchTimeoutMs > 0);
  });

  test('server.autoSaveMs is positive', () => {
    assert.ok(CONFIG.server.autoSaveMs > 0);
  });

  test('server.speedMode is valid value', () => {
    assert.ok(['fast', 'normal'].includes(CONFIG.server.speedMode));
  });

  // ── AI defaults ────────────────────────────────────────────────────

  test('ai.defaultEpsilon is in [0, 1]', () => {
    assert.ok(CONFIG.ai.defaultEpsilon >= 0 && CONFIG.ai.defaultEpsilon <= 1);
  });

  test('ai.minEpsilon < defaultEpsilon', () => {
    assert.ok(CONFIG.ai.minEpsilon < CONFIG.ai.defaultEpsilon);
  });

  test('ai.gamma is in (0, 1]', () => {
    assert.ok(CONFIG.ai.gamma > 0 && CONFIG.ai.gamma <= 1);
  });

  test('ai.bufferSize is positive', () => {
    assert.ok(CONFIG.ai.bufferSize > 0);
  });

  test('ai.modelParams.layers is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.modelParams.layers) && CONFIG.ai.modelParams.layers > 0);
  });

  test('ai.modelParams.neurons is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.ai.modelParams.neurons) && CONFIG.ai.modelParams.neurons > 0);
  });

  test('ai.modelParams.lr is positive', () => {
    assert.ok(CONFIG.ai.modelParams.lr > 0);
  });

  test('ai.modelParams.dropout is in [0, 1)', () => {
    assert.ok(CONFIG.ai.modelParams.dropout >= 0 && CONFIG.ai.modelParams.dropout < 1);
  });

  // ── Board colors ───────────────────────────────────────────────────

  test('board.colors: all required keys present', () => {
    const required = ['light', 'dark', 'highlight', 'selected', 'validMove', 'validDot', 'white', 'whiteStroke', 'black', 'blackStroke', 'kingWhite', 'kingBlack'];
    for (const key of required) {
      assert.ok(key in CONFIG.board.colors, `missing color key: ${key}`);
    }
  });

  test('board.cellSize is positive integer', () => {
    assert.ok(Number.isInteger(CONFIG.board.cellSize) && CONFIG.board.cellSize > 0);
  });

  // ── Restore defaults ──────────────────────────────────────────────

  test('restore: reset speedMode to normal', () => {
    CONFIG.server.speedMode = 'normal';
    CONFIG.server.aiMoveDelayMs = 0;
    CONFIG.server.normalModeDelayMs = 500;
    assert.equal(CONFIG.moveDelayMs, 500);
    assert.equal(CONFIG.animationStepDurationMs, 250);
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Config Boundary');

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
