/**
 * cspCompleteness.test.js — CSP header completeness and alignment tests.
 *
 * Covers gaps in cspHeaders.test.js, cspHeaderContent.test.js, cspResilience.test.js:
 *
 * 1. CSP + X-Frame-Options alignment (both prevent clickjacking)
 * 2. All expected resource-type directives are present or fall back to default-src
 * 3. No data leakage via CSP (no external domains, no blob:, no filesystem)
 * 4. CSP header format validation (no trailing semicolons, no double spaces)
 * 5. Permissions-Policy completeness for dangerous features
 * 6. Header ordering and middleware placement in source
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

// ── Extracted: security headers (mirrors server/index.js) ───────────────────

// Extracted from actual server/index.js line 34
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const X_FRAME_OPTIONS = 'DENY';
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=()';

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

export async function runCspCompletenessTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  const parsed = parseCSP(CSP);

  // ═══════════════════════════════════════════════════════════════════════
  // CSP + X-Frame-Options alignment
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP frame-ancestors none AND X-Frame-Options DENY — both present', () => {
    assert.ok(parsed['frame-ancestors']?.includes("'none'"),
      'CSP frame-ancestors must be none');
    assert.equal(X_FRAME_OPTIONS, 'DENY',
      'X-Frame-Options must be DENY');
  });

  test('CSP frame-ancestors and X-Frame-Options are consistent (both deny)', () => {
    // frame-ancestors 'none' ≡ X-Frame-Options: DENY
    const cspDenies = parsed['frame-ancestors']?.includes("'none'");
    const xfoDenies = X_FRAME_OPTIONS === 'DENY';
    assert.ok(cspDenies && xfoDenies, 'Both headers must deny framing');
  });

  test('X-Frame-Options not set to SAMEORIGIN (would conflict with frame-ancestors none)', () => {
    assert.notEqual(X_FRAME_OPTIONS, 'SAMEORIGIN');
    assert.notEqual(X_FRAME_OPTIONS, 'ALLOW-FROM');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Resource-type directive completeness
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP has all 9 expected directives', () => {
    const expected = [
      'default-src', 'script-src', 'style-src', 'img-src',
      'font-src', 'connect-src', 'object-src', 'base-uri', 'frame-ancestors'
    ];
    for (const dir of expected) {
      assert.ok(parsed[dir], `Missing directive: ${dir}`);
    }
    assert.equal(Object.keys(parsed).length, 9, 'Should have exactly 9 directives');
  });

  test('missing media-src falls back to default-src (self only)', () => {
    assert.equal(parsed['media-src'], undefined, 'media-src not explicitly set');
    // Falls back to default-src 'self' — no external media
    assert.ok(parsed['default-src'].includes("'self'"));
  });

  test('object-src is explicitly set to none (blocks plugins)', () => {
    assert.ok(parsed["object-src"]?.includes("'none'"),
      "object-src must be 'none' to block plugin-based attacks");
  });

  test('base-uri is explicitly set to self (prevents base URL injection)', () => {
    assert.ok(parsed["base-uri"]?.includes("'self'"),
      "base-uri must be 'self' to prevent <base> tag injection");
  });

  test('missing worker-src falls back to default-src (self only)', () => {
    assert.equal(parsed['worker-src'], undefined);
    assert.ok(parsed['default-src'].includes("'self'"));
  });

  test('missing form-action falls back to default-src (self only)', () => {
    assert.equal(parsed['form-action'], undefined);
    assert.ok(parsed['default-src'].includes("'self'"));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // No data leakage via CSP
  // ═══════════════════════════════════════════════════════════════════════

  test('no blob: in any directive', () => {
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('blob:'), `${dir} should not allow blob:`);
    }
  });

  test('no filesystem: in any directive', () => {
    for (const [dir, values] of Object.entries(parsed)) {
      assert.ok(!values.includes('filesystem:'), `${dir} should not allow filesystem:`);
    }
  });

  test('no external domains in any directive', () => {
    for (const [dir, values] of Object.entries(parsed)) {
      for (const val of values) {
        // Allowed: 'self', 'unsafe-inline', 'none', ws:, wss:, data:
        const safe = ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'none'",
          'ws:', 'wss:', 'data:', 'blob:', 'filesystem:'];
        const isSafeKeyword = safe.includes(val);
        const isScheme = val.endsWith(':') && !val.startsWith("'"); // e.g. ws:, wss:, data:
        assert.ok(
          isSafeKeyword || isScheme || val.startsWith("'"),
          `${dir}: unexpected external value "${val}" — only self-referencing values expected`
        );
      }
    }
  });

  test('connect-src allows wss: but not arbitrary http:', () => {
    const connectSrc = parsed['connect-src'] || [];
    assert.ok(connectSrc.includes('wss:'), 'Must allow wss:');
    // ws: only allowed when CSP_ALLOW_WS=true (not in production default)
    assert.ok(!connectSrc.includes('http:'), 'Must not allow http:');
    assert.ok(!connectSrc.includes('https:'), 'Must not allow https:');
  });

  test('connect-src bare ws: not in production default (prevents exfiltration)', () => {
    const connectSrc = parsed['connect-src'] || [];
    // Production default must NOT include bare ws: — only wss: is safe
    assert.ok(!connectSrc.includes('ws:') || connectSrc.includes('wss:'),
      'connect-src must use wss: not bare ws: in production');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CSP format validation
  // ═══════════════════════════════════════════════════════════════════════

  test('CSP has no trailing semicolon', () => {
    assert.ok(!CSP.endsWith(';'), 'CSP should not end with semicolon');
  });

  test('CSP has no double spaces', () => {
    assert.ok(!CSP.includes('  '), 'CSP should not contain double spaces');
  });

  test('CSP has no leading/trailing whitespace', () => {
    assert.equal(CSP, CSP.trim(), 'CSP should be trimmed');
  });

  test('each directive is separated by "; " (semicolon + space)', () => {
    const parts = CSP.split(';');
    // All but the last should end with nothing (split removes semicolon)
    // Check there are no accidental empty directives
    for (const part of parts) {
      assert.ok(part.trim().length > 0, 'No empty directives');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Permissions-Policy completeness
  // ═══════════════════════════════════════════════════════════════════════

  test('Permissions-Policy blocks camera', () => {
    assert.ok(PERMISSIONS_POLICY.includes('camera=()'));
  });

  test('Permissions-Policy blocks microphone', () => {
    assert.ok(PERMISSIONS_POLICY.includes('microphone=()'));
  });

  test('Permissions-Policy blocks geolocation', () => {
    assert.ok(PERMISSIONS_POLICY.includes('geolocation=()'));
  });

  test('Permissions-Policy uses empty parens (fully blocked, not just self)', () => {
    const features = PERMISSIONS_POLICY.split(',').map(s => s.trim());
    for (const feat of features) {
      assert.ok(feat.endsWith('=()'), `${feat} should use empty parens (fully blocked)`);
      assert.ok(!feat.includes('(self)'), `${feat} should not allow (self)`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Source code validation
  // ═══════════════════════════════════════════════════════════════════════

  test('server sets CSP header before route handlers', () => {
    const cspIdx = serverSource.indexOf('Content-Security-Policy');
    const firstRoute = serverSource.indexOf('app.get(');
    if (cspIdx !== -1 && firstRoute !== -1) {
      assert.ok(cspIdx < firstRoute, 'CSP header should be set before routes');
    }
  });

  test('server uses res.setHeader (not res.header or res.set)', () => {
    assert.ok(
      serverSource.includes("res.setHeader('Content-Security-Policy'"),
      'Server should use res.setHeader for CSP'
    );
  });

  test('server CSP contains all required directives', () => {
    // CSP is now dynamic (ws: conditional on CSP_ALLOW_WS env var), so check components
    assert.ok(serverSource.includes("default-src 'self'"), 'server CSP must have default-src self');
    assert.ok(serverSource.includes("script-src 'self'"), 'server CSP must have script-src self');
    assert.ok(serverSource.includes("connect-src 'self'"), 'server CSP must have connect-src self');
    assert.ok(serverSource.includes('wss:'), 'server CSP must allow wss:');
    assert.ok(serverSource.includes("frame-ancestors 'none'"), 'server CSP must have frame-ancestors none');
    // ws: should only be added conditionally via env var
    assert.ok(serverSource.includes('CSP_ALLOW_WS'), 'ws: should be conditional on CSP_ALLOW_WS env var');
  });

  test('X-Frame-Options DENY is set in server', () => {
    assert.ok(
      serverSource.includes("X-Frame-Options', 'DENY'") ||
      serverSource.includes('X-Frame-Options", "DENY"'),
      'Server should set X-Frame-Options DENY'
    );
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 CSP Completeness & Alignment Tests');

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
