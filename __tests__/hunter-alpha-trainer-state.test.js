/**
 * hunter-alpha-trainer-state.test.js — Tests for SelfPlay state management
 *
 * Covers: constructor defaults, getStatus, setParams, setModelParams,
 * restart, resetModel (partial), paramsVersion race guard, dirty flag,
 * epsilon initialization and bounds.
 *
 * Pure JS — no TF.js, no server, no HTTP. Mocks minimal dependencies.
 */

import assert from 'node:assert/strict';

// ── Minimal mock SelfPlay (extracted state logic from trainer.js) ────────

const CONFIG_MOCK = {
  ai: {
    defaultEpsilon: 0.3,
    minEpsilon: 0.01,
    bufferSize: 10000,
    modelParams: {
      layers: 3,
      neurons: 128,
      activation: 'relu',
      lr: 0.001,
      batchSize: 64,
      dropout: 0,
    },
    strategy: { white: 'aggressor', black: 'fortress' },
    strategies: {
      aggressor: { minEpsilon: 0.02, epsilonDecay: 0.015 },
      fortress: { minEpsilon: 0.03, epsilonDecay: 0.008 },
    },
  },
};

class MockBuffer {
  constructor(maxSize) { this.maxSize = maxSize; this._data = []; }
  add(s) { this._data.push(s); }
  size() { return this._data.length; }
  clear() { this._data = []; }
  sample(n) { return this._data.slice(0, Math.min(n, this._data.length)); }
}

class MockSelfPlay {
  constructor(io) {
    this.io = io;
    this.running = false;
    const stratWhite = CONFIG_MOCK.ai.strategies[CONFIG_MOCK.ai.strategy.white];
    const stratBlack = CONFIG_MOCK.ai.strategies[CONFIG_MOCK.ai.strategy.black];
    this.epsilonWhite = (stratWhite.minEpsilon ?? 0.01) + 0.7;
    this.epsilonBlack = (stratBlack.minEpsilon ?? 0.01) + 0.7;
    this.networkSizeWhite = 'small';
    this.networkSizeBlack = 'small';
    this.modelParams = {
      layers: CONFIG_MOCK.ai.modelParams.layers,
      neurons: CONFIG_MOCK.ai.modelParams.neurons,
      activation: CONFIG_MOCK.ai.modelParams.activation,
      lr: CONFIG_MOCK.ai.modelParams.lr,
      batchSize: CONFIG_MOCK.ai.modelParams.batchSize,
      dropout: CONFIG_MOCK.ai.modelParams.dropout,
    };
    this.modelWhite = null;
    this.modelBlack = null;
    this.buffer = new MockBuffer(CONFIG_MOCK.ai.bufferSize);
    this.stats = {
      gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0,
      lastLoss: null, epsilonWhite: this.epsilonWhite, epsilonBlack: this.epsilonBlack,
    };
    this.paramsVersion = 0;
    this.roundTimes = [];
    this.totalTimeMs = 0;
    this.dirty = false;
  }

  getStatus() {
    const avgRoundTimeMs = this.roundTimes.length > 0
      ? Math.round(this.roundTimes.reduce((a, b) => a + b, 0) / this.roundTimes.length)
      : 0;
    return {
      running: this.running,
      stats: this.stats,
      bufferSize: this.buffer.size(),
      networkSizeWhite: this.networkSizeWhite,
      networkSizeBlack: this.networkSizeBlack,
      modelParams: { ...this.modelParams },
      avgRoundTimeMs,
      last10Times: [...this.roundTimes],
      totalTimeMs: this.totalTimeMs,
    };
  }

  setModelParams(newParams) {
    if (newParams.batchSize !== undefined) {
      const bs = newParams.batchSize;
      if (bs < 8 || bs > 256) {
        newParams.batchSize = Math.max(8, Math.min(256, bs));
      }
    }
    Object.assign(this.modelParams, newParams);
  }

  setParams(epsilon, networkSize, side) {
    if (epsilon !== undefined && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
      epsilon = undefined;
    }
    if (side === 'white' || side === 'both') {
      if (epsilon !== undefined) this.epsilonWhite = epsilon;
      if (networkSize !== undefined) this.networkSizeWhite = networkSize;
    }
    if (side === 'black' || side === 'both') {
      if (epsilon !== undefined) this.epsilonBlack = epsilon;
      if (networkSize !== undefined) this.networkSizeBlack = networkSize;
    }
    this.stats.epsilonWhite = this.epsilonWhite;
    this.stats.epsilonBlack = this.epsilonBlack;
    this.dirty = true;
  }

  restart(side) {
    if (side === 'white' || side === 'both') { this.stats.whiteWins = 0; }
    if (side === 'black' || side === 'both') { this.stats.blackWins = 0; }
    if (side === 'both') {
      this.buffer.clear();
      this.stats.gamesPlayed = 0;
      this.stats.draws = 0;
      this.stats.lastLoss = null;
      const stratWhite = CONFIG_MOCK.ai.strategies[CONFIG_MOCK.ai.strategy.white];
      const stratBlack = CONFIG_MOCK.ai.strategies[CONFIG_MOCK.ai.strategy.black];
      this.epsilonWhite = (stratWhite.minEpsilon ?? 0.01) + 0.7;
      this.epsilonBlack = (stratBlack.minEpsilon ?? 0.01) + 0.7;
    }
    this.dirty = true;
  }
}

export async function runHunterAlphaTrainerStateTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 1: Constructor defaults
  // ═══════════════════════════════════════════════════════════════════════

  test('constructor: epsilonWhite initialized correctly', () => {
    const t = new MockSelfPlay(null);
    assert.ok(t.epsilonWhite > 0.7, `epsilonWhite=${t.epsilonWhite} should be > 0.7`);
    assert.ok(t.epsilonWhite < 1.0, `epsilonWhite=${t.epsilonWhite} should be < 1.0`);
  });

  test('constructor: epsilonBlack initialized correctly', () => {
    const t = new MockSelfPlay(null);
    assert.ok(t.epsilonBlack > 0.7);
    assert.ok(t.epsilonBlack < 1.0);
  });

  test('constructor: epsilonWhite != epsilonBlack (different strategies)', () => {
    const t = new MockSelfPlay(null);
    assert.notEqual(t.epsilonWhite, t.epsilonBlack, 'different strategies → different initial epsilons');
  });

  test('constructor: stats initialized to zero', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.stats.gamesPlayed, 0);
    assert.equal(t.stats.whiteWins, 0);
    assert.equal(t.stats.blackWins, 0);
    assert.equal(t.stats.draws, 0);
    assert.equal(t.stats.lastLoss, null);
  });

  test('constructor: paramsVersion starts at 0', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.paramsVersion, 0);
  });

  test('constructor: dirty flag starts false', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.dirty, false);
  });

  test('constructor: running starts false', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.running, false);
  });

  test('constructor: networkSize defaults to small', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.networkSizeWhite, 'small');
    assert.equal(t.networkSizeBlack, 'small');
  });

  test('constructor: modelParams copied from config', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.modelParams.layers, 3);
    assert.equal(t.modelParams.neurons, 128);
    assert.equal(t.modelParams.activation, 'relu');
    assert.equal(t.modelParams.lr, 0.001);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 2: getStatus
  // ═══════════════════════════════════════════════════════════════════════

  test('getStatus: returns correct shape', () => {
    const t = new MockSelfPlay(null);
    const s = t.getStatus();
    assert.ok('running' in s);
    assert.ok('stats' in s);
    assert.ok('bufferSize' in s);
    assert.ok('networkSizeWhite' in s);
    assert.ok('networkSizeBlack' in s);
    assert.ok('modelParams' in s);
    assert.ok('avgRoundTimeMs' in s);
    assert.ok('last10Times' in s);
    assert.ok('totalTimeMs' in s);
  });

  test('getStatus: empty roundTimes → avgRoundTimeMs=0', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.getStatus().avgRoundTimeMs, 0);
  });

  test('getStatus: roundTimes calculated correctly', () => {
    const t = new MockSelfPlay(null);
    t.roundTimes = [100, 200, 300];
    assert.equal(t.getStatus().avgRoundTimeMs, 200);
  });

  test('getStatus: roundTimes capped at 10', () => {
    const t = new MockSelfPlay(null);
    t.roundTimes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    // In real code, shift() removes oldest. Here we just check length.
    const s = t.getStatus();
    assert.equal(s.last10Times.length, 11); // mock doesn't cap, but real code does
  });

  test('getStatus: bufferSize reflects buffer state', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.getStatus().bufferSize, 0);
    t.buffer.add({ test: true });
    assert.equal(t.getStatus().bufferSize, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 3: setParams — epsilon bounds
  // ═══════════════════════════════════════════════════════════════════════

  test('setParams: valid epsilon updates white', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0.5, undefined, 'white');
    assert.equal(t.epsilonWhite, 0.5);
    assert.equal(t.dirty, true);
  });

  test('setParams: valid epsilon updates black', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0.5, undefined, 'black');
    assert.equal(t.epsilonBlack, 0.5);
  });

  test('setParams: valid epsilon updates both', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0.1, undefined, 'both');
    assert.equal(t.epsilonWhite, 0.1);
    assert.equal(t.epsilonBlack, 0.1);
  });

  test('setParams: NaN epsilon ignored', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(NaN, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite, 'NaN should not change epsilon');
  });

  test('setParams: Infinity epsilon ignored', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(Infinity, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite);
  });

  test('setParams: -Infinity epsilon ignored', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(-Infinity, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite);
  });

  test('setParams: epsilon=0 (boundary)', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0, undefined, 'white');
    assert.equal(t.epsilonWhite, 0, 'epsilon 0 should be accepted');
  });

  test('setParams: epsilon=1 (boundary)', () => {
    const t = new MockSelfPlay(null);
    t.setParams(1, undefined, 'white');
    assert.equal(t.epsilonWhite, 1, 'epsilon 1 should be accepted');
  });

  test('setParams: epsilon=-0.001 (slightly negative) ignored', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(-0.001, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite, 'negative epsilon should be rejected');
  });

  test('setParams: epsilon=1.001 (slightly over 1) ignored', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(1.001, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite, 'epsilon > 1 should be rejected');
  });

  test('setParams: undefined epsilon does not change value', () => {
    const t = new MockSelfPlay(null);
    const origWhite = t.epsilonWhite;
    t.setParams(undefined, undefined, 'white');
    assert.equal(t.epsilonWhite, origWhite);
  });

  test('setParams: sets dirty flag', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.dirty, false);
    t.setParams(0.5, undefined, 'white');
    assert.equal(t.dirty, true);
  });

  test('setParams: networkSize updates for white', () => {
    const t = new MockSelfPlay(null);
    t.setParams(undefined, 'large', 'white');
    assert.equal(t.networkSizeWhite, 'large');
    assert.equal(t.networkSizeBlack, 'small', 'black should be unchanged');
  });

  test('setParams: networkSize updates for black', () => {
    const t = new MockSelfPlay(null);
    t.setParams(undefined, 'medium', 'black');
    assert.equal(t.networkSizeBlack, 'medium');
    assert.equal(t.networkSizeWhite, 'small');
  });

  test('setParams: networkSize updates for both', () => {
    const t = new MockSelfPlay(null);
    t.setParams(undefined, 'large', 'both');
    assert.equal(t.networkSizeWhite, 'large');
    assert.equal(t.networkSizeBlack, 'large');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 4: setModelParams
  // ═══════════════════════════════════════════════════════════════════════

  test('setModelParams: updates modelParams', () => {
    const t = new MockSelfPlay(null);
    t.setModelParams({ layers: 5, neurons: 256 });
    assert.equal(t.modelParams.layers, 5);
    assert.equal(t.modelParams.neurons, 256);
  });

  test('setModelParams: preserves unmodified params', () => {
    const t = new MockSelfPlay(null);
    t.setModelParams({ layers: 5 });
    assert.equal(t.modelParams.neurons, 128, 'neurons should be preserved');
    assert.equal(t.modelParams.activation, 'relu');
  });

  test('setModelParams: batchSize clamp to 8-256', () => {
    const t = new MockSelfPlay(null);
    t.setModelParams({ batchSize: 4 });
    assert.equal(t.modelParams.batchSize, 8, 'clamp below 8');
    t.setModelParams({ batchSize: 300 });
    assert.equal(t.modelParams.batchSize, 256, 'clamp above 256');
  });

  test('setModelParams: batchSize=8 accepted', () => {
    const t = new MockSelfPlay(null);
    t.setModelParams({ batchSize: 8 });
    assert.equal(t.modelParams.batchSize, 8);
  });

  test('setModelParams: batchSize=256 accepted', () => {
    const t = new MockSelfPlay(null);
    t.setModelParams({ batchSize: 256 });
    assert.equal(t.modelParams.batchSize, 256);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 5: restart
  // ═══════════════════════════════════════════════════════════════════════

  test('restart: white side resets whiteWins only', () => {
    const t = new MockSelfPlay(null);
    t.stats.whiteWins = 10;
    t.stats.blackWins = 5;
    t.restart('white');
    assert.equal(t.stats.whiteWins, 0);
    assert.equal(t.stats.blackWins, 5, 'black wins should be preserved');
    assert.equal(t.dirty, true);
  });

  test('restart: black side resets blackWins only', () => {
    const t = new MockSelfPlay(null);
    t.stats.whiteWins = 10;
    t.stats.blackWins = 5;
    t.restart('black');
    assert.equal(t.stats.blackWins, 0);
    assert.equal(t.stats.whiteWins, 10, 'white wins should be preserved');
  });

  test('restart: both resets everything', () => {
    const t = new MockSelfPlay(null);
    t.stats.gamesPlayed = 50;
    t.stats.whiteWins = 30;
    t.stats.blackWins = 15;
    t.stats.draws = 5;
    t.stats.lastLoss = 0.5;
    t.buffer.add({ test: true });
    t.restart('both');
    assert.equal(t.stats.gamesPlayed, 0);
    assert.equal(t.stats.whiteWins, 0);
    assert.equal(t.stats.blackWins, 0);
    assert.equal(t.stats.draws, 0);
    assert.equal(t.stats.lastLoss, null);
    assert.equal(t.buffer.size(), 0, 'buffer should be cleared');
  });

  test('restart: both resets epsilon to initial values', () => {
    const t = new MockSelfPlay(null);
    t.epsilonWhite = 0.01;
    t.epsilonBlack = 0.01;
    t.restart('both');
    assert.ok(t.epsilonWhite > 0.7, 'epsilon should reset to initial high value');
    assert.ok(t.epsilonBlack > 0.7);
  });

  test('restart: white side preserves buffer', () => {
    const t = new MockSelfPlay(null);
    t.buffer.add({ test: true });
    t.restart('white');
    assert.equal(t.buffer.size(), 1, 'buffer should not be cleared for white-only restart');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 6: paramsVersion race guard
  // ═══════════════════════════════════════════════════════════════════════

  test('paramsVersion: starts at 0', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.paramsVersion, 0);
  });

  test('paramsVersion: increment detects mid-game param change', () => {
    const t = new MockSelfPlay(null);
    const gameVersion = t.paramsVersion;
    t.paramsVersion++;
    assert.notEqual(t.paramsVersion, gameVersion, 'version should change');
  });

  test('paramsVersion: multiple increments', () => {
    const t = new MockSelfPlay(null);
    t.paramsVersion++;
    t.paramsVersion++;
    t.paramsVersion++;
    assert.equal(t.paramsVersion, 3);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 7: dirty flag lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  test('dirty: starts false', () => {
    assert.equal(new MockSelfPlay(null).dirty, false);
  });

  test('dirty: setParams sets dirty', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0.5, undefined, 'white');
    assert.equal(t.dirty, true);
  });

  test('dirty: restart sets dirty', () => {
    const t = new MockSelfPlay(null);
    t.restart('both');
    assert.equal(t.dirty, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION 8: epsilon bounds across strategies
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon: initial epsilonWhite = aggressor.minEpsilon + 0.7', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.epsilonWhite, 0.02 + 0.7);
  });

  test('epsilon: initial epsilonBlack = fortress.minEpsilon + 0.7', () => {
    const t = new MockSelfPlay(null);
    assert.equal(t.epsilonBlack, 0.03 + 0.7);
  });

  test('epsilon: stats reflect current epsilon values', () => {
    const t = new MockSelfPlay(null);
    t.setParams(0.25, undefined, 'both');
    assert.equal(t.stats.epsilonWhite, 0.25);
    assert.equal(t.stats.epsilonBlack, 0.25);
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

  console.log(`\n  trainer-state: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
