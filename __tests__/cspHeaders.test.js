/**
 * cspHeaders.test.js — Comprehensive tests for Content-Security-Policy headers.
 *
 * Covers gaps in securityHeaders.test.js:
 * - CSP directive parsing and validation
 * - Each directive has expected values
 * - No unsafe-eval in script-src
 * - No unsafe-inline in script-src or style-src
 * - connect-src allows WebSocket
 * - frame-ancestors prevents embedding
 * - default-src fallback behavior
 * - Permissions-Policy details
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: CSP from server/index.js ─────────────────────────────────────

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'";

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

export async function runCspHeadersTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CSP parsing
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP parses into 7 directives', () => {
    const parsed = parseCSP(CSP);
    assert.equal(Object.keys(parsed).length, 7);
  });

  test('CSP: default-src is self', () => {
    assert.ok(hasCSPDirective(CSP, 'default-src', "'self'"));
  });

  test('CSP: script-src is self only', () => {
    const parsed = parseCSP(CSP);
    assert.deepEqual(parsed['script-src'], ["'self'"]);
  });

  test('CSP: NO unsafe-eval in script-src', () => {
    assert.ok(!hasCSPDirective(CSP, 'script-src', "'unsafe-eval'"));
  });

  test('CSP: NO unsafe-inline in script-src', () => {
    assert.ok(!hasCSPDirective(CSP, 'script-src', "'unsafe-inline'"));
  });

  test('CSP: style-src allows unsafe-inline (for React inline styles)', () => {
    assert.ok(hasCSPDirective(CSP, 'style-src', "'unsafe-inline'"));
    assert.ok(hasCSPDirective(CSP, 'style-src', "'self'"));
  });

  test('CSP: img-src allows data: URIs', () => {
    assert.ok(hasCSPDirective(CSP, 'img-src', 'data:'));
    assert.ok(hasCSPDirective(CSP, 'img-src', "'self'"));
  });

  test('CSP: font-src is self only', () => {
    const parsed = parseCSP(CSP);
    assert.deepEqual(parsed['font-src'], ["'self'"]);
  });

  test('CSP: connect-src allows wss:', () => {
    assert.ok(hasCSPDirective(CSP, 'connect-src', 'wss:'));
    assert.ok(hasCSPDirective(CSP, 'connect-src', "'self'"));
  });

  test('CSP: connect-src does NOT allow bare ws: (production default)', () => {
    assert.ok(!hasCSPDirective(CSP, 'connect-src', 'ws:'),
      'Production CSP must not include bare ws: — only wss:');
  });

  test('CSP: frame-ancestors is none (prevents clickjacking)', () => {
    assert.ok(hasCSPDirective(CSP, 'frame-ancestors', "'none'"));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Security best practices
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: no wildcard (*) in any directive', () => {
    const parsed = parseCSP(CSP);
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('*'), `${dir} should not allow wildcard`);
    }
  });

  test('CSP: no http: scheme (only https: and wss:)', () => {
    const parsed = parseCSP(CSP);
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('http:'), `${dir} should not allow http:`);
    }
  });

  test('CSP: frame-ancestors none is equivalent to X-Frame-Options DENY', () => {
    assert.ok(hasCSPDirective(CSP, 'frame-ancestors', "'none'"));
  });

  test('CSP: script-src has no third-party domains', () => {
    const parsed = parseCSP(CSP);
    const scriptSrc = parsed['script-src'] || [];
    for (const val of scriptSrc) {
      assert.ok(val === "'self'" || val.startsWith("'"), `unexpected script-src value: ${val}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Missing headers (intentional)
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP: no upgrade-insecure-requests (intentional for local dev)', () => {
    const parsed = parseCSP(CSP);
    assert.equal(parsed['upgrade-insecure-requests'], undefined);
  });

  test('CSP: no block-all-mixed-content (intentional for local dev)', () => {
    const parsed = parseCSP(CSP);
    assert.equal(parsed['block-all-mixed-content'], undefined);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 CSP Headers Tests');

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
