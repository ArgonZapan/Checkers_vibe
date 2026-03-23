/**
 * epsilonValidationResilience.test.js — Resilience edge cases for epsilon validation.
 *
 * Covers the epsilon validation logic in server/index.js (line 164):
 *   if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1))
 * Tests special numeric values (NaN, Infinity, -Infinity), boundary values,
 * and type coercion edge cases.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: epsilon validation logic (mirrors server/index.js:164) ──────

/**
 * Validate epsilon value.
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be 0-1' };
  }
  return { valid: true };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runEpsilonValidationResilienceTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Special numeric values — resilience edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon NaN → rejected (typeof NaN === "number" but !Number.isFinite catches it)', () => {
    // NaN is typeof "number" but Number.isFinite(NaN) === false
    const result = validateEpsilon(NaN);
    assert.equal(result.valid, false, 'NaN must be rejected by Number.isFinite check');
  });

  test('epsilon Infinity → rejected', () => {
    // typeof Infinity === 'number' and Infinity > 1 → true
    const result = validateEpsilon(Infinity);
    assert.equal(result.valid, false);
  });

  test('epsilon -Infinity → rejected', () => {
    // typeof -Infinity === 'number' and -Infinity < 0 → true
    const result = validateEpsilon(-Infinity);
    assert.equal(result.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Boundary values — valid range [0, 1]
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon 0 → accepted', () => {
    const result = validateEpsilon(0);
    assert.equal(result.valid, true);
  });

  test('epsilon 0.5 → accepted', () => {
    const result = validateEpsilon(0.5);
    assert.equal(result.valid, true);
  });

  test('epsilon 1 → accepted', () => {
    const result = validateEpsilon(1);
    assert.equal(result.valid, true);
  });

  test('epsilon -0.01 → rejected', () => {
    const result = validateEpsilon(-0.01);
    assert.equal(result.valid, false);
  });

  test('epsilon 1.01 → rejected', () => {
    const result = validateEpsilon(1.01);
    assert.equal(result.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Type coercion edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon as string "0.5" → rejected (typeof !== "number")', () => {
    const result = validateEpsilon('0.5');
    assert.equal(result.valid, false);
  });

  test('epsilon as null → accepted (null != null is false, skip check)', () => {
    const result = validateEpsilon(null);
    assert.equal(result.valid, true);
  });

  test('epsilon as undefined → accepted (undefined != null is false, skip check)', () => {
    const result = validateEpsilon(undefined);
    assert.equal(result.valid, true);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Epsilon Validation Resilience Tests');

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
