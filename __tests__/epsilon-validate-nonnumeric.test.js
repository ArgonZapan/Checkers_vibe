/**
 * epsilon-validate-nonnumeric.test.js — Tests that epsilon validation
 * rejects ALL non-numeric types and unusual input shapes.
 *
 * Builds on epsilonValidationServer.test.js and epsilonInputEdgeCases.test.js
 * with focus on explicit non-numeric type rejection:
 *   - plain objects, arrays, functions, regex, dates, errors
 *   - JSON-deserialized non-numbers (common from HTTP body parsing)
 *   - nested wrappers, boxed types
 *   - null vs undefined distinction
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: epsilon validation (mirrors server/index.js:166) ─────────────

function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be a finite number 0-1' };
  }
  return { valid: true };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runEpsilonValidateNonnumericTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // null & undefined (both accepted — means "no change")
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon null → accepted (means no change)', () => {
    const r = validateEpsilon(null);
    assert.equal(r.valid, true, 'null should be accepted (no-op)');
  });

  test('epsilon undefined → accepted (means no change)', () => {
    const r = validateEpsilon(undefined);
    assert.equal(r.valid, true, 'undefined should be accepted (no-op)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // String types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  const stringCases = [
    ['"0.5"', '0.5'],
    ['"0"', '0'],
    ['"1"', '1'],
    ['empty string', ''],
    ['"  0.5  " (padded)', '  0.5  '],
    ['"NaN"', 'NaN'],
    ['"Infinity"', 'Infinity'],
    ['"-Infinity"', '-Infinity'],
    ['"0x1" (hex)', '0x1'],
    ['"1e-1" (scientific)', '1e-1'],
    ['"true"', 'true'],
    ['"false"', 'false'],
    ['"null"', 'null'],
    ['"undefined"', 'undefined'],
    ['"0.1+0.2"', '0.1+0.2'],
    ['"0xff" (hex literal)', '0xff'],
    ['"0b101" (binary)', '0b101'],
    ['"0o77" (octal)', '0o77'],
    ['unicode "½"', '½'],
    ['emoji "🎲"', '🎲'],
  ];

  for (const [label, val] of stringCases) {
    test(`epsilon ${label} → rejected`, () => {
      const r = validateEpsilon(val);
      assert.equal(r.valid, false, `String ${label} should be rejected`);
      assert.equal(r.error, 'epsilon must be a finite number 0-1');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Boolean types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon true → rejected', () => {
    const r = validateEpsilon(true);
    assert.equal(r.valid, false);
  });

  test('epsilon false → rejected', () => {
    const r = validateEpsilon(false);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Object types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon {} (empty object) → rejected', () => {
    const r = validateEpsilon({});
    assert.equal(r.valid, false);
  });

  test('epsilon { value: 0.5 } → rejected', () => {
    const r = validateEpsilon({ value: 0.5 });
    assert.equal(r.valid, false);
  });

  test('epsilon { epsilon: 0.5 } → rejected', () => {
    const r = validateEpsilon({ epsilon: 0.5 });
    assert.equal(r.valid, false);
  });

  test('epsilon new Number(0.5) (boxed number) → rejected', () => {
    const r = validateEpsilon(new Number(0.5));
    assert.equal(r.valid, false, 'Boxed Number object should be rejected');
  });

  test('epsilon new Number(0) (boxed zero) → rejected', () => {
    const r = validateEpsilon(new Number(0));
    assert.equal(r.valid, false);
  });

  test('epsilon new Number(NaN) (boxed NaN) → rejected', () => {
    const r = validateEpsilon(new Number(NaN));
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Array types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon [] (empty array) → rejected', () => {
    const r = validateEpsilon([]);
    assert.equal(r.valid, false);
  });

  test('epsilon [0.5] (single-element array) → rejected', () => {
    const r = validateEpsilon([0.5]);
    assert.equal(r.valid, false);
  });

  test('epsilon [0] → rejected', () => {
    const r = validateEpsilon([0]);
    assert.equal(r.valid, false);
  });

  test('epsilon [1] → rejected', () => {
    const r = validateEpsilon([1]);
    assert.equal(r.valid, false);
  });

  test('epsilon ["0.5"] (string in array) → rejected', () => {
    const r = validateEpsilon(['0.5']);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Function types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon () => 0.5 (arrow function) → rejected', () => {
    const r = validateEpsilon(() => 0.5);
    assert.equal(r.valid, false);
  });

  test('epsilon function() { return 0.5; } → rejected', () => {
    const r = validateEpsilon(function () { return 0.5; });
    assert.equal(r.valid, false);
  });

  test('epsilon Math.random (built-in function) → rejected', () => {
    const r = validateEpsilon(Math.random);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Other JS types — all rejected
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon Symbol("x") → rejected', () => {
    const r = validateEpsilon(Symbol('x'));
    assert.equal(r.valid, false);
  });

  test('epsilon BigInt(0) → rejected', () => {
    const r = validateEpsilon(BigInt(0));
    assert.equal(r.valid, false);
  });

  test('epsilon BigInt(1) → rejected', () => {
    const r = validateEpsilon(BigInt(1));
    assert.equal(r.valid, false);
  });

  test('epsilon new Date() → rejected', () => {
    const r = validateEpsilon(new Date());
    assert.equal(r.valid, false);
  });

  test('epsilon /regex/ → rejected', () => {
    const r = validateEpsilon(/0\.5/);
    assert.equal(r.valid, false);
  });

  test('epsilon new Error("msg") → rejected', () => {
    const r = validateEpsilon(new Error('bad'));
    assert.equal(r.valid, false);
  });

  test('epsilon new Map() → rejected', () => {
    const r = validateEpsilon(new Map());
    assert.equal(r.valid, false);
  });

  test('epsilon new Set() → rejected', () => {
    const r = validateEpsilon(new Set());
    assert.equal(r.valid, false);
  });

  test('epsilon new WeakMap() → rejected', () => {
    const r = validateEpsilon(new WeakMap());
    assert.equal(r.valid, false);
  });

  test('epsilon Promise.resolve(0.5) → rejected', () => {
    const r = validateEpsilon(Promise.resolve(0.5));
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // HTTP body parsing simulation (JSON.parse produces non-numbers)
  // ═══════════════════════════════════════════════════════════════════════

  test('JSON.parse(\'{"epsilon":"0.5"}\').epsilon → rejected (string from JSON)', () => {
    const body = JSON.parse('{"epsilon":"0.5"}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, false, 'String "0.5" from JSON body should be rejected');
  });

  test('JSON.parse(\'{"epsilon":null}\').epsilon → accepted (null from JSON)', () => {
    const body = JSON.parse('{"epsilon":null}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, true, 'null from JSON body should be accepted');
  });

  test('JSON.parse(\'{"epsilon":0.5}\').epsilon → accepted (valid number)', () => {
    const body = JSON.parse('{"epsilon":0.5}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, true, 'Valid number from JSON body should be accepted');
  });

  test('JSON.parse with missing epsilon key → accepted (undefined)', () => {
    const body = JSON.parse('{"other":"value"}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, true, 'Missing key → undefined → accepted');
  });

  test('JSON.parse(\'{"epsilon":true}\').epsilon → rejected (boolean from JSON)', () => {
    const body = JSON.parse('{"epsilon":true}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, false);
  });

  test('JSON.parse(\'{"epsilon":{}}\').epsilon → rejected (object from JSON)', () => {
    const body = JSON.parse('{"epsilon":{}}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, false);
  });

  test('JSON.parse(\'{"epsilon":[]}\').epsilon → rejected (array from JSON)', () => {
    const body = JSON.parse('{"epsilon":[]}');
    const r = validateEpsilon(body.epsilon);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Number-like edge cases that ARE numbers
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon 0 → accepted', () => {
    const r = validateEpsilon(0);
    assert.equal(r.valid, true);
  });

  test('epsilon 1 → accepted', () => {
    const r = validateEpsilon(1);
    assert.equal(r.valid, true);
  });

  test('epsilon 0.5 → accepted', () => {
    const r = validateEpsilon(0.5);
    assert.equal(r.valid, true);
  });

  test('epsilon -0 → accepted (typeof number, finite, -0 < 0 is false)', () => {
    const r = validateEpsilon(-0);
    assert.equal(r.valid, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error message consistency across all non-numeric types
  // ═══════════════════════════════════════════════════════════════════════

  test('all non-numeric rejections produce identical error message', () => {
    const badInputs = [
      '0.5', true, false, {}, [], () => {}, /x/, new Date(),
      Symbol('x'), BigInt(0), new Number(0.5), new Map(), new Set(),
      Promise.resolve(0), NaN, Infinity, -Infinity, 2, -1,
    ];
    for (const val of badInputs) {
      const r = validateEpsilon(val);
      assert.equal(r.valid, false);
      assert.equal(
        r.error, 'epsilon must be a finite number 0-1',
        `Inconsistent error for ${String(val)}`
      );
    }
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Epsilon Validate Non-Numeric Types Tests');

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
