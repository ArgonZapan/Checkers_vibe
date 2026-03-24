/**
 * hunter-alpha-turn-throttle.test.js — Boundary tests for color/turn conversion and wsThrottle.
 *
 * Gaps identified:
 * - turnToColor with 0 (draw), null, undefined, NaN, 'draw' string
 * - colorToTurn with invalid strings, empty string, null
 * - wsThrottle: rapid sequential calls, different keys, reset after interval
 * - wsThrottle: socket without _throttle property (first call)
 */
import assert from 'node:assert/strict';

// ── Inline color/turn helpers (from server/index.js) ─────────────────

const colorToTurn = (color) => color === 'white' ? 1 : -1;
const turnToColor = (turn) => {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return null; // 0 = draw/no turn — don't misleadingly return 'white'
};

// ── Inline wsThrottle (from server/index.js) ─────────────────────────

function wsThrottle(socket, key, minIntervalMs) {
  const now = Date.now();
  const last = socket._throttle?.[key] || 0;
  if (now - last < minIntervalMs) return false;
  if (!socket._throttle) socket._throttle = {};
  socket._throttle[key] = now;
  return true;
}

export async function runHunterAlphaTurnThrottleTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── colorToTurn ────────────────────────────────────────────────────

  test('colorToTurn: "white" → 1', () => {
    assert.equal(colorToTurn('white'), 1);
  });

  test('colorToTurn: "black" → -1', () => {
    assert.equal(colorToTurn('black'), -1);
  });

  test('colorToTurn: empty string → -1 (not "white")', () => {
    assert.equal(colorToTurn(''), -1);
  });

  test('colorToTurn: "White" (capitalized) → -1', () => {
    assert.equal(colorToTurn('White'), -1);
  });

  test('colorToTurn: "draw" → -1', () => {
    assert.equal(colorToTurn('draw'), -1);
  });

  test('colorToTurn: null → -1', () => {
    assert.equal(colorToTurn(null), -1);
  });

  test('colorToTurn: undefined → -1', () => {
    assert.equal(colorToTurn(undefined), -1);
  });

  // ── turnToColor ────────────────────────────────────────────────────

  test('turnToColor: 1 → "white"', () => {
    assert.equal(turnToColor(1), 'white');
  });

  test('turnToColor: -1 → "black"', () => {
    assert.equal(turnToColor(-1), 'black');
  });

  test('turnToColor: 0 → null (draw — no misleading "white")', () => {
    assert.equal(turnToColor(0), null);
  });

  test('turnToColor: 2 → null (unknown turn)', () => {
    assert.equal(turnToColor(2), null);
  });

  test('turnToColor: -999 → null (unknown turn)', () => {
    assert.equal(turnToColor(-999), null);
  });

  test('turnToColor: "white" string passthrough', () => {
    assert.equal(turnToColor('white'), 'white');
  });

  test('turnToColor: "black" string passthrough', () => {
    assert.equal(turnToColor('black'), 'black');
  });

  test('turnToColor: "draw" string passthrough', () => {
    assert.equal(turnToColor('draw'), 'draw');
  });

  test('turnToColor: arbitrary string passthrough', () => {
    assert.equal(turnToColor('whatever'), 'whatever');
  });

  test('turnToColor: null → null (not a valid turn)', () => {
    assert.equal(turnToColor(null), null);
  });

  test('turnToColor: NaN → null (NaN is not 1 or -1)', () => {
    assert.equal(turnToColor(NaN), null);
  });

  // ── wsThrottle ─────────────────────────────────────────────────────

  test('wsThrottle: first call on fresh socket is allowed', () => {
    const socket = {};
    assert.equal(wsThrottle(socket, 'move', 100), true);
  });

  test('wsThrottle: immediate second call is blocked', () => {
    const socket = {};
    wsThrottle(socket, 'move', 100);
    assert.equal(wsThrottle(socket, 'move', 100), false);
  });

  test('wsThrottle: different keys are independent', () => {
    const socket = {};
    wsThrottle(socket, 'move', 100);
    assert.equal(wsThrottle(socket, 'setParams', 100), true);
  });

  test('wsThrottle: same key with different interval', () => {
    const socket = {};
    wsThrottle(socket, 'move', 1000);
    // _throttle is set
    assert.ok(socket._throttle);
    assert.ok(socket._throttle['move'] > 0);
  });

  test('wsThrottle: creates _throttle property on first call', () => {
    const socket = {};
    assert.equal(socket._throttle, undefined);
    wsThrottle(socket, 'test', 100);
    assert.ok(socket._throttle);
  });

  test('wsThrottle: socket with existing _throttle works', () => {
    const socket = { _throttle: { move: Date.now() - 200 } };
    assert.equal(wsThrottle(socket, 'move', 100), true);
  });

  test('wsThrottle: socket with existing _throttle for different key works', () => {
    const socket = { _throttle: { move: Date.now() } };
    assert.equal(wsThrottle(socket, 'setParams', 100), true);
  });

  test('wsThrottle: minIntervalMs=0 always allows', () => {
    const socket = {};
    wsThrottle(socket, 'move', 0);
    assert.equal(wsThrottle(socket, 'move', 0), true);
  });

  test('wsThrottle: _throttle?.[key] returning 0 treats as first call', () => {
    const socket = { _throttle: { move: 0 } };
    assert.equal(wsThrottle(socket, 'move', 100), true);
  });

  test('wsThrottle: preserves other throttle keys', () => {
    const socket = {};
    wsThrottle(socket, 'move', 100);
    wsThrottle(socket, 'setParams', 100);
    assert.ok(socket._throttle['move']);
    assert.ok(socket._throttle['setParams']);
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Turn/Throttle Boundary');

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
