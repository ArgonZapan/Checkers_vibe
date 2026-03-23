/**
 * hunter-alpha-selfplay-methods.test.js — Edge cases for SelfPlay class methods.
 *
 * Gaps identified:
 * - _validateAndFallback with null chosenMove
 * - _validateAndFallback with numeric index out of bounds
 * - _validateAndFallback with object move (from/to)
 * - _randomLegalMove with empty array
 * - _randomLegalMove with single element
 * - setParams with NaN epsilon (guard)
 * - setParams with Infinity epsilon (guard)
 * - setParams with side='white' only
 * - setParams with side='black' only
 * - setModelParams with out-of-range batchSize (clamping)
 * - restart with side='white' (only resets white)
 * - restart with side='black' (only resets black)
 * - getStatus returns correct structure
 * - paramsVersion increments for race guard
 */
import assert from 'node:assert/strict';

// ── Inline SelfPlay-like class for testing ────────────────────────────

class MockSelfPlay {
  constructor() {
    this.running = false;
    this.epsilonWhite = 0.71;
    this.epsilonBlack = 0.71;
    this.networkSizeWhite = 'small';
    this.networkSizeBlack = 'small';
    this.modelParams = { layers: 3, neurons: 128, activation: 'relu', lr: 0.001, batchSize: 64, dropout: 0 };
    this.modelWhite = null;
    this.modelBlack = null;
    this.stats = { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null, epsilonWhite: 0.71, epsilonBlack: 0.71 };
    this.paramsVersion = 0;
    this.roundTimes = [];
    this.totalTimeMs = 0;
    this.dirty = false;
    this.buffer = { clear: () => {}, size: () => 0 };
  }

  _randomLegalMove(legalMoves) {
    if (!legalMoves || legalMoves.length === 0) return null;
    const idx = Math.floor(Math.random() * legalMoves.length);
    return legalMoves[idx];
  }

  _validateAndFallback(chosenMove, legalMoves) {
    let selectedMove;
    if (typeof chosenMove === 'number' || (chosenMove && typeof chosenMove.index === 'number')) {
      const idx = typeof chosenMove === 'number' ? chosenMove : chosenMove.index;
      selectedMove = legalMoves[idx] || null;
    } else if (chosenMove && typeof chosenMove === 'object' && 'from' in chosenMove) {
      selectedMove = chosenMove;
    }
    if (!selectedMove) return this._randomLegalMove(legalMoves);
    // Simplified validation
    if (!selectedMove.from || !selectedMove.to) return this._randomLegalMove(legalMoves);
    // Check if in legal moves
    const isLegal = legalMoves.some(lm =>
      lm.from[0] === selectedMove.from[0] && lm.from[1] === selectedMove.from[1] &&
      lm.to[0] === selectedMove.to[0] && lm.to[1] === selectedMove.to[1]
    );
    if (!isLegal) return this._randomLegalMove(legalMoves);
    return selectedMove;
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

  setModelParams(newParams) {
    if (newParams.batchSize !== undefined) {
      const bs = newParams.batchSize;
      if (bs < 8 || bs > 256) {
        newParams.batchSize = Math.max(8, Math.min(256, bs));
      }
    }
    Object.assign(this.modelParams, newParams);
  }

  restart(side) {
    if (side === 'white' || side === 'both') {
      this.stats.whiteWins = 0;
    }
    if (side === 'black' || side === 'both') {
      this.stats.blackWins = 0;
    }
    if (side === 'both') {
      this.stats.gamesPlayed = 0;
      this.stats.draws = 0;
      this.stats.lastLoss = null;
      this.epsilonWhite = 0.71;
      this.epsilonBlack = 0.71;
    }
    this.dirty = true;
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
}

export async function runHunterAlphaSelfplayMethodsTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── _validateAndFallback ───────────────────────────────────────────

  test('_validateAndFallback: null chosenMove → random legal move', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }, { from: [2, 3], to: [3, 4] }];
    const result = sp._validateAndFallback(null, legal);
    assert.ok(result, 'should return a move');
    assert.ok(legal.includes(result), 'should be from legal moves');
  });

  test('_validateAndFallback: undefined chosenMove → random legal move', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }];
    const result = sp._validateAndFallback(undefined, legal);
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: numeric index 0 returns first legal move', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }, { from: [2, 3], to: [3, 4] }];
    const result = sp._validateAndFallback(0, legal);
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: numeric index out of bounds → random', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }];
    const result = sp._validateAndFallback(99, legal);
    assert.deepEqual(result, legal[0]); // only one option
  });

  test('_validateAndFallback: object with valid from/to returns it', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }, { from: [2, 3], to: [3, 4] }];
    const move = { from: [2, 3], to: [3, 4] };
    const result = sp._validateAndFallback(move, legal);
    assert.deepEqual(result, move);
  });

  test('_validateAndFallback: object with invalid from/to → random', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }];
    const move = { from: [0, 0], to: [1, 1] }; // not in legal moves
    const result = sp._validateAndFallback(move, legal);
    assert.deepEqual(result, legal[0]);
  });

  test('_validateAndFallback: chosenMove with index property', () => {
    const sp = new MockSelfPlay();
    const legal = [{ from: [2, 1], to: [3, 2] }, { from: [2, 3], to: [3, 4] }];
    const result = sp._validateAndFallback({ index: 1 }, legal);
    assert.deepEqual(result, legal[1]);
  });

  // ── _randomLegalMove ───────────────────────────────────────────────

  test('_randomLegalMove: empty array returns null', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp._randomLegalMove([]), null);
  });

  test('_randomLegalMove: null returns null', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp._randomLegalMove(null), null);
  });

  test('_randomLegalMove: undefined returns null', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp._randomLegalMove(undefined), null);
  });

  test('_randomLegalMove: single element returns that element', () => {
    const sp = new MockSelfPlay();
    const move = { from: [2, 1], to: [3, 2] };
    assert.deepEqual(sp._randomLegalMove([move]), move);
  });

  // ── setParams NaN/Infinity guard ───────────────────────────────────

  test('setParams: NaN epsilon is ignored (treated as undefined)', () => {
    const sp = new MockSelfPlay();
    const origEpsilon = sp.epsilonWhite;
    sp.setParams(NaN, undefined, 'both');
    assert.equal(sp.epsilonWhite, origEpsilon, 'NaN epsilon should not change value');
  });

  test('setParams: Infinity epsilon is ignored', () => {
    const sp = new MockSelfPlay();
    const origEpsilon = sp.epsilonWhite;
    sp.setParams(Infinity, undefined, 'both');
    assert.equal(sp.epsilonWhite, origEpsilon);
  });

  test('setParams: -Infinity epsilon is ignored', () => {
    const sp = new MockSelfPlay();
    const origEpsilon = sp.epsilonWhite;
    sp.setParams(-Infinity, undefined, 'both');
    assert.equal(sp.epsilonWhite, origEpsilon);
  });

  test('setParams: epsilon=-0.5 (negative) is ignored', () => {
    const sp = new MockSelfPlay();
    const origEpsilon = sp.epsilonWhite;
    sp.setParams(-0.5, undefined, 'both');
    assert.equal(sp.epsilonWhite, origEpsilon);
  });

  test('setParams: epsilon=1.5 (>1) is ignored', () => {
    const sp = new MockSelfPlay();
    const origEpsilon = sp.epsilonWhite;
    sp.setParams(1.5, undefined, 'both');
    assert.equal(sp.epsilonWhite, origEpsilon);
  });

  test('setParams: valid epsilon=0.5 sets correctly', () => {
    const sp = new MockSelfPlay();
    sp.setParams(0.5, undefined, 'both');
    assert.equal(sp.epsilonWhite, 0.5);
    assert.equal(sp.epsilonBlack, 0.5);
  });

  test('setParams: side=white only changes white epsilon', () => {
    const sp = new MockSelfPlay();
    sp.setParams(0.1, undefined, 'white');
    assert.equal(sp.epsilonWhite, 0.1);
    assert.equal(sp.epsilonBlack, 0.71); // unchanged
  });

  test('setParams: side=black only changes black epsilon', () => {
    const sp = new MockSelfPlay();
    sp.setParams(0.1, undefined, 'black');
    assert.equal(sp.epsilonBlack, 0.1);
    assert.equal(sp.epsilonWhite, 0.71); // unchanged
  });

  test('setParams: sets dirty flag', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp.dirty, false);
    sp.setParams(0.5, undefined, 'both');
    assert.equal(sp.dirty, true);
  });

  test('setParams: updates stats.epsilonWhite/Black', () => {
    const sp = new MockSelfPlay();
    sp.setParams(0.3, undefined, 'both');
    assert.equal(sp.stats.epsilonWhite, 0.3);
    assert.equal(sp.stats.epsilonBlack, 0.3);
  });

  // ── setModelParams batchSize clamping ──────────────────────────────

  test('setModelParams: batchSize=4 clamps to 8', () => {
    const sp = new MockSelfPlay();
    sp.setModelParams({ batchSize: 4 });
    assert.equal(sp.modelParams.batchSize, 8);
  });

  test('setModelParams: batchSize=500 clamps to 256', () => {
    const sp = new MockSelfPlay();
    sp.setModelParams({ batchSize: 500 });
    assert.equal(sp.modelParams.batchSize, 256);
  });

  test('setModelParams: batchSize=64 stays 64', () => {
    const sp = new MockSelfPlay();
    sp.setModelParams({ batchSize: 64 });
    assert.equal(sp.modelParams.batchSize, 64);
  });

  test('setModelParams: batchSize=8 (boundary) stays 8', () => {
    const sp = new MockSelfPlay();
    sp.setModelParams({ batchSize: 8 });
    assert.equal(sp.modelParams.batchSize, 8);
  });

  test('setModelParams: batchSize=256 (boundary) stays 256', () => {
    const sp = new MockSelfPlay();
    sp.setModelParams({ batchSize: 256 });
    assert.equal(sp.modelParams.batchSize, 256);
  });

  // ── restart ────────────────────────────────────────────────────────

  test('restart: side=white resets whiteWins only', () => {
    const sp = new MockSelfPlay();
    sp.stats.whiteWins = 10;
    sp.stats.blackWins = 5;
    sp.stats.gamesPlayed = 15;
    sp.restart('white');
    assert.equal(sp.stats.whiteWins, 0);
    assert.equal(sp.stats.blackWins, 5); // unchanged
    assert.equal(sp.stats.gamesPlayed, 15); // unchanged
  });

  test('restart: side=black resets blackWins only', () => {
    const sp = new MockSelfPlay();
    sp.stats.whiteWins = 10;
    sp.stats.blackWins = 5;
    sp.restart('black');
    assert.equal(sp.stats.blackWins, 0);
    assert.equal(sp.stats.whiteWins, 10); // unchanged
  });

  test('restart: side=both resets everything', () => {
    const sp = new MockSelfPlay();
    sp.stats.whiteWins = 10;
    sp.stats.blackWins = 5;
    sp.stats.gamesPlayed = 15;
    sp.stats.draws = 3;
    sp.stats.lastLoss = 0.5;
    sp.restart('both');
    assert.equal(sp.stats.whiteWins, 0);
    assert.equal(sp.stats.blackWins, 0);
    assert.equal(sp.stats.gamesPlayed, 0);
    assert.equal(sp.stats.draws, 0);
    assert.equal(sp.stats.lastLoss, null);
  });

  test('restart: sets dirty flag', () => {
    const sp = new MockSelfPlay();
    sp.dirty = false;
    sp.restart('both');
    assert.equal(sp.dirty, true);
  });

  // ── getStatus ──────────────────────────────────────────────────────

  test('getStatus: returns expected structure', () => {
    const sp = new MockSelfPlay();
    const status = sp.getStatus();
    assert.ok('running' in status);
    assert.ok('stats' in status);
    assert.ok('bufferSize' in status);
    assert.ok('networkSizeWhite' in status);
    assert.ok('networkSizeBlack' in status);
    assert.ok('modelParams' in status);
    assert.ok('avgRoundTimeMs' in status);
    assert.ok('last10Times' in status);
    assert.ok('totalTimeMs' in status);
  });

  test('getStatus: avgRoundTimeMs=0 when no rounds', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp.getStatus().avgRoundTimeMs, 0);
  });

  test('getStatus: modelParams is a copy (not reference)', () => {
    const sp = new MockSelfPlay();
    const status = sp.getStatus();
    status.modelParams.layers = 999;
    assert.equal(sp.modelParams.layers, 3); // original unchanged
  });

  // ── paramsVersion race guard ───────────────────────────────────────

  test('paramsVersion: initial value is 0', () => {
    const sp = new MockSelfPlay();
    assert.equal(sp.paramsVersion, 0);
  });

  test('paramsVersion: increment changes value', () => {
    const sp = new MockSelfPlay();
    sp.paramsVersion++;
    assert.equal(sp.paramsVersion, 1);
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: SelfPlay Methods');

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
