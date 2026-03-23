/**
 * cspHeaderContent.test.js — Specific CSP header content validation tests.
 *
 * Focused validation of three critical CSP properties:
 * 1. No 'unsafe-eval' in script-src (prevents eval-based XSS)
 * 2. frame-ancestors 'none' (prevents clickjacking)
 * 3. default-src 'self' (restricts resource origins)
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── CSP from server/index.js ────────────────────────────────────────────────

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'";

/**
 * Parse CSP string into directive map.
 */
function parseCSP(csp) {
  const directives = {};
  for (const part of csp.split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    directives[name] = values;
  }
  return directives;
}

/**
 * Check if a CSP directive contains a value.
 */
function hasCSPDirective(csp, directive, value) {
  const parsed = parseCSP(csp);
  return parsed[directive]?.includes(value) ?? false;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runCspHeaderContentTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // script-src: no unsafe-eval
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: script-src does NOT contain unsafe-eval', () => {
    assert.ok(!hasCSPDirective(CSP, 'script-src', "'unsafe-eval'"),
      "script-src must not contain 'unsafe-eval'");
  });

  test('CSP: no directive at all contains unsafe-eval', () => {
    const parsed = parseCSP(CSP);
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes("'unsafe-eval'"),
        `${dir} should not contain 'unsafe-eval'`);
    }
  });

  test('CSP: script-src has only self — no eval, no inline, no data:', () => {
    const parsed = parseCSP(CSP);
    const scriptSrc = parsed['script-src'] || [];
    assert.deepEqual(scriptSrc, ["'self'"],
      "script-src must be exactly ['self'] with no unsafe-eval or unsafe-inline");
  });

  test('CSP: raw string does not contain unsafe-eval anywhere', () => {
    assert.ok(!CSP.includes('unsafe-eval'),
      'The entire CSP string must not contain the substring "unsafe-eval"');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // frame-ancestors: 'none'
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: frame-ancestors is set to none', () => {
    assert.ok(hasCSPDirective(CSP, 'frame-ancestors', "'none'"),
      "frame-ancestors must contain 'none'");
  });

  test('CSP: frame-ancestors has no other values besides none', () => {
    const parsed = parseCSP(CSP);
    assert.deepEqual(parsed['frame-ancestors'], ["'none'"],
      "frame-ancestors must be exactly ['none']");
  });

  test('CSP: frame-ancestors none blocks all embedding (equivalent to X-Frame-Options DENY)', () => {
    const parsed = parseCSP(CSP);
    const fa = parsed['frame-ancestors'];
    assert.ok(fa.length === 1 && fa[0] === "'none'",
      'frame-ancestors must allow no embedding at all');
    // Equivalent to X-Frame-Options: DENY
    assert.ok(!fa.includes("'self'"), 'frame-ancestors should not include self');
    assert.ok(!fa.includes('*'), 'frame-ancestors should not include wildcard');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // default-src: 'self'
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: default-src contains self', () => {
    assert.ok(hasCSPDirective(CSP, 'default-src', "'self'"),
      "default-src must contain 'self'");
  });

  test('CSP: default-src is self only — no wildcard, no external origins', () => {
    const parsed = parseCSP(CSP);
    assert.deepEqual(parsed['default-src'], ["'self'"],
      "default-src must be exactly ['self'] with no external origins");
  });

  test('CSP: default-src as fallback covers resource types without explicit directive', () => {
    const parsed = parseCSP(CSP);
    // default-src acts as fallback for any resource type not explicitly listed.
    // We verify it is present and set to 'self', which means any missing
    // directive (e.g. media-src, object-src) falls back to 'self' only.
    assert.ok("'self'" in parsed['default-src'].reduce((acc, v) => { acc[v] = true; return acc; }, {}),
      'default-src self ensures unknown resource types are restricted');
    assert.equal(parsed['default-src'].length, 1,
      'default-src has exactly one value');
  });

  test('CSP: default-src directive exists (non-empty)', () => {
    const parsed = parseCSP(CSP);
    assert.ok('default-src' in parsed, 'default-src directive must exist');
    assert.ok(parsed['default-src'].length > 0, 'default-src must have at least one value');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Combined: all three properties together
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: all three critical properties hold simultaneously', () => {
    const noEval = !hasCSPDirective(CSP, 'script-src', "'unsafe-eval'");
    const frameNone = hasCSPDirective(CSP, 'frame-ancestors', "'none'");
    const defaultSelf = hasCSPDirective(CSP, 'default-src', "'self'");

    assert.ok(noEval, 'Must not have unsafe-eval in script-src');
    assert.ok(frameNone, 'Must have frame-ancestors none');
    assert.ok(defaultSelf, 'Must have default-src self');
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 CSP Header Content Tests');

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
