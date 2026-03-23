/**
 * cppFetchLogSanitization.test.js — Verifies cppFetch error logging does not
 * leak full C++ engine response bodies containing internal file paths, stack
 * traces, or detailed error info to server logs.
 *
 * Key concerns:
 * 1. body.slice(0, 200) still logs up to 200 chars of raw response
 * 2. Thrown errors include internal URL paths
 * 3. Client-facing errors must remain generic
 *
 * Source analysis — no server required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'server', 'index.js');
const trainerPath = path.join(__dirname, '..', 'server', 'ai', 'trainer.js');
const proxyPath = path.join(__dirname, '..', 'server', 'proxy.js');

let serverSource, trainerSource, proxySource;
try {
  serverSource = readFileSync(serverPath, 'utf-8');
} catch { serverSource = ''; }
try {
  trainerSource = readFileSync(trainerPath, 'utf-8');
} catch { trainerSource = ''; }
try {
  proxySource = readFileSync(proxyPath, 'utf-8');
} catch { proxySource = ''; }

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runCppFetchLogSanitizationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── 1. Response body logging is capped at 200 chars ──────────────────────

  test('cppFetch in index.js caps logged body at 200 chars', () => {
    // Pattern: body.slice(0, 200)
    assert.ok(
      serverSource.includes('body.slice(0, 200)'),
      'index.js cppFetch should slice body to 200 chars max'
    );
  });

  test('cppFetch in trainer.js caps logged body at 200 chars', () => {
    assert.ok(
      trainerSource.includes('body.slice(0, 200)'),
      'trainer.js cppFetch should slice body to 200 chars max'
    );
  });

  // ── 2. Client-facing error messages are generic ──────────────────────────

  test('HTTP error responses never include internal paths or codes', () => {
    const errorPatterns = [
      /res\.status\(\d+\)\.json\(\{ error: '.*(?:localhost|8080|ECONN|cppFetch|stack|\/opt\/)/,
      /res\.status\(\d+\)\.json\(\{ error: ".*(?:localhost|8080|ECONN|cppFetch|stack|\/opt\/)/,
    ];
    for (const pattern of errorPatterns) {
      assert.ok(
        !pattern.test(serverSource),
        `Found HTTP error response with internal details matching: ${pattern}`
      );
    }
  });

  test('WebSocket error messages never include internal paths or codes', () => {
    const wsErrorPattern = /socket\.emit\(['"]error['"],\s*\{ message: ['"]\$\{.*(?:localhost|8080|ECONN|cppFetch|stack)/;
    assert.ok(
      !wsErrorPattern.test(serverSource),
      'WebSocket error messages should not include internal details'
    );
  });

  // ── 3. Thrown errors include URL but not response body ───────────────────

  test('cppFetch thrown errors include URL path for debugging', () => {
    // The thrown Error includes the path — this is server-side only
    // Actual pattern: throw new Error(`C++ ${path} → ${res.status}`);
    assert.ok(
      serverSource.includes('C++ ${path} → ${res.status}'),
      'index.js cppFetch thrown error should include path and status'
    );
  });

  test('cppFetch thrown errors do NOT include response body', () => {
    // The thrown Error should NOT contain body content
    const thrownErrorWithBody = /throw new Error\(`C\+\+ engine.*\$\{body/;
    assert.ok(
      !thrownErrorWithBody.test(serverSource),
      'Thrown errors should not include response body content'
    );
    assert.ok(
      !thrownErrorWithBody.test(trainerSource),
      'trainer.js thrown errors should not include response body content'
    );
  });

  // ── 4. Error codes are handled generically ───────────────────────────────

  test('ECONNREFUSED/ECONNRESET errors produce generic client messages', () => {
    // From index.js: throw new Error(`C++ engine unreachable — ${err.code}`);
    // From trainer.js: throw new Error(`C++ engine unreachable — ${err.code}`);
    assert.ok(
      serverSource.includes('C++ engine unreachable — ${err.code}'),
      'index.js should throw with err.code for server-side logging'
    );
    assert.ok(
      trainerSource.includes('C++ engine unreachable — ${err.code}'),
      'trainer.js should also throw with err.code'
    );
    // But proxy catches and sends generic message
    assert.ok(
      proxySource.includes("'C++ backend unavailable'") || proxySource.includes('"C++ backend unavailable"'),
      'Proxy error handler should send generic message to clients'
    );
  });

  // ── 5. Specific client-facing error messages are safe ────────────────────

  test('Prediction error response is generic', () => {
    assert.ok(
      serverSource.includes("{ error: 'Prediction failed' }"),
      'Prediction endpoint should return generic error'
    );
  });

  test('Training error response is generic', () => {
    assert.ok(
      serverSource.includes("{ error: 'Training failed' }"),
      'Training endpoint should return generic error'
    );
  });

  test('Reset error response is generic', () => {
    assert.ok(
      serverSource.includes("{ error: 'Reset failed' }"),
      'Reset endpoint should return generic error'
    );
  });

  test('Rate limit error response is generic', () => {
    assert.ok(
      serverSource.includes("{ error: 'Too many requests' }"),
      'Rate limit should return generic error'
    );
  });

  test('Proxy error response is generic', () => {
    assert.ok(
      proxySource.includes("'C++ backend unavailable'") || proxySource.includes('"C++ backend unavailable"'),
      'Proxy should return generic error when C++ engine is down'
    );
  });

  // ── 6. No process.env values leak to clients ─────────────────────────────

  test('process.env is never referenced in error responses', () => {
    assert.ok(
      !serverSource.includes('process.env') || !/res\.\w+.*process\.env/.test(serverSource),
      'No process.env values should appear in HTTP responses'
    );
  });

  // ── Run tests ────────────────────────────────────────────────────────────

  for (const { name, fn } of tests) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
