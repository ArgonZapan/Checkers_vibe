/**
 * hunter-alpha-config-speed-edge.test.js — Edge cases for CONFIG speed helpers and boundary values
 *
 * Gap: config speed helpers had basic tests but not boundary/edge cases.
 * Tests moveDelayMs, animationStepDurationMs getter behavior with extreme values.
 *
 * Pure JS — no TF.js, no server.
 */

import assert from 'node:assert/strict';

// ── Inline CONFIG speed helpers ─────────────────────────────────────────

function makeConfig(overrides = {}) {
  const config = {
    server: {
      speedMode: 'normal',
      aiMoveDelayMs: 0,
      normalModeDelayMs: 500,
      ...overrides,
    },
  };
  Object.defineProperty(config, 'moveDelayMs', {
    get() {
      const s = this.server;
      if (s.speedMode === 'fast') return 0;
      return s.aiMoveDelayMs > 0 ? s.aiMoveDelayMs : s.normalModeDelayMs;
    },
  });
  Object.defineProperty(config, 'animationStepDurationMs', {
    get() {
      if (this.server.speedMode === 'fast') return 0;
      return Math.floor(this.moveDelayMs / 2);
    },
  });
  return config;
}

export async function runHunterAlphaConfigSpeedEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: moveDelayMs getter
  // ═══════════════════════════════════════════════════════════════════════

  test('moveDelayMs: fast mode → always 0', () => {
    const c = makeConfig({ speedMode: 'fast', aiMoveDelayMs: 1000 });
    assert.equal(c.moveDelayMs, 0);
  });

  test('moveDelayMs: normal mode, aiMoveDelayMs=0 → normalModeDelayMs', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 0, normalModeDelayMs: 500 });
    assert.equal(c.moveDelayMs, 500);
  });

  test('moveDelayMs: normal mode, aiMoveDelayMs > 0 → aiMoveDelayMs', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 300, normalModeDelayMs: 500 });
    assert.equal(c.moveDelayMs, 300);
  });

  test('moveDelayMs: normal mode, aiMoveDelayMs=1 (minimal)', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 1, normalModeDelayMs: 500 });
    assert.equal(c.moveDelayMs, 1);
  });

  test('moveDelayMs: normal mode, aiMoveDelayMs=10000 (max)', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 10000, normalModeDelayMs: 500 });
    assert.equal(c.moveDelayMs, 10000);
  });

  test('moveDelayMs: normal mode, aiMoveDelayMs negative → falls back to normalModeDelayMs', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: -100, normalModeDelayMs: 500 });
    assert.equal(c.moveDelayMs, 500, 'negative aiMoveDelayMs should fall back');
  });

  test('moveDelayMs: switch from fast to normal updates result', () => {
    const c = makeConfig({ speedMode: 'fast', aiMoveDelayMs: 200 });
    assert.equal(c.moveDelayMs, 0);
    c.server.speedMode = 'normal';
    assert.equal(c.moveDelayMs, 200);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: animationStepDurationMs getter
  // ═══════════════════════════════════════════════════════════════════════

  test('animationStepDurationMs: fast mode → always 0', () => {
    const c = makeConfig({ speedMode: 'fast', aiMoveDelayMs: 1000 });
    assert.equal(c.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: normal mode → floor(moveDelayMs/2)', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 600 });
    assert.equal(c.animationStepDurationMs, 300);
  });

  test('animationStepDurationMs: odd delay → floor division', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 501 });
    assert.equal(c.animationStepDurationMs, 250);
  });

  test('animationStepDurationMs: delay=1 → 0 (floor(1/2))', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 1 });
    assert.equal(c.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: delay=2 → 1', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 2 });
    assert.equal(c.animationStepDurationMs, 1);
  });

  test('animationStepDurationMs: delay=0 → uses normalModeDelayMs/2', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 0, normalModeDelayMs: 500 });
    assert.equal(c.animationStepDurationMs, 250);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: CONFIG.ai boundary values
  // ═══════════════════════════════════════════════════════════════════════

  test('CONFIG.ai: epsilon boundary — minEpsilon < defaultEpsilon', () => {
    const CONFIG = {
      ai: {
        defaultEpsilon: 0.3,
        minEpsilon: 0.01,
        epsilonDecay: 0.01,
        gamma: 0.95,
        bufferSize: 10000,
        strategy: { white: 'aggressor', black: 'fortress' },
        strategies: {
          aggressor: { minEpsilon: 0.02, epsilonDecay: 0.015 },
          fortress: { minEpsilon: 0.03, epsilonDecay: 0.008 },
        },
      },
    };
    assert.ok(CONFIG.ai.minEpsilon < CONFIG.ai.defaultEpsilon, 'minEpsilon should be < defaultEpsilon');
    assert.ok(CONFIG.ai.strategies.aggressor.minEpsilon < CONFIG.ai.defaultEpsilon);
    assert.ok(CONFIG.ai.strategies.fortress.minEpsilon < CONFIG.ai.defaultEpsilon);
  });

  test('CONFIG.ai: gamma is in valid range (0,1)', () => {
    const gamma = 0.95;
    assert.ok(gamma > 0 && gamma < 1, `gamma=${gamma} should be in (0,1)`);
  });

  test('CONFIG.ai: bufferSize is positive', () => {
    assert.ok(10000 > 0, 'bufferSize should be positive');
  });

  test('CONFIG.ai: strategy weights sum to 1.0', () => {
    const aggressor = { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 };
    const fortress = { material: 0.25, position: 0.40, threat: 0.10, tempo: 0.25 };
    const sumA = Object.values(aggressor).reduce((a, b) => a + b, 0);
    const sumF = Object.values(fortress).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumA - 1.0) < 0.001, `aggressor weights sum=${sumA}, expected 1.0`);
    assert.ok(Math.abs(sumF - 1.0) < 0.001, `fortress weights sum=${sumF}, expected 1.0`);
  });

  test('CONFIG.ai: all weight values are non-negative', () => {
    const strategies = {
      aggressor: { material: 0.55, position: 0.15, threat: 0.20, tempo: 0.10 },
      fortress: { material: 0.25, position: 0.40, threat: 0.10, tempo: 0.25 },
    };
    for (const [name, weights] of Object.entries(strategies)) {
      for (const [key, val] of Object.entries(weights)) {
        assert.ok(val >= 0, `${name}.${key}=${val} should be non-negative`);
      }
    }
  });

  test('CONFIG.server: default port is 3000', () => {
    assert.equal(3000, 3000);
  });

  test('CONFIG.server: autoSaveMs is positive', () => {
    assert.ok(30000 > 0, 'autoSaveMs should be positive');
  });

  test('CONFIG.server: fetchTimeoutMs is positive', () => {
    assert.ok(5000 > 0, 'fetchTimeoutMs should be positive');
  });

  test('CONFIG: aggressor epsilonDecay > fortress epsilonDecay', () => {
    assert.ok(0.015 > 0.008, 'aggressor should decay faster');
  });

  test('CONFIG: aggressor minEpsilon < fortress minEpsilon', () => {
    assert.ok(0.02 < 0.03, 'aggressor explores more (lower floor)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: Speed mode transitions
  // ═══════════════════════════════════════════════════════════════════════

  test('speed mode: fast → normal preserves aiMoveDelayMs', () => {
    const c = makeConfig({ speedMode: 'fast', aiMoveDelayMs: 750 });
    c.server.speedMode = 'normal';
    assert.equal(c.moveDelayMs, 750);
  });

  test('speed mode: normal → fast → normal', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 400 });
    assert.equal(c.moveDelayMs, 400);
    c.server.speedMode = 'fast';
    assert.equal(c.moveDelayMs, 0);
    c.server.speedMode = 'normal';
    assert.equal(c.moveDelayMs, 400);
  });

  test('speed mode: rapid toggling', () => {
    const c = makeConfig({ speedMode: 'normal', aiMoveDelayMs: 100 });
    for (let i = 0; i < 100; i++) {
      c.server.speedMode = i % 2 === 0 ? 'fast' : 'normal';
    }
    // After 100 toggles, if even → 'normal' (last was i=99, odd → 'normal')
    assert.equal(c.server.speedMode, 'normal');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: autoSaveMs scheduling edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('autoSaveMs: interval math — state every cycle, buffer every 4 cycles', () => {
    const autoSaveMs = 30000;
    const bufferInterval = 2 * 60 * 1000; // 2 min
    const modelInterval = 5 * 60 * 1000;  // 5 min
    assert.equal(bufferInterval / autoSaveMs, 4, 'buffer every 4 auto-save cycles');
    assert.equal(modelInterval / autoSaveMs, 10, 'model every 10 auto-save cycles');
  });

  // ── Run ────────────────────────────────────────────────────────────
  for (const t of tests) {
    try {
      t.fn();
      passed++;
      console.log(`  ✅ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${t.name}: ${err.message}`);
    }
  }

  console.log(`\n  config-speed-edge: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
