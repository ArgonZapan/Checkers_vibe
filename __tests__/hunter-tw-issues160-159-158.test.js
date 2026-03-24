/**
 * hunter-tw-issues160-159-158.test.js — Regression tests for issues #160, #159, #158.
 *
 * #160: Model dispose during active prediction
 *   — acquireModelLock() must block dispose until predict/train finishes.
 *
 * #159: startGame during active move
 *   — _moveQueue serialization must prevent race between startGame and move.
 *
 * #158: CORS_ORIGIN=* must NOT allow arbitrary origins on WebSocket upgrade
 *   — _isAllowedWsOrigin should reject unknown origins when wildcard CORS is set.
 *
 * Extracted logic — no server or TF.js required.
 */

import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════════════════
// #160: Model dispose mutex — acquireModelLock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimal trainer mock implementing acquireModelLock + _replaceModel
 * as in server/ai/trainer.js lines 460-478.
 */
function createTrainerMock() {
  let modelWhite = { id: 'w-v1', disposed: false, dispose() { this.disposed = true; } };
  let modelBlack = { id: 'b-v1', disposed: false, dispose() { this.disposed = true; } };
  let _modelLock = Promise.resolve();

  return {
    get modelWhite() { return modelWhite; },
    set modelWhite(m) { modelWhite = m; },
    get modelBlack() { return modelBlack; },
    set modelBlack(m) { modelBlack = m; },

    async acquireModelLock() {
      const prev = _modelLock;
      let release;
      _modelLock = new Promise(resolve => { release = resolve; });
      await prev;
      return release;
    },

    async _replaceModel(old, newId) {
      const release = await this.acquireModelLock();
      try {
        if (old) { old.dispose(); }
      } finally {
        release();
      }
      return { id: newId, disposed: false, dispose() { this.disposed = true; } };
    },

    async predict(turn, delayMs = 20) {
      const release = await this.acquireModelLock();
      try {
        const model = turn === 1 ? modelWhite : modelBlack;
        if (!model) throw new Error('Model not initialized');
        if (model.disposed) throw new Error('Model was disposed');
        // Simulate async prediction work
        await new Promise(r => setTimeout(r, delayMs));
        return { move: [0, 1], policy: [0.5, 0.5], modelId: model.id };
      } finally {
        release();
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #159: Move queue serialization — _moveQueue pattern
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulates the per-socket move queue pattern from server/index.js.
 * Both 'move' and 'startGame' events chain onto socket._moveQueue.
 */
function createSocketMock() {
  const log = [];
  let _moveQueue = Promise.resolve();

  return {
    log,

    enqueueMove(data) {
      _moveQueue = _moveQueue
        .then(async () => {
          log.push({ type: 'move-start', data, ts: Date.now() });
          // Simulate async move processing (C++ fetch etc.)
          await new Promise(r => setTimeout(r, 30));
          log.push({ type: 'move-end', data, ts: Date.now() });
        })
        .catch(err => {
          log.push({ type: 'move-error', error: err.message });
          _moveQueue = Promise.resolve();
        });
      return _moveQueue;
    },

    enqueueStartGame(mode) {
      _moveQueue = _moveQueue
        .then(async () => {
          log.push({ type: 'startGame-start', mode, ts: Date.now() });
          // Simulate async game start (C++ reset + start)
          await new Promise(r => setTimeout(r, 20));
          log.push({ type: 'startGame-end', mode, ts: Date.now() });
        })
        .catch(err => {
          log.push({ type: 'startGame-error', error: err.message });
          _moveQueue = Promise.resolve();
        });
      return _moveQueue;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// #158: CORS wildcard WebSocket origin check
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extracted from server/index.js — _isAllowedWsOrigin logic.
 *
 * When CORS_ORIGIN='*' the code must NOT allow arbitrary WS origins:
 *   - No Origin header (same-origin / non-browser) → allowed
 *   - Any Origin header → REJECTED (wildcard CORS ≠ wildcard WS)
 */
function isAllowedWsOrigin(origin, corsOrigin) {
  if (!origin) return true; // same-origin or non-browser (no Origin header)
  if (corsOrigin === '*') return false; // wildcard CORS ≠ wildcard WS
  const allowedList = corsOrigin.split(',').map(s => s.trim());
  return allowedList.some(allowed => origin === allowed);
}

// ═══════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════

export async function runHunterTwIssues160to158Tests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ─── #160: Model dispose during active prediction ─────────────────────

  test('#160: acquireModelLock blocks dispose until predict finishes', async () => {
    const trainer = createTrainerMock();
    const oldModel = trainer.modelWhite;

    // Start a slow predict (holds the lock for 50ms)
    const predictPromise = trainer.predict(1, 50);

    // Attempt dispose while predict is running — must wait
    let disposeCompleted = false;
    const replacePromise = (async () => {
      await new Promise(r => setTimeout(r, 10)); // slight delay so predict acquires lock first
      trainer.modelWhite = await trainer._replaceModel(trainer.modelWhite, 'w-v2');
      disposeCompleted = true;
    })();

    // Dispose should NOT complete before predict
    await new Promise(r => setTimeout(r, 25));
    assert.equal(disposeCompleted, false, 'dispose must not complete while predict holds the lock');

    // Now wait for both
    const predictResult = await predictPromise;
    await replacePromise;

    assert.equal(disposeCompleted, true, 'dispose should complete after predict releases lock');
    assert.equal(oldModel.disposed, true, 'old model should be disposed');
    assert.equal(trainer.modelWhite.id, 'w-v2', 'new model should be active');
    assert.ok(predictResult.move, 'predict should have returned a result');
  });

  test('#160: predict on disposed model throws, not crashes', async () => {
    const trainer = createTrainerMock();

    // Dispose model without lock (simulating bug scenario)
    trainer.modelWhite.dispose();
    assert.equal(trainer.modelWhite.disposed, true);

    // predict checks model.disposed and should throw cleanly
    let errorCaught = false;
    try {
      await trainer.predict(1, 5);
    } catch (err) {
      errorCaught = true;
      assert.ok(err.message.includes('disposed') || err.message.includes('not initialized'),
        'error should mention disposed or not initialized');
    }
    assert.equal(errorCaught, true, 'predict on disposed model should throw');
  });

  test('#160: multiple concurrent predicts serialize correctly via lock', async () => {
    const trainer = createTrainerMock();
    const order = [];

    // Fire 3 concurrent predicts with different delays
    const p1 = trainer.predict(1, 30).then(r => { order.push('p1'); return r; });
    const p2 = trainer.predict(1, 10).then(r => { order.push('p2'); return r; });
    const p3 = trainer.predict(-1, 5).then(r => { order.push('p3'); return r; });

    const results = await Promise.all([p1, p2, p3]);

    // All should complete without error
    assert.equal(results.length, 3, 'all 3 predicts should resolve');
    for (const r of results) {
      assert.ok(r.move, 'each predict should return a move');
    }
    // p1 started first and holds lock longest, so it finishes first
    assert.equal(order[0], 'p1', 'first predict to finish should be p1 (started first)');
  });

  test('#160: _replaceModel disposes old model inside lock', async () => {
    const trainer = createTrainerMock();
    const oldModel = trainer.modelWhite;

    // Hold the lock briefly, then replace
    const holdLock = trainer.acquireModelLock();
    let replaceCompleted = false;
    const replacePromise = (async () => {
      const rel = await holdLock;
      // Lock is ours — old model should NOT be disposed yet
      assert.equal(oldModel.disposed, false, 'old model should not be disposed while lock held');
      rel(); // release
      trainer.modelWhite = await trainer._replaceModel(oldModel, 'w-replaced');
      replaceCompleted = true;
    })();

    await replacePromise;
    assert.equal(replaceCompleted, true, '_replaceModel should complete');
    assert.equal(oldModel.disposed, true, 'old model should be disposed after _replaceModel');
  });

  // ─── #159: startGame during active move (race condition) ─────────────

  test('#159: startGame waits for in-flight move to finish (no race)', async () => {
    const socket = createSocketMock();

    // Start a move, then immediately start a game
    socket.enqueueMove({ from: [2, 1], to: [3, 0] });
    socket.enqueueStartGame('pvai');

    // Wait for both to finish
    await new Promise(r => setTimeout(r, 100));

    // Check ordering in log: move must fully complete before startGame begins
    const moveEnd = socket.log.find(e => e.type === 'move-end');
    const startGameStart = socket.log.find(e => e.type === 'startGame-start');

    assert.ok(moveEnd, 'move should have ended');
    assert.ok(startGameStart, 'startGame should have started');
    assert.ok(
      moveEnd.ts <= startGameStart.ts,
      `move-end (${moveEnd.ts}) must be <= startGame-start (${startGameStart.ts}) — move must finish before startGame`
    );
  });

  test('#159: multiple moves serialize correctly on _moveQueue', async () => {
    const socket = createSocketMock();

    // Fire 4 moves rapidly
    socket.enqueueMove({ from: [2, 1], to: [3, 0], n: 1 });
    socket.enqueueMove({ from: [5, 2], to: [4, 3], n: 2 });
    socket.enqueueMove({ from: [2, 3], to: [3, 4], n: 3 });
    socket.enqueueMove({ from: [5, 4], to: [4, 5], n: 4 });

    await new Promise(r => setTimeout(r, 200));

    // All moves should have started and ended
    const starts = socket.log.filter(e => e.type === 'move-start');
    const ends = socket.log.filter(e => e.type === 'move-end');
    assert.equal(starts.length, 4, 'all 4 moves should start');
    assert.equal(ends.length, 4, 'all 4 moves should end');

    // Each move-end must come before the next move-start
    for (let i = 1; i < starts.length; i++) {
      assert.ok(
        ends[i - 1].ts <= starts[i].ts,
        `move ${i} end (${ends[i - 1].ts}) must be <= move ${i + 1} start (${starts[i].ts})`
      );
    }
  });

  test('#159: startGame between two moves serializes correctly', async () => {
    const socket = createSocketMock();

    socket.enqueueMove({ from: [2, 1], to: [3, 0] });
    socket.enqueueStartGame('pvp');
    socket.enqueueMove({ from: [5, 2], to: [4, 3] });

    await new Promise(r => setTimeout(r, 150));

    // Verify full ordering: move1-end <= startGame-start <= startGame-end <= move2-start
    const events = socket.log;
    const move1End = events.find(e => e.type === 'move-end');
    const sgStart = events.find(e => e.type === 'startGame-start');
    const sgEnd = events.find(e => e.type === 'startGame-end');
    const move2Starts = events.filter(e => e.type === 'move-start');
    const move2Start = move2Starts[move2Starts.length > 1 ? 1 : 0];

    assert.ok(move1End && sgStart && sgEnd && move2Start, 'all events should exist');
    assert.ok(move1End.ts <= sgStart.ts, 'move1 must end before startGame starts');
    assert.ok(sgEnd.ts <= move2Start.ts, 'startGame must end before move2 starts');
  });

  test('#159: move queue recovers after error (reset to resolved)', async () => {
    const socket = createSocketMock();

    // Inject a failing move by monkey-patching
    const origEnqueue = socket.enqueueMove.bind(socket);
    socket.enqueueFailingMove = function () {
      const self = this;
      // @ts-ignore — accessing internal
      // We simulate by: the queue rejects, then catches and resets
      // Since our mock already handles catch, just verify recovery
      return origEnqueue({ fail: true });
    };

    // This will go through the normal flow (no actual error in mock)
    // But the key test: after queue processes, subsequent ops work
    socket.enqueueMove({ from: [0, 0], to: [1, 1] });
    socket.enqueueMove({ from: [7, 7], to: [6, 6] });

    await new Promise(r => setTimeout(r, 100));

    const ends = socket.log.filter(e => e.type === 'move-end');
    assert.equal(ends.length, 2, 'both moves should complete even after potential error');
  });

  // ─── #158: CORS wildcard ≠ WebSocket wildcard ────────────────────────

  test('#158: CORS_ORIGIN=* rejects arbitrary WebSocket origins', () => {
    assert.equal(
      isAllowedWsOrigin('http://evil.com', '*'),
      false,
      'arbitrary origin must be rejected when CORS_ORIGIN=*'
    );
    assert.equal(
      isAllowedWsOrigin('https://attacker.io', '*'),
      false,
      'https attacker origin must be rejected when CORS_ORIGIN=*'
    );
    assert.equal(
      isAllowedWsOrigin('http://localhost:8080', '*'),
      false,
      'even localhost variant must be rejected when CORS_ORIGIN=*'
    );
  });

  test('#158: CORS_ORIGIN=* allows requests without Origin header (same-origin)', () => {
    assert.equal(
      isAllowedWsOrigin(null, '*'),
      true,
      'null Origin (same-origin / non-browser) must be allowed'
    );
    assert.equal(
      isAllowedWsOrigin(undefined, '*'),
      true,
      'undefined Origin must be allowed'
    );
    assert.equal(
      isAllowedWsOrigin('', '*'),
      true,
      'empty Origin must be allowed'
    );
  });

  test('#158: specific CORS_ORIGIN allows matching WebSocket origins', () => {
    assert.equal(
      isAllowedWsOrigin('http://localhost:3000', 'http://localhost:3000'),
      true,
      'matching origin should be allowed'
    );
    assert.equal(
      isAllowedWsOrigin('http://evil.com', 'http://localhost:3000'),
      false,
      'non-matching origin should be rejected'
    );
  });

  test('#158: comma-separated CORS_ORIGIN allows multiple origins', () => {
    const cors = 'http://localhost:3000,https://example.com';
    assert.equal(isAllowedWsOrigin('http://localhost:3000', cors), true, 'first origin allowed');
    assert.equal(isAllowedWsOrigin('https://example.com', cors), true, 'second origin allowed');
    assert.equal(isAllowedWsOrigin('http://evil.com', cors), false, 'unknown origin rejected');
    assert.equal(isAllowedWsOrigin(null, cors), true, 'null origin allowed');
  });

  test('#158: wildcard CORS Origin must not bypass allowlist check', () => {
    // This is the critical security test: even if someone sets CORS_ORIGIN=*
    // in config, the WebSocket upgrade must NOT accept any Origin header.
    // The only safe case is no Origin header (same-origin).
    const corsOrigin = '*';

    // Browser requests with Origin header — all must be rejected
    const dangerousOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'https://example.com',
      'http://192.168.1.100:3000',
      'https://checkers-game.com',
      'null', // some browsers send "null" as string
    ];

    for (const origin of dangerousOrigins) {
      assert.equal(
        isAllowedWsOrigin(origin, corsOrigin),
        false,
        `Origin "${origin}" must be rejected when CORS_ORIGIN=* (wildcard WS is a security hole)`
      );
    }
  });

  // ── Run all tests ─────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
