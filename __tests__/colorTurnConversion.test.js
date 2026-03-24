/**
 * colorTurnConversion.test.js — Tests for color-to-turn conversion helpers.
 *
 * Covers: colorToTurn, turnToColor from server/index.js.
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted logic (mirrors server/index.js) ──────────────────────────────

function colorToTurn(color) {
  return color === 'white' ? 1 : -1;
}

function turnToColor(turn) {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return null; // 0 = draw/no turn — don't misleadingly return 'white'
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runColorTurnConversionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // colorToTurn
  // ═══════════════════════════════════════════════════════════════════════

  test('colorToTurn: "white" → 1', () => {
    assert.equal(colorToTurn('white'), 1);
  });

  test('colorToTurn: "black" → -1', () => {
    assert.equal(colorToTurn('black'), -1);
  });

  test('colorToTurn: "" (empty) → -1', () => {
    assert.equal(colorToTurn(''), -1);
  });

  test('colorToTurn: "WHITE" (uppercase) → -1', () => {
    assert.equal(colorToTurn('WHITE'), -1);
  });

  test('colorToTurn: null → -1', () => {
    assert.equal(colorToTurn(null), -1);
  });

  test('colorToTurn: undefined → -1', () => {
    assert.equal(colorToTurn(undefined), -1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // turnToColor
  // ═══════════════════════════════════════════════════════════════════════

  test('turnToColor: 1 → "white"', () => {
    assert.equal(turnToColor(1), 'white');
  });

  test('turnToColor: -1 → "black"', () => {
    assert.equal(turnToColor(-1), 'black');
  });

  test('turnToColor: 0 → null (draw/no turn)', () => {
    assert.equal(turnToColor(0), null);
  });

  test('turnToColor: 2 → null (unknown turn)', () => {
    assert.equal(turnToColor(2), null);
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

  test('turnToColor: null → null (fallback)', () => {
    assert.equal(turnToColor(null), null);
  });

  test('turnToColor: undefined → null (fallback)', () => {
    assert.equal(turnToColor(undefined), null);
  });

  test('turnToColor: NaN → null (fallback)', () => {
    assert.equal(turnToColor(NaN), null);
  });

  test('turnToColor: false → null (fallback)', () => {
    assert.equal(turnToColor(false), null);
  });

  test('turnToColor: "DRAW" passthrough (no normalization)', () => {
    assert.equal(turnToColor('DRAW'), 'DRAW');
  });

  test('turnToColor: "banana" passthrough', () => {
    assert.equal(turnToColor('banana'), 'banana');
  });

  test('turnToColor: empty string "" passthrough', () => {
    assert.equal(turnToColor(''), '');
  });

  test('turnToColor: 2 → null (unknown, only 1 maps to white)', () => {
    assert.equal(turnToColor(2), null);
  });

  test('turnToColor: -2 → null (unknown, only -1 maps to black)', () => {
    assert.equal(turnToColor(-2), null);
  });

  test('turnToColor: 0.5 → null (non-integer)', () => {
    assert.equal(turnToColor(0.5), null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Round-trip consistency
  // ═══════════════════════════════════════════════════════════════════════

  test('round-trip: colorToTurn(turnToColor(1)) === 1', () => {
    assert.equal(colorToTurn(turnToColor(1)), 1);
  });

  test('round-trip: colorToTurn(turnToColor(-1)) === -1', () => {
    assert.equal(colorToTurn(turnToColor(-1)), -1);
  });

  test('round-trip: turnToColor(colorToTurn("white")) === "white"', () => {
    assert.equal(turnToColor(colorToTurn('white')), 'white');
  });

  test('round-trip: turnToColor(colorToTurn("black")) === "black"', () => {
    assert.equal(turnToColor(colorToTurn('black')), 'black');
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Color/Turn Conversion Tests');

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
