/**
 * moveSerialization.test.js — Tests for WS move handler serialization (promise queue).
 *
 * Covers the _moveQueue promise chain in server/index.js:
 * - Moves are serialized per-socket (no concurrent execution)
 * - Throttle: max 1 move per 50ms per socket
 * - Queue error handling
 * - Coordinate validation before queue entry
 * - Captures array validation
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: move serialization logic (mirrors server/index.js) ───────────

/**
 * Validates move coordinates (mirrors isValidCoord from server/index.js).
 */
function isValidCoord(c) {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    Number.isInteger(c[0]) &&
    Number.isInteger(c[1]) &&
    c[0] >= 0 && c[0] <= 7 &&
    c[1] >= 0 && c[1] <= 7
  );
}

/**
 * Full move validation (mirrors the move handler validation).
 */
function validateMoveData(data) {
  if (!data || typeof data !== 'object') return { valid: false, error: 'invalid data' };
  const { from, to, captures } = data;

  if (!isValidCoord(from)) return { valid: false, error: 'Invalid "from" coordinate' };
  if (!isValidCoord(to)) return { valid: false, error: 'Invalid "to" coordinate' };
  if (captures != null && !Array.isArray(captures)) return { valid: false, error: 'Invalid captures — expected array' };
  if (Array.isArray(captures)) {
    for (let i = 0; i < captures.length; i++) {
      if (!isValidCoord(captures[i])) return { valid: false, error: `Invalid capture at index ${i}` };
    }
  }
  return { valid: true };
}

/**
 * Throttle check (mirrors wsThrottle from server/index.js).
 */
function createThrottle() {
  const store = {};
  return function checkThrottle(key, minIntervalMs) {
    const now = Date.now();
    const last = store[key] || 0;
    if (now - last < minIntervalMs) return false;
    store[key] = now;
    return true;
  };
}

/**
 * Simulate promise queue serialization.
 */
class MoveQueue {
  constructor() {
    this.queue = Promise.resolve();
    this.executionLog = [];
  }

  enqueue(moveHandler, data) {
    this.queue = this.queue
      .then(() => {
        this.executionLog.push({ action: 'start', data, time: Date.now() });
        return moveHandler(data);
      })
      .then(result => {
        this.executionLog.push({ action: 'complete', data, result });
      })
      .catch(err => {
        this.executionLog.push({ action: 'error', data, error: err.message });
      });
    return this.queue;
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runMoveSerializationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Coordinate validation
  // ═══════════════════════════════════════════════════════════════════════

  test('isValidCoord: valid [0,0]', () => {
    assert.ok(isValidCoord([0, 0]));
  });

  test('isValidCoord: valid [7,7]', () => {
    assert.ok(isValidCoord([7, 7]));
  });

  test('isValidCoord: valid [3,4]', () => {
    assert.ok(isValidCoord([3, 4]));
  });

  test('isValidCoord: null → false', () => {
    assert.ok(!isValidCoord(null));
  });

  test('isValidCoord: undefined → false', () => {
    assert.ok(!isValidCoord(undefined));
  });

  test('isValidCoord: [0] — single element → false', () => {
    assert.ok(!isValidCoord([0]));
  });

  test('isValidCoord: [0,0,0] — three elements → false', () => {
    assert.ok(!isValidCoord([0, 0, 0]));
  });

  test('isValidCoord: [-1, 0] — negative → false', () => {
    assert.ok(!isValidCoord([-1, 0]));
  });

  test('isValidCoord: [8, 0] — out of range → false', () => {
    assert.ok(!isValidCoord([8, 0]));
  });

  test('isValidCoord: [3.5, 2] — float → false', () => {
    assert.ok(!isValidCoord([3.5, 2]));
  });

  test('isValidCoord: ["a", 0] — string → false', () => {
    assert.ok(!isValidCoord(['a', 0]));
  });

  test('isValidCoord: scalar 5 → false', () => {
    assert.ok(!isValidCoord(5));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Full move validation
  // ═══════════════════════════════════════════════════════════════════════

  test('validateMoveData: valid move without captures', () => {
    const r = validateMoveData({ from: [2, 1], to: [3, 2] });
    assert.equal(r.valid, true);
  });

  test('validateMoveData: valid move with captures', () => {
    const r = validateMoveData({ from: [2, 1], to: [4, 3], captures: [[3, 2]] });
    assert.equal(r.valid, true);
  });

  test('validateMoveData: valid move with multi-capture', () => {
    const r = validateMoveData({ from: [2, 1], to: [6, 5], captures: [[3, 2], [5, 4]] });
    assert.equal(r.valid, true);
  });

  test('validateMoveData: null data → invalid', () => {
    const r = validateMoveData(null);
    assert.equal(r.valid, false);
  });

  test('validateMoveData: invalid from → invalid', () => {
    const r = validateMoveData({ from: [8, 0], to: [3, 2] });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('from'));
  });

  test('validateMoveData: invalid to → invalid', () => {
    const r = validateMoveData({ from: [2, 1], to: [-1, 2] });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('to'));
  });

  test('validateMoveData: captures not an array → invalid', () => {
    const r = validateMoveData({ from: [2, 1], to: [3, 2], captures: 'bad' });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('captures'));
  });

  test('validateMoveData: invalid capture element → invalid', () => {
    const r = validateMoveData({ from: [2, 1], to: [4, 3], captures: [[3, 8]] });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('capture'));
  });

  test('validateMoveData: empty captures array → valid', () => {
    const r = validateMoveData({ from: [2, 1], to: [3, 2], captures: [] });
    assert.equal(r.valid, true);
  });

  test('validateMoveData: null captures → valid (captures is optional)', () => {
    const r = validateMoveData({ from: [2, 1], to: [3, 2], captures: null });
    assert.equal(r.valid, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Throttle
  // ═══════════════════════════════════════════════════════════════════════

  test('throttle: first call always passes', () => {
    const throttle = createThrottle();
    assert.ok(throttle('move', 50));
  });

  test('throttle: rapid second call is blocked', () => {
    const throttle = createThrottle();
    throttle('move', 50);
    // Immediate second call should be blocked
    assert.ok(!throttle('move', 50));
  });

  test('throttle: different keys are independent', () => {
    const throttle = createThrottle();
    throttle('move', 50);
    assert.ok(throttle('setParams', 50), 'different key should pass');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Promise queue serialization
  // ═══════════════════════════════════════════════════════════════════════

  test('MoveQueue: moves execute in order', async () => {
    const queue = new MoveQueue();
    const order = [];

    const handler = (data) => {
      order.push(data.id);
      return Promise.resolve(data.id);
    };

    // Enqueue 3 moves (all at once — should serialize)
    queue.enqueue(handler, { id: 1 });
    queue.enqueue(handler, { id: 2 });
    queue.enqueue(handler, { id: 3 });
    await queue.queue;

    assert.deepEqual(order, [1, 2, 3], 'moves should execute in FIFO order');
  });

  test('MoveQueue: error in one move does not break subsequent moves', async () => {
    const queue = new MoveQueue();
    const order = [];

    const handler = (data) => {
      order.push(data.id);
      if (data.id === 2) return Promise.reject(new Error('move 2 failed'));
      return Promise.resolve();
    };

    queue.enqueue(handler, { id: 1 });
    queue.enqueue(handler, { id: 2 }); // this will error
    queue.enqueue(handler, { id: 3 });
    await queue.queue;

    // All 3 should have started (order is [1, 2, 3])
    assert.deepEqual(order, [1, 2, 3]);

    // Check execution log
    const errors = queue.executionLog.filter(e => e.action === 'error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].error, 'move 2 failed');
  });

  test('MoveQueue: concurrent enqueue calls are serialized', async () => {
    const queue = new MoveQueue();
    const executionTimes = [];

    const handler = async (data) => {
      executionTimes.push({ id: data.id, start: Date.now() });
      await new Promise(r => setTimeout(r, 10)); // 10ms simulated work
      executionTimes.push({ id: data.id, end: Date.now() });
    };

    // Enqueue 3 moves simultaneously
    const p1 = queue.enqueue(handler, { id: 1 });
    const p2 = queue.enqueue(handler, { id: 2 });
    const p3 = queue.enqueue(handler, { id: 3 });
    await Promise.all([p1, p2, p3]);

    // Verify sequential execution: move 2 starts after move 1 ends
    const m1End = executionTimes.find(e => e.id === 1 && e.end);
    const m2Start = executionTimes.find(e => e.id === 2 && e.start);
    assert.ok(m2Start.start >= m1End.end, 'move 2 should start after move 1 ends');
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Move Serialization Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
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
