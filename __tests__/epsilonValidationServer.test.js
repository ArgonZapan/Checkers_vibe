/**
 * epsilonValidationServer.test.js — Additional epsilon validation tests
 * covering gaps in epsilonValidationResilience.test.js and apiEndpointValidation.test.js.
 *
 * Covers:
 * - -0 edge case (Number.isFinite(-0) === true, -0 < 0 === false)
 * - Server code reads actual validation logic from server/index.js
 * - Error message format consistency
 * - Combined epsilon + networkSize validation
 * - networkSize type validation gaps
 * - side parameter (unvalidated in /api/ai/params)
 *
 * Extracted logic + source analysis — no server required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server', 'index.js');

let serverSource;
try {
  serverSource = readFileSync(serverPath, 'utf-8');
} catch {
  serverSource = '';
}

// ── Extracted: epsilon validation (EXACT mirror of server/index.js:166) ────

function validateEpsilon(epsilon) {
  if (epsilon != null && (typeof epsilon !== 'number' || !Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1)) {
    return { valid: false, error: 'epsilon must be a finite number 0-1' };
  }
  return { valid: true };
}

// ── Extracted: networkSize validation ───────────────────────────────────────

function validateNetworkSize(networkSize) {
  if (networkSize != null && !['small', 'medium', 'large'].includes(networkSize)) {
    return { valid: false, error: 'networkSize must be small|medium|large' };
  }
  return { valid: true };
}

// ── Extracted: combined params validation ───────────────────────────────────

function validateParams(body) {
  const { epsilon, networkSize, side = 'both' } = body || {};
  const epsResult = validateEpsilon(epsilon);
  if (!epsResult.valid) return { ...epsResult, status: 400 };
  const nsResult = validateNetworkSize(networkSize);
  if (!nsResult.valid) return { ...nsResult, status: 400 };
  return { valid: true, epsilon, networkSize, side };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runEpsilonValidationServerTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // -0 edge case (JavaScript quirk)
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon -0 is accepted (Number.isFinite(-0) is true, -0 < 0 is false)', () => {
    // -0 passes all checks:
    //   typeof -0 === 'number' ✓
    //   Number.isFinite(-0) ✓ (true!)
    //   -0 < 0 → false (JavaScript quirk: -0 is not less than 0)
    //   -0 > 1 → false
    const r = validateEpsilon(-0);
    assert.equal(r.valid, true, '-0 should be accepted (passes all checks)');
  });

  test('epsilon -0 === 0 (Object.is exception)', () => {
    // -0 and 0 are functionally equivalent for epsilon purposes
    assert.equal(-0 === 0, true, '-0 === 0 in JavaScript');
    assert.equal(Object.is(-0, 0), false, 'Object.is(-0, 0) is false (but irrelevant)');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Very small and very large finite numbers
  // ═══════════════════════════════════════════════════════════════════════

  test('epsilon Number.MIN_VALUE (5e-324) → accepted (within 0-1)', () => {
    const r = validateEpsilon(Number.MIN_VALUE);
    assert.equal(r.valid, true, 'MIN_VALUE is > 0 and < 1');
  });

  test('epsilon Number.EPSILON (2.2e-16) → accepted', () => {
    const r = validateEpsilon(Number.EPSILON);
    assert.equal(r.valid, true);
  });

  test('epsilon Number.MAX_VALUE → rejected (> 1)', () => {
    const r = validateEpsilon(Number.MAX_VALUE);
    assert.equal(r.valid, false, 'MAX_VALUE is way above 1');
  });

  test('epsilon Number.MAX_SAFE_INTEGER → rejected', () => {
    const r = validateEpsilon(Number.MAX_SAFE_INTEGER);
    assert.equal(r.valid, false);
  });

  test('epsilon Number.MIN_SAFE_INTEGER → rejected (< 0)', () => {
    const r = validateEpsilon(Number.MIN_SAFE_INTEGER);
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Error message format
  // ═══════════════════════════════════════════════════════════════════════

  test('error message matches server format exactly', () => {
    const r = validateEpsilon(NaN);
    assert.equal(r.error, 'epsilon must be a finite number 0-1');
  });

  test('error message is consistent for all invalid values', () => {
    const invalidValues = [NaN, Infinity, -Infinity, 2, -1, '0.5', true];
    for (const val of invalidValues) {
      const r = validateEpsilon(val);
      assert.equal(r.valid, false);
      assert.equal(r.error, 'epsilon must be a finite number 0-1',
        `Error message should be consistent for epsilon=${String(val)}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // networkSize type validation gaps
  // ═══════════════════════════════════════════════════════════════════════

  test('networkSize as boolean true → rejected', () => {
    const r = validateNetworkSize(true);
    assert.equal(r.valid, false);
  });

  test('networkSize as empty string → rejected', () => {
    const r = validateNetworkSize('');
    assert.equal(r.valid, false);
  });

  test('networkSize as array ["small"] → rejected', () => {
    const r = validateNetworkSize(['small']);
    assert.equal(r.valid, false);
  });

  test('networkSize as object { size: "small" } → rejected', () => {
    const r = validateNetworkSize({ size: 'small' });
    assert.equal(r.valid, false);
  });

  test('networkSize "SMALL" (uppercase) → rejected', () => {
    const r = validateNetworkSize('SMALL');
    assert.equal(r.valid, false);
  });

  test('networkSize "Small" (title case) → rejected', () => {
    const r = validateNetworkSize('Small');
    assert.equal(r.valid, false);
  });

  test('networkSize " small" (leading space) → rejected', () => {
    const r = validateNetworkSize(' small');
    assert.equal(r.valid, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined validation: epsilon + networkSize
  // ═══════════════════════════════════════════════════════════════════════

  test('combined: valid epsilon + invalid networkSize → rejected', () => {
    const r = validateParams({ epsilon: 0.5, networkSize: 'tiny' });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
    assert.ok(r.error.includes('networkSize'));
  });

  test('combined: invalid epsilon + valid networkSize → rejected', () => {
    const r = validateParams({ epsilon: NaN, networkSize: 'medium' });
    assert.equal(r.valid, false);
    assert.equal(r.status, 400);
    assert.ok(r.error.includes('epsilon'));
  });

  test('combined: invalid epsilon + invalid networkSize → epsilon checked first', () => {
    const r = validateParams({ epsilon: NaN, networkSize: 'tiny' });
    assert.equal(r.valid, false);
    // Epsilon validation runs first (order-dependent)
    assert.ok(r.error.includes('epsilon'), 'Epsilon error should be reported first');
  });

  test('combined: all null → accepted (no changes)', () => {
    const r = validateParams({ epsilon: null, networkSize: null });
    assert.equal(r.valid, true);
  });

  test('combined: empty body → accepted with defaults', () => {
    const r = validateParams({});
    assert.equal(r.valid, true);
    assert.equal(r.side, 'both');
  });

  test('combined: null body → accepted with defaults', () => {
    const r = validateParams(null);
    assert.equal(r.valid, true);
    assert.equal(r.side, 'both');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Server code validation: actual validation logic matches
  // ═══════════════════════════════════════════════════════════════════════

  test('server code: epsilon validation uses Number.isFinite', () => {
    assert.ok(
      serverSource.includes('Number.isFinite(epsilon)'),
      'Server should use Number.isFinite for epsilon validation'
    );
  });

  test('server code: epsilon validation uses != null (loose)', () => {
    assert.ok(
      serverSource.includes('epsilon != null'),
      'Server should use loose != null to catch both null and undefined'
    );
  });

  test('server code: error message mentions "finite number 0-1"', () => {
    assert.ok(
      serverSource.includes('epsilon must be a finite number 0-1'),
      'Error message should match expected format'
    );
  });

  test('server code: networkSize validation uses .includes()', () => {
    const paramsSection = serverSource.slice(
      serverSource.indexOf('/api/ai/params'),
      serverSource.indexOf('/api/ai/params') + 1000
    );
    assert.ok(
      paramsSection.includes('.includes(networkSize)'),
      'networkSize validation should use array includes'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Response format
  // ═══════════════════════════════════════════════════════════════════════

  test('error response includes status 400', () => {
    const r = validateParams({ epsilon: -1 });
    assert.equal(r.status, 400);
  });

  test('error response has error string', () => {
    const r = validateParams({ epsilon: 'bad' });
    assert.equal(typeof r.error, 'string');
    assert.ok(r.error.length > 0);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 Epsilon Validation (Server-Side) Tests');

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
