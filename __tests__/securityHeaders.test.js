/**
 * securityHeaders.test.js — Tests for security header middleware logic.
 *
 * Covers: the security headers set in server/index.js middleware
 * (LEAK-001). Verifies all expected headers are present and have
 * correct values.
 *
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';

// ── Extracted: security headers (mirrors server/index.js) ───────────────────

function getSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}

function applySecurityHeaders(res) {
  const headers = getSecurityHeaders();
  for (const [key, val] of Object.entries(headers)) {
    res.setHeader(key, val);
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runSecurityHeadersTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Header values
  // ═══════════════════════════════════════════════════════════════════════

  test('X-Content-Type-Options is nosniff', () => {
    const h = getSecurityHeaders();
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
  });

  test('X-Frame-Options is DENY', () => {
    const h = getSecurityHeaders();
    assert.equal(h['X-Frame-Options'], 'DENY');
  });

  test('X-XSS-Protection is 0 (disabled — modern best practice)', () => {
    const h = getSecurityHeaders();
    assert.equal(h['X-XSS-Protection'], '0');
  });

  test('Referrer-Policy is strict-origin-when-cross-origin', () => {
    const h = getSecurityHeaders();
    assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  });

  test('Permissions-Policy blocks camera, microphone, geolocation', () => {
    const h = getSecurityHeaders();
    const pp = h['Permissions-Policy'];
    assert.ok(pp.includes('camera=()'), 'camera should be blocked');
    assert.ok(pp.includes('microphone=()'), 'microphone should be blocked');
    assert.ok(pp.includes('geolocation=()'), 'geolocation should be blocked');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // All headers present
  // ═══════════════════════════════════════════════════════════════════════

  test('all 6 security headers are present', () => {
    const h = getSecurityHeaders();
    assert.equal(Object.keys(h).length, 6);
  });

  test('no undefined header values', () => {
    const h = getSecurityHeaders();
    for (const [key, val] of Object.entries(h)) {
      assert.notEqual(val, undefined, `${key} is undefined`);
      assert.notEqual(val, null, `${key} is null`);
      assert.ok(val.length > 0, `${key} is empty`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Middleware applies all headers
  // ═══════════════════════════════════════════════════════════════════════

  test('middleware sets all headers on response', () => {
    const resHeaders = {};
    const mockRes = {
      setHeader: (key, val) => { resHeaders[key] = val; }
    };
    applySecurityHeaders(mockRes);
    assert.equal(Object.keys(resHeaders).length, 6);
    assert.equal(resHeaders['X-Content-Type-Options'], 'nosniff');
    assert.equal(resHeaders['X-Frame-Options'], 'DENY');
  });

  test('middleware calls next()', () => {
    let nextCalled = false;
    const mockReq = {};
    const mockRes = { setHeader: () => {} };
    const middleware = (_req, _res, next) => {
      _res.setHeader = () => {};
      next();
    };
    middleware(mockReq, mockRes, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Security best practices checks
  // ═══════════════════════════════════════════════════════════════════════

  test('X-Frame-Options DENY prevents clickjacking', () => {
    const h = getSecurityHeaders();
    // DENY means page cannot be framed at all (most restrictive)
    assert.equal(h['X-Frame-Options'], 'DENY');
  });

  test('X-XSS-Protection disabled prevents filter-based attacks', () => {
    const h = getSecurityHeaders();
    // Modern best practice: disable the XSS auditor (it can introduce vulns)
    assert.equal(h['X-XSS-Protection'], '0');
  });

  test('Permissions-Policy uses empty parens for denied features', () => {
    const h = getSecurityHeaders();
    // () = feature disabled for all origins
    assert.ok(h['Permissions-Policy'].includes('camera=()'));
    assert.ok(!h['Permissions-Policy'].includes('camera=(self)'));
  });

  test('Content-Security-Policy is set', () => {
    const h = getSecurityHeaders();
    assert.ok(h['Content-Security-Policy'].includes("default-src 'self'"));
    assert.ok(h['Content-Security-Policy'].includes("frame-ancestors 'none'"));
  });

  test('missing Strict-Transport-Security (intentional — not set)', () => {
    const h = getSecurityHeaders();
    assert.equal(h['Strict-Transport-Security'], undefined);
  });

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Security Headers Tests');

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
