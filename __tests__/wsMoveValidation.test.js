/**
 * wsMoveValidation.test.js — Tests for WebSocket "move" handler validation.
 *
 * Tests the validation logic extracted from server/index.js socket.on('move').
 * The exact validation code in index.js:
 *
 *   const isValidCoord = (c) =>
 *     Array.isArray(c) && c.length === 2 && Number.isInteger(c[0]) && Number.isInteger(c[1])
 *     && c[0] >= 0 && c[0] <= 7 && c[1] >= 0 && c[1] <= 7;
 */
import assert from 'node:assert/strict';
import { isValidCoord, validateMove } from './wsValidation.js';

export async function runWsMoveValidationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Valid coordinates ──────────────────────────────────────────────

  test('valid coord: [0, 0]', () => {
    assert.ok(isValidCoord([0, 0]));
  });

  test('valid coord: [7, 7]', () => {
    assert.ok(isValidCoord([7, 7]));
  });

  test('valid coord: [3, 5]', () => {
    assert.ok(isValidCoord([3, 5]));
  });

  // ── undefined from/to ─────────────────────────────────────────────

  test('reject undefined from', () => {
    const result = validateMove({ from: undefined, to: [3, 3] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('from'));
  });

  test('reject undefined to', () => {
    const result = validateMove({ from: [2, 2], to: undefined });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('to'));
  });

  test('reject undefined data', () => {
    const result = validateMove(undefined);
    assert.equal(result.valid, false);
  });

  // ── null values ───────────────────────────────────────────────────

  test('reject null from', () => {
    const result = validateMove({ from: null, to: [3, 3] });
    assert.equal(result.valid, false);
  });

  test('reject null to', () => {
    const result = validateMove({ from: [2, 2], to: null });
    assert.equal(result.valid, false);
  });

  test('reject null data', () => {
    const result = validateMove(null);
    assert.equal(result.valid, false);
  });

  // ── Out-of-range coordinates ──────────────────────────────────────

  test('reject from: [-1, 0]', () => {
    assert.equal(isValidCoord([-1, 0]), false);
  });

  test('reject from: [0, -1]', () => {
    assert.equal(isValidCoord([0, -1]), false);
  });

  test('reject from: [8, 0]', () => {
    assert.equal(isValidCoord([8, 0]), false);
  });

  test('reject from: [0, 8]', () => {
    assert.equal(isValidCoord([0, 8]), false);
  });

  test('reject from: [100, 100]', () => {
    assert.equal(isValidCoord([100, 100]), false);
  });

  test('reject to: [-1, 5]', () => {
    const result = validateMove({ from: [2, 2], to: [-1, 5] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('to'));
  });

  test('reject to: [8, 3]', () => {
    const result = validateMove({ from: [2, 2], to: [8, 3] });
    assert.equal(result.valid, false);
  });

  // ── String instead of number ──────────────────────────────────────

  test('reject string coord: ["0", "0"]', () => {
    assert.equal(isValidCoord(['0', '0']), false);
  });

  test('reject string coord: ["a", 3]', () => {
    assert.equal(isValidCoord(['a', 3]), false);
  });

  test('reject string coord: [3, "b"]', () => {
    assert.equal(isValidCoord([3, 'b']), false);
  });

  test('reject non-array: "hello"', () => {
    assert.equal(isValidCoord('hello'), false);
  });

  test('reject non-array: 5', () => {
    assert.equal(isValidCoord(5), false);
  });

  // ── Wrong array length ────────────────────────────────────────────

  test('reject coord with 1 element', () => {
    assert.equal(isValidCoord([3]), false);
  });

  test('reject coord with 3 elements', () => {
    assert.equal(isValidCoord([3, 3, 3]), false);
  });

  test('reject empty array', () => {
    assert.equal(isValidCoord([]), false);
  });

  // ── Missing captures field ────────────────────────────────────────

  test('accept missing captures (captures undefined)', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3] });
    assert.equal(result.valid, true);
  });

  test('accept captures = null', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3], captures: null });
    assert.equal(result.valid, true);
  });

  test('accept captures as array', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3, 3]] });
    assert.equal(result.valid, true);
  });

  test('accept empty captures array', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3], captures: [] });
    assert.equal(result.valid, true);
  });

  test('reject captures as string', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3], captures: 'not-array' });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('captures'));
  });

  test('reject captures as number', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3], captures: 42 });
    assert.equal(result.valid, false);
  });

  test('reject captures as object', () => {
    const result = validateMove({ from: [2, 2], to: [3, 3], captures: { row: 3, col: 3 } });
    assert.equal(result.valid, false);
  });

  // ── Captures element validation (LEAK-010) ────────────────────────

  test('accept captures with valid coord: [[3, 3]]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3, 3]] });
    assert.equal(result.valid, true);
  });

  test('accept captures with multiple valid coords: [[3, 3], [5, 5]]', () => {
    const result = validateMove({ from: [2, 2], to: [6, 6], captures: [[3, 3], [5, 5]] });
    assert.equal(result.valid, true);
  });

  test('reject capture with out-of-range coord: [[8, 3]]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[8, 3]] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 0'));
  });

  test('reject capture with negative coord: [[-1, 3]]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[-1, 3]] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 0'));
  });

  test('reject capture with string element: ["not-coord"]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: ['not-coord'] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 0'));
  });

  test('reject capture with number element: [42]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [42] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 0'));
  });

  test('reject second capture with invalid coord: [[3,3], [9,0]]', () => {
    const result = validateMove({ from: [2, 2], to: [6, 6], captures: [[3, 3], [9, 0]] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 1'));
  });

  test('reject capture with single-element array: [[3]]', () => {
    const result = validateMove({ from: [2, 2], to: [4, 4], captures: [[3]] });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('capture at index 0'));
  });

  // ── Edge: floating point coords ───────────────────────────────────

  test('reject float coord: [3.5, 2]', () => {
    assert.equal(isValidCoord([3.5, 2]), false);
  });

  test('reject float coord: [2, 3.1]', () => {
    assert.equal(isValidCoord([2, 3.1]), false);
  });

  test('reject NaN coord: [NaN, 3]', () => {
    assert.equal(isValidCoord([NaN, 3]), false);
  });

  test('reject Infinity coord: [Infinity, 3]', () => {
    assert.equal(isValidCoord([Infinity, 3]), false);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 WebSocket Move Validation Tests');

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
