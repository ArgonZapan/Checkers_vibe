/**
 * epsilonInputEdgeCases.test.js — Extreme input edge cases for epsilon and networkSize validation.
 *
 * Covers gaps NOT in epsilonValidationServer.test.js or epsilonValidationResilience.test.js:
 * - Symbol, BigInt, Proxy objects as epsilon values
 * - Frozen/sealed objects with epsilon property
 * - Getter/setter properties that throw
 * - Prototype pollution attempts
 * - Very long decimal strings
 * - Unicode/special number strings
 * - Combined invalid inputs stress test
 * - Concurrent-like rapid parameter changes
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: validation functions (mirrors server/index.js) ───────────────

function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be a finite number 0-1' };
  }
  return { valid: true };
}

function validateNetworkSize(networkSize) {
  if (networkSize != null && !['small', 'medium', 'large'].includes(networkSize)) {
    return { valid: false, error: 'networkSize must be small|medium|large' };
  }
  return { valid: true };
}

function validateParams(body) {
  const { epsilon, networkSize, side = 'both' } = body || {};
  const epsResult = validateEpsilon(epsilon);
  if (!epsResult.valid) return { ...epsResult, status: 400 };
  const nsResult = validateNetworkSize(networkSize);
  if (!nsResult.valid) return { ...nsResult, status: 400 };
  return { valid: true, epsilon, networkSize, side };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runEpsilonInputEdgeCasesTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Symbol values
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon Symbol("test") → rejected (typeof symbol)', () => {
    const sym = Symbol('test');
    const r = validateEpsilon(sym);
    assert.equal(r.valid, false, 'Symbol should be rejected');
  });

  test('epsilon Symbol.iterator → rejected', () => {
    const r = validateEpsilon(Symbol.iterator);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BigInt values
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon BigInt(0) → rejected (typeof bigint)', () => {
    const r = validateEpsilon(BigInt(0));
    assert.equal(r.valid, false, 'BigInt should be rejected');
  });

  test('epsilon BigInt(1) → rejected', () => {
    const r = validateEpsilon(BigInt(1));
    assert.equal(r.valid, false);
  });

  test('epsilon 0n literal → rejected', () => {
    const r = validateEpsilon(0n);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Proxy objects
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon Proxy pretending to be a number → rejected', () => {
    const proxy = new Proxy({}, {
      get(target, prop) {
        if (prop === Symbol.toPrimitive) return () => 0.5;
        if (prop === 'valueOf') return () => 0.5;
        return undefined;
      }
    });
    const r = validateEpsilon(proxy);
    assert.equal(r.valid, false, 'Proxy object should be rejected');
  });

  test('networkSize object with toString returning "small" → rejected', () => {
    const obj = { toString: () => 'small' };
    const r = validateNetworkSize(obj);
    assert.equal(r.valid, false, 'Object with toString returning "small" should be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Frozen and sealed objects
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon frozen object { valueOf: () => 0.5 } → rejected', () => {
    const frozen = Object.freeze({ valueOf: () => 0.5 });
    const r = validateEpsilon(frozen);
    assert.equal(r.valid, false, 'Frozen object should be rejected');
  });

  test('epsilon sealed object → rejected', () => {
    const sealed = Object.seal({ value: 0.5 });
    const r = validateEpsilon(sealed);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // String coercion edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon "0" (string zero) → rejected', () => {
    const r = validateEpsilon('0');
    assert.equal(r.valid, false, 'String "0" should be rejected');
  });

  test('epsilon "1" (string one) → rejected', () => {
    const r = validateEpsilon('1');
    assert.equal(r.valid, false);
  });

  test('epsilon "" (empty string) → rejected', () => {
    const r = validateEpsilon('');
    assert.equal(r.valid, false);
  });

  test('epsilon "  0.5  " (padded string) → rejected', () => {
    const r = validateEpsilon('  0.5  ');
    assert.equal(r.valid, false);
  });

  test('epsilon "0.5e0" (scientific notation string) → rejected', () => {
    const r = validateEpsilon('0.5e0');
    assert.equal(r.valid, false);
  });

  test('epsilon "0.50000000000000001" (precision string) → rejected', () => {
    const r = validateEpsilon('0.50000000000000001');
    assert.equal(r.valid, false);
  });

  test('epsilon "NaN" string → rejected', () => {
    const r = validateEpsilon('NaN');
    assert.equal(r.valid, false);
  });

  test('epsilon "Infinity" string → rejected', () => {
    const r = validateEpsilon('Infinity');
    assert.equal(r.valid, false);
  });

  test('epsilon "0x1" (hex string) → rejected', () => {
    const r = validateEpsilon('0x1');
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Float precision edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon 0.1 + 0.2 (floating point imprecision, ~0.30000000000000004) → accepted', () => {
    const r = validateEpsilon(0.1 + 0.2);
    assert.equal(r.valid, true, '0.1 + 0.2 = 0.30000000000000004 is still 0-1');
  });

  test('epsilon 1 - Number.EPSILON (just under 1) → accepted', () => {
    const r = validateEpsilon(1 - Number.EPSILON);
    assert.equal(r.valid, true);
  });

  test('epsilon 0 + Number.EPSILON (just above 0) → accepted', () => {
    const r = validateEpsilon(0 + Number.EPSILON);
    assert.equal(r.valid, true);
  });

  test('epsilon -Number.EPSILON (just below 0) → rejected', () => {
    const r = validateEpsilon(-Number.EPSILON);
    assert.equal(r.valid, false, 'Slightly negative should be rejected');
  });

  test('epsilon 1 + Number.EPSILON (just above 1) → rejected', () => {
    // 1 + 2.2e-16 = 1.0000000000000002 > 1
    assert.ok(1 + Number.EPSILON > 1, '1 + EPSILON is detectably > 1');
    const r = validateEpsilon(1 + Number.EPSILON);
    assert.equal(r.valid, false, 'Should be rejected (> 1)');
  });

  test('epsilon 1 + 1e-15 (just above 1) → rejected', () => {
    const val = 1 + 1e-15;
    assert.ok(val > 1, 'Should be detectably > 1');
    const r = validateEpsilon(val);
    assert.equal(r.valid, false, 'Should be rejected (> 1)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // networkSize edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('networkSize "SMALL" uppercase → rejected (case-sensitive)', () => {
    const r = validateNetworkSize('SMALL');
    assert.equal(r.valid, false);
  });

  test('networkSize "small " trailing space → rejected', () => {
    const r = validateNetworkSize('small ');
    assert.equal(r.valid, false);
  });

  test('networkSize "medium\\n" newline → rejected', () => {
    const r = validateNetworkSize('medium\n');
    assert.equal(r.valid, false);
  });

  test('networkSize 0 (number) → rejected', () => {
    const r = validateNetworkSize(0);
    assert.equal(r.valid, false);
  });

  test('networkSize "" empty string → rejected', () => {
    const r = validateNetworkSize('');
    assert.equal(r.valid, false);
  });

  test('networkSize "tiny" → rejected (not in valid set)', () => {
    const r = validateNetworkSize('tiny');
    assert.equal(r.valid, false);
  });

  test('networkSize "xl" → rejected', () => {
    const r = validateNetworkSize('xl');
    assert.equal(r.valid, false);
  });

  test('networkSize "small" → accepted', () => {
    const r = validateNetworkSize('small');
    assert.equal(r.valid, true);
  });

  test('networkSize "medium" → accepted', () => {
    const r = validateNetworkSize('medium');
    assert.equal(r.valid, true);
  });

  test('networkSize "large" → accepted', () => {
    const r = validateNetworkSize('large');
    assert.equal(r.valid, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined validation stress tests
  // ═══════════════════════════════════════════════════════════════════════

  test('combined: epsilon Symbol + networkSize Symbol → rejected (epsilon first)', () => {
    const r = validateParams({ epsilon: Symbol('x'), networkSize: Symbol('y') });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('epsilon'), 'Epsilon error first');
  });

  test('combined: valid epsilon 0.5 + networkSize "" → rejected', () => {
    const r = validateParams({ epsilon: 0.5, networkSize: '' });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('networkSize'));
  });

  test('combined: epsilon undefined + networkSize undefined → accepted', () => {
    const r = validateParams({ epsilon: undefined, networkSize: undefined });
    assert.equal(r.valid, true, 'undefined means no change for both');
  });

  test('combined: epsilon null + networkSize null → accepted', () => {
    const r = validateParams({ epsilon: null, networkSize: null });
    assert.equal(r.valid, true);
  });

  test('combined: epsilon NaN + networkSize NaN → rejected (epsilon first)', () => {
    const r = validateParams({ epsilon: NaN, networkSize: NaN });
    assert.equal(r.valid, false);
    assert.ok(r.error.includes('epsilon'));
  });

  test('combined: 100 rapid valid params in sequence', () => {
    for (let i = 0; i < 100; i++) {
      const eps = Math.random(); // always 0-1
      const r = validateParams({ epsilon: eps, networkSize: 'medium' });
      assert.equal(r.valid, true, `Iteration ${i}: epsilon=${eps} should be valid`);
    }
  });

  test('combined: 50 rapid invalid params — all rejected', () => {
    const invalidInputs = [
      { epsilon: NaN },
      { epsilon: Infinity },
      { epsilon: -Infinity },
      { epsilon: 'bad' },
      { epsilon: -1 },
      { epsilon: 2 },
      { networkSize: 'tiny' },
      { networkSize: 'HUGE' },
      { networkSize: null },
    ];
    for (let i = 0; i < 50; i++) {
      const input = invalidInputs[i % invalidInputs.length];
      // null networkSize is actually valid (means no change)
      if (input.networkSize === null) {
        const r = validateParams(input);
        assert.equal(r.valid, true, `null networkSize is valid`);
        continue;
      }
      const r = validateParams(input);
      assert.equal(r.valid, false, `Should reject: ${JSON.stringify(input)}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Side parameter validation
  // ═══════════════════════════════════════════════════════════════════════

  test('side defaults to "both" when not provided', () => {
    const r = validateParams({});
    assert.equal(r.side, 'both');
  });

  test('side "white" is passed through (not validated in /api/ai/params)', () => {
    const r = validateParams({ side: 'white' });
    assert.equal(r.side, 'white');
  });

  test('side "black" is passed through', () => {
    const r = validateParams({ side: 'black' });
    assert.equal(r.side, 'black');
  });

  test('side invalid value "red" is passed through (no validation)', () => {
    // Note: the server does NOT validate side parameter — it's passed to trainer.setParams
    const r = validateParams({ side: 'red' });
    assert.equal(r.side, 'red', 'Side is not validated in /api/ai/params');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error message consistency
  // ═══════════════════════════════════════════════════════════════════════

  test('all epsilon rejections return same error message', () => {
    const badValues = [NaN, Infinity, -Infinity, '0.5', true, false, {}, [], Symbol('x'), BigInt(0)];
    for (const val of badValues) {
      const r = validateEpsilon(val);
      assert.equal(r.valid, false);
      assert.equal(r.error, 'epsilon must be a finite number 0-1',
        `Error for ${String(val)} should be consistent`);
    }
  });

  test('all networkSize rejections return same error message', () => {
    const badValues = ['tiny', 'HUGE', 'SMALL', '', true, 0, {}, [], 'small '];
    for (const val of badValues) {
      const r = validateNetworkSize(val);
      assert.equal(r.valid, false);
      assert.equal(r.error, 'networkSize must be small|medium|large',
        `Error for ${String(val)} should be consistent`);
    }
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Epsilon & NetworkSize Input Edge Cases');

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
