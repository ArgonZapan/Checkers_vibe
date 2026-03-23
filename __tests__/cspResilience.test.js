/**
 * cspResilience.test.js — Resilience tests for CSP (Content-Security-Policy) header.
 *
 * Covers the CSP header set in server/index.js (line 32):
 *   "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
 *    img-src 'self' data:; font-src 'self'; connect-src 'self' wss:;
 *    frame-ancestors 'none'"
 *
 * Validates security properties of the CSP string.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: CSP header value (mirrors server/index.js:32) ───────────────

const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'";

/**
 * Parse a CSP string into a map of directive → values[].
 */
function parseCSP(cspString) {
  const directives = {};
  for (const part of cspString.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [directive, ...values] = trimmed.split(/\s+/);
    directives[directive] = values;
  }
  return directives;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runCSPResilienceTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // Parse once for all tests
  const parsed = parseCSP(CSP_HEADER);

  // ═══════════════════════════════════════════════════════════════════════
  // CSP parsing
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP string parses correctly into directives', () => {
    assert.ok(parsed['default-src'], 'default-src should exist');
    assert.ok(parsed['script-src'], 'script-src should exist');
    assert.ok(parsed['style-src'], 'style-src should exist');
    assert.ok(parsed['img-src'], 'img-src should exist');
    assert.ok(parsed['font-src'], 'font-src should exist');
    assert.ok(parsed['connect-src'], 'connect-src should exist');
    assert.ok(parsed['frame-ancestors'], 'frame-ancestors should exist');
  });

  test('default-src is set to self', () => {
    assert.ok(parsed['default-src'].includes("'self'"), "default-src should include 'self'");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Security constraints
  // ═══════════════════════════════════════════════════════════════════════

  test('no directive contains unsafe-eval', () => {
    for (const [directive, values] of Object.entries(parsed)) {
      assert.ok(!values.includes("'unsafe-eval'"),
        `${directive} should not contain 'unsafe-eval'`);
    }
  });

  test('script-src does not contain unsafe-inline', () => {
    const scriptSrc = parsed['script-src'] || [];
    assert.ok(!scriptSrc.includes("'unsafe-inline'"),
      "script-src should not contain 'unsafe-inline'");
  });

  test('connect-src allows wss: (production default)', () => {
    const connectSrc = parsed['connect-src'] || [];
    assert.ok(connectSrc.includes('wss:'), "connect-src should include wss:");
    assert.ok(!connectSrc.includes('ws:'), "production CSP should not include bare ws:");
  });

  test('frame-ancestors is set to none', () => {
    const frameAncestors = parsed['frame-ancestors'] || [];
    assert.ok(frameAncestors.includes("'none'"),
      "frame-ancestors should be 'none'");
  });

  test('no wildcard * in any directive', () => {
    for (const [directive, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('*'),
        `${directive} should not contain wildcard *`);
    }
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 CSP Resilience Tests');

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
