/**
 * moveQueueResilience.test.js — Tests for BUG-006: moveQueue recovery after rejection.
 *
 * After a rejection in the catch handler, the queue should reset to
 * Promise.resolve() so subsequent moves can still be processed.
 *
 * Extracted logic — mirrors server/index.js socket move queue pattern.
 */

import assert from 'node:assert/strict';

// ── Extracted: Move queue pattern (mirrors server/index.js) ─────────────────

/**
 * Simulate the move queue pattern from socket.on('move'):
 *
 *   socket._moveQueue = (socket._moveQueue || Promise.resolve())
 *     .then(() => handleMove(socket, data))
 *     .catch(err => {
 *       console.error('[WS] move error:', err.message);
 *       socket.emit('error', { message: 'Move failed' });
 *       socket._moveQueue = Promise.resolve();
 *     });
 */
function enqueueMove(socket, handleMoveFn, data) {
  socket._moveQueue = (socket._moveQueue || Promise.resolve())
    .then(() => handleMoveFn(socket, data))
    .catch(err => {
      socket._lastError = err.message;
      socket._moveQueue = Promise.resolve();
    });
  return socket._moveQueue;
}

/**
 * Create a mock socket with move queue support.
 */
function createMockSocket() {
  return {
    _moveQueue: undefined,
    _lastError: null,
    _events: [],
    emit(event, payload) {
      this._events.push({ event, payload });
    },
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runMoveQueueResilienceTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Basic: failing move then succeeding move ──────────────────────────

  test('move that throws is caught, next move still executes', async () => {
    const socket = createMockSocket();
    const callLog = [];

    const throwingHandler = () => {
      callLog.push('throw');
      throw new Error('Simulated move failure');
    };

    const successHandler = () => {
      callLog.push('success');
    };

    // First move throws
    await enqueueMove(socket, throwingHandler, { from: [2, 3], to: [3, 4] });
    assert.equal(socket._lastError, 'Simulated move failure');
    assert.deepStrictEqual(callLog, ['throw']);

    // Second move should still work
    await enqueueMove(socket, successHandler, { from: [3, 4], to: [4, 5] });
    assert.deepStrictEqual(callLog, ['throw', 'success']);
    assert.equal(socket._moveQueue instanceof Promise, true, 'queue should be a resolved promise');
  });

  // ── Queue resets to Promise.resolve after catch ───────────────────────

  test('queue resets to Promise.resolve() after rejection', async () => {
    const socket = createMockSocket();

    const throwingHandler = () => { throw new Error('boom'); };
    const successHandler = () => { return 'ok'; };

    await enqueueMove(socket, throwingHandler, {});
    // After catch, _moveQueue should be Promise.resolve()
    const resolved = await socket._moveQueue;
    assert.equal(resolved, undefined, 'Reset promise should resolve to undefined');

    await enqueueMove(socket, successHandler, {});
    const result = await socket._moveQueue;
    assert.equal(result, 'ok', 'Subsequent move should execute normally');
  });

  // ── Multiple failures in sequence ─────────────────────────────────────

  test('multiple failing moves in sequence do not break the queue', async () => {
    const socket = createMockSocket();
    let callCount = 0;

    const failingHandler = () => {
      callCount++;
      throw new Error(`fail-${callCount}`);
    };

    await enqueueMove(socket, failingHandler, {});
    await enqueueMove(socket, failingHandler, {});
    await enqueueMove(socket, failingHandler, {});

    assert.equal(callCount, 3, 'All three handlers should have been called');
    assert.equal(socket._lastError, 'fail-3');

    // Now a successful move
    let successCalled = false;
    await enqueueMove(socket, () => { successCalled = true; }, {});
    assert.equal(successCalled, true, 'Success move should execute after multiple failures');
  });

  // ── Error in async handler ────────────────────────────────────────────

  test('async handler that rejects is caught and queue recovers', async () => {
    const socket = createMockSocket();

    const asyncFailingHandler = async () => {
      await new Promise(r => setTimeout(r, 5));
      throw new Error('async failure');
    };

    const asyncSuccessHandler = async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'async-ok';
    };

    await enqueueMove(socket, asyncFailingHandler, {});
    assert.equal(socket._lastError, 'async failure');

    await enqueueMove(socket, asyncSuccessHandler, {});
    const result = await socket._moveQueue;
    assert.equal(result, 'async-ok', 'Async success should work after async failure');
  });

  // ── Queue is sequential (not parallel) ────────────────────────────────

  test('moves execute sequentially even when enqueued rapidly', async () => {
    const socket = createMockSocket();
    const order = [];

    const makeHandler = (id, delay) => async () => {
      order.push(`start-${id}`);
      await new Promise(r => setTimeout(r, delay));
      order.push(`end-${id}`);
    };

    // Enqueue three moves rapidly
    const p1 = enqueueMove(socket, makeHandler('A', 20), {});
    const p2 = enqueueMove(socket, makeHandler('B', 5), {});
    const p3 = enqueueMove(socket, makeHandler('C', 5), {});

    await Promise.all([p1, p2, p3]);

    // Should execute in order: A starts, A ends, B starts, B ends, C starts, C ends
    assert.deepStrictEqual(order, ['start-A', 'end-A', 'start-B', 'end-B', 'start-C', 'end-C'],
      'Moves should execute sequentially in order');
  });

  // ── Handler returns without error ─────────────────────────────────────

  test('normal handler that returns cleanly does not corrupt queue', async () => {
    const socket = createMockSocket();

    const handler1 = () => { /* no-op */ };
    const handler2 = () => 'result2';

    await enqueueMove(socket, handler1, {});
    await enqueueMove(socket, handler2, {});

    const result = await socket._moveQueue;
    assert.equal(result, 'result2');
    assert.equal(socket._lastError, null, 'No error should be recorded');
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
