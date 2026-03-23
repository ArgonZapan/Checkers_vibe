/**
 * configSpeedHelpers.test.js — Tests for CONFIG speed helper getters.
 *
 * Covers: moveDelayMs, animationStepDurationMs branching logic.
 * Extracted from config.js — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted CONFIG speed logic (mirrors config.js getters) ────────────────

function makeConfig(overrides = {}) {
  const cfg = {
    server: {
      speedMode: 'normal',
      aiMoveDelayMs: 0,
      normalModeDelayMs: 500,
      ...overrides.server,
    },
  };
  return {
    ...cfg,
    get moveDelayMs() {
      const s = this.server;
      if (s.speedMode === 'fast') return 0;
      return s.aiMoveDelayMs > 0 ? s.aiMoveDelayMs : s.normalModeDelayMs;
    },
    get animationStepDurationMs() {
      if (this.server.speedMode === 'fast') return 0;
      return Math.floor(this.moveDelayMs / 2);
    },
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runConfigSpeedHelpersTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // moveDelayMs
  // ═══════════════════════════════════════════════════════════════════════

  test('moveDelayMs: fast mode always returns 0', () => {
    const cfg = makeConfig({ server: { speedMode: 'fast', aiMoveDelayMs: 9999, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 0);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs=0 uses normalModeDelayMs', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 0, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 500);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs>0 uses aiMoveDelayMs', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 300, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 300);
  });

  test('moveDelayMs: normal mode with aiMoveDelayMs=1 (boundary)', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 1, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 1);
  });

  test('moveDelayMs: normal mode custom normalModeDelayMs', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 0, normalModeDelayMs: 1000 } });
    assert.equal(cfg.moveDelayMs, 1000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // animationStepDurationMs
  // ═══════════════════════════════════════════════════════════════════════

  test('animationStepDurationMs: fast mode returns 0', () => {
    const cfg = makeConfig({ server: { speedMode: 'fast', aiMoveDelayMs: 1000 } });
    assert.equal(cfg.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: normal mode = floor(moveDelayMs / 2)', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 600, normalModeDelayMs: 500 } });
    assert.equal(cfg.animationStepDurationMs, 300);
  });

  test('animationStepDurationMs: odd moveDelayMs floors correctly', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 501, normalModeDelayMs: 500 } });
    assert.equal(cfg.animationStepDurationMs, 250);
  });

  test('animationStepDurationMs: moveDelayMs=0 gives 0', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 0, normalModeDelayMs: 0 } });
    assert.equal(cfg.animationStepDurationMs, 0);
  });

  test('animationStepDurationMs: moveDelayMs=1 gives 0 (floor(0.5))', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 1, normalModeDelayMs: 500 } });
    assert.equal(cfg.animationStepDurationMs, 0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases: negative aiMoveDelayMs
  // ═══════════════════════════════════════════════════════════════════════

  test('moveDelayMs: negative aiMoveDelayMs falls through to normalModeDelayMs', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: -100, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 500);
  });

  test('moveDelayMs: negative aiMoveDelayMs with custom normalModeDelayMs', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: -500, normalModeDelayMs: 200 } });
    assert.equal(cfg.moveDelayMs, 200);
  });

  test('animationStepDurationMs: negative aiMoveDelayMs uses normalModeDelayMs/2', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: -100, normalModeDelayMs: 600 } });
    assert.equal(cfg.animationStepDurationMs, 300);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases: invalid speedMode (falls through to normal path)
  // ═══════════════════════════════════════════════════════════════════════

  test('moveDelayMs: speedMode="turbo" falls through to normal path', () => {
    const cfg = makeConfig({ server: { speedMode: 'turbo', aiMoveDelayMs: 0, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 500);
  });

  test('moveDelayMs: speedMode="" falls through to normal path', () => {
    const cfg = makeConfig({ server: { speedMode: '', aiMoveDelayMs: 300, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 300);
  });

  test('moveDelayMs: speedMode=null falls through to normal path', () => {
    const cfg = makeConfig({ server: { speedMode: null, aiMoveDelayMs: 0, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 500);
  });

  test('animationStepDurationMs: speedMode="turbo" falls through to normal path', () => {
    const cfg = makeConfig({ server: { speedMode: 'turbo', aiMoveDelayMs: 600, normalModeDelayMs: 500 } });
    assert.equal(cfg.animationStepDurationMs, 300);
  });

  test('animationStepDurationMs: speedMode=null falls through to normal path', () => {
    const cfg = makeConfig({ server: { speedMode: null, aiMoveDelayMs: 0, normalModeDelayMs: 1000 } });
    assert.equal(cfg.animationStepDurationMs, 500);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases: very large values
  // ═══════════════════════════════════════════════════════════════════════

  test('moveDelayMs: very large aiMoveDelayMs (999999)', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 999999, normalModeDelayMs: 500 } });
    assert.equal(cfg.moveDelayMs, 999999);
  });

  test('animationStepDurationMs: very large moveDelayMs floors correctly', () => {
    const cfg = makeConfig({ server: { speedMode: 'normal', aiMoveDelayMs: 999999, normalModeDelayMs: 500 } });
    assert.equal(cfg.animationStepDurationMs, 499999);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Config Speed Helpers Tests');

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
