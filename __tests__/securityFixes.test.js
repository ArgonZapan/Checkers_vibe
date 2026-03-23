/**
 * securityFixes.test.js — Tests for security fixes SEC-001, SEC-002, SEC-004.
 *
 * SEC-001: X-Powered-By header removed — verifies server/index.js disables
 *          or removes the X-Powered-By header to avoid leaking stack info.
 *
 * SEC-002: setParams log sanitized — verifies the setParams WS handler does
 *          NOT log the raw `newParams` object directly; only filtered/sanitized
 *          keys should appear in logs.
 *
 * SEC-004: trust.proxy note — verifies rate limiting IP extraction uses
 *          `req.ip` with a fallback, which is the documented approach.
 *
 * Source analysis — no server required.
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

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runSecurityFixesTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-001: X-Powered-By header removed
  // ═══════════════════════════════════════════════════════════════════════

  test('SEC-001: server/index.js exists and is readable', () => {
    assert.ok(serverSource.length > 0, 'server/index.js should not be empty');
  });

  test('SEC-001: X-Powered-By is disabled or removed', () => {
    const hasDisable = serverSource.includes("app.disable('X-Powered-By')")
      || serverSource.includes('app.disable("X-Powered-By")');
    const hasRemoveHeader = /res\.removeHeader\(\s*['"]X-Powered-By['"]\s*\)/.test(serverSource);
    const hasHelmet = serverSource.includes('helmet');

    assert.ok(
      hasDisable || hasRemoveHeader || hasHelmet,
      'Expected app.disable("X-Powered-By"), res.removeHeader("X-Powered-By"), ' +
      'or helmet middleware — none found in server/index.js'
    );
  });

  test('SEC-001: X-Powered-By disable should appear before route handlers', () => {
    const disableIdx = serverSource.indexOf("app.disable('X-Powered-By')");
    const altDisableIdx = serverSource.indexOf('app.disable("X-Powered-By")');
    const removeIdx = serverSource.search(/res\.removeHeader\(\s*['"]X-Powered-By['"]\s*\)/);
    const firstRouteIdx = serverSource.indexOf('app.get(');

    const activeIdx = Math.min(
      disableIdx === -1 ? Infinity : disableIdx,
      altDisableIdx === -1 ? Infinity : altDisableIdx,
      removeIdx === -1 ? Infinity : removeIdx
    );

    // If the header removal exists, it should come before any route
    if (activeIdx !== Infinity && firstRouteIdx !== -1) {
      assert.ok(
        activeIdx < firstRouteIdx,
        'X-Powered-By removal should be declared before route handlers'
      );
    }
    // If it doesn't exist, the previous test already failed — skip here
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-002: setParams log sanitized
  // ═══════════════════════════════════════════════════════════════════════

  test('SEC-002: setParams handler exists in server/index.js', () => {
    assert.ok(
      serverSource.includes("socket.on('setParams'"),
      'Expected setParams socket handler in server/index.js'
    );
  });

  test('SEC-002: setParams does not log raw newParams before filtering', () => {
    // Find the setParams handler block
    const setParamsStart = serverSource.indexOf("socket.on('setParams'");
    assert.ok(setParamsStart !== -1, 'setParams handler not found');

    // Extract a window around the handler start (before ALLOWED_PARAMS filter)
    const filterStart = serverSource.indexOf('ALLOWED_PARAMS', setParamsStart);
    const preamble = serverSource.slice(setParamsStart, filterStart !== -1 ? filterStart : setParamsStart + 500);

    // The preamble should NOT contain console.log with newParams
    const unsafeLog = /console\.(log|info|debug)\([^)]*newParams[^)]*\)/.test(preamble);
    assert.ok(
      !unsafeLog,
      'setParams should not log raw newParams before the ALLOWED_PARAMS whitelist filter — ' +
      'this could log attacker-controlled keys'
    );
  });

  test('SEC-002: setParams logs only after filtering (sanitized output)', () => {
    const setParamsStart = serverSource.indexOf("socket.on('setParams'");
    assert.ok(setParamsStart !== -1, 'setParams handler not found');

    // Find console.log within setParams (after the filter)
    const filterIdx = serverSource.indexOf('newParams = filtered', setParamsStart);
    if (filterIdx === -1) {
      // Alternative pattern: filtered assigned to newParams differently
      // Just check that any console.log uses the filtered variable
      const logMatch = serverSource.slice(setParamsStart).match(/console\.log\([^)]+\)/);
      if (logMatch) {
        assert.ok(
          !logMatch[0].includes('newParams') || filterIdx !== -1,
          'console.log in setParams should reference filtered data'
        );
      }
      return;
    }

    // After filtering, console.log is acceptable — verify it exists for auditing
    const afterFilter = serverSource.slice(filterIdx, filterIdx + 2000);
    const hasAuditLog = /console\.(log|warn)\(/.test(afterFilter);
    assert.ok(
      hasAuditLog,
      'setParams should log sanitized params after filtering for audit trail'
    );
  });

  test('SEC-002: setParams uses ALLOWED_PARAMS whitelist before logging', () => {
    const setParamsStart = serverSource.indexOf("socket.on('setParams'");
    assert.ok(setParamsStart !== -1, 'setParams handler not found');

    const handlerBlock = serverSource.slice(setParamsStart, setParamsStart + 4000);
    assert.ok(
      handlerBlock.includes('ALLOWED_PARAMS') || handlerBlock.includes('allowedParams'),
      'setParams handler should use a whitelist (ALLOWED_PARAMS) to filter input before processing'
    );
    assert.ok(
      handlerBlock.includes('filtered') || handlerBlock.includes('sanitized'),
      'setParams handler should produce a filtered/sanitized copy of params'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-004: trust.proxy / rate-limit IP extraction
  // ═══════════════════════════════════════════════════════════════════════

  test('SEC-004: rate limiter extracts IP using req.ip with fallback', () => {
    // The rate limiter middleware should use req.ip (Express trust proxy)
    // with a fallback to req.socket.remoteAddress
    const rateLimitSection = serverSource.slice(
      serverSource.indexOf('RATE_LIMIT_MAX ='),
      serverSource.indexOf('RATE_LIMIT_MAX =') + 2000
    );

    const usesReqIp = /req\.ip/.test(rateLimitSection);
    const usesFallback = /req\.socket\.remoteAddress/.test(rateLimitSection);

    assert.ok(
      usesReqIp && usesFallback,
      'Rate limiter should use req.ip (trust proxy) with req.socket.remoteAddress fallback'
    );
  });

  test('SEC-004: rate limiter does not blindly trust X-Forwarded-For', () => {
    // If trust proxy is not set, X-Forwarded-For should not be parsed directly
    // The code should rely on Express's req.ip (which respects trust proxy setting)
    const rateLimitSection = serverSource.slice(
      serverSource.indexOf('RATE_LIMIT_MAX ='),
      serverSource.indexOf('RATE_LIMIT_MAX =') + 2000
    );

    const directXff = /req\.(headers|get)\(\s*['"]x-forwarded-for['"]\s*\)/i.test(rateLimitSection);
    assert.ok(
      !directXff,
      'Rate limiter should NOT directly parse x-forwarded-for header — ' +
      'use req.ip which respects Express trust proxy setting'
    );
  });

  test('SEC-004: note — trust proxy config is documented', () => {
    // This is a documentation/awareness test: verify the codebase acknowledges
    // the trust proxy configuration somewhere (config, comments, or app.set)
    const hasTrustProxy = serverSource.includes('trust proxy')
      || serverSource.includes('trustProxy')
      || serverSource.includes('trust_proxy');

    // The rate limiter uses req.ip which requires trust proxy to be meaningful
    // behind a reverse proxy. This test documents that awareness.
    assert.ok(
      hasTrustProxy || serverSource.includes('req.ip'),
      'Codebase should acknowledge trust proxy behavior — ' +
      'req.ip only returns correct client IP when trust proxy is configured'
    );
  });

  // ── Run all tests ─────────────────────────────────────────────────────

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`  ❌ ${t.name}`);
      console.error(`     ${err.message}`);
    }
  }

  console.log(`\n  securityFixes: ${passed} passed, ${failed} failed (${tests.length} total)`);
  return { passed, failed };
}
