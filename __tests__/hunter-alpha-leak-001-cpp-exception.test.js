/**
 * hunter-alpha-leak-001-cpp-exception.test.js — Test for C++ server exception message leak.
 *
 * LEAK: /api/move in engine/src/server.cpp sends e.what() directly to clients
 * in error responses. This can leak internal implementation details, JSON parsing
 * internals, type information, file paths, or memory addresses.
 *
 * Verifies that:
 * 1. The fix replaces e.what() with generic error messages
 * 2. The board/set endpoint already uses generic messages (consistency check)
 * 3. No raw exception text is included in error JSON responses
 *
 * Extracted logic — no server or engine required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverCppPath = path.join(__dirname, '..', 'engine', 'src', 'server.cpp');
let cppSource;
try {
  cppSource = readFileSync(serverCppPath, 'utf-8');
} catch {
  cppSource = '';
}

export async function runLeakCppExceptionTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Test: /api/move handler should NOT send e.what() to clients ─────────

  test('LEAK-001: /api/move parse_error catch does NOT leak e.what() to client', () => {
    // Find the /api/move handler block
    const moveHandlerStart = cppSource.indexOf('svr.Post("/api/move"');
    assert.ok(moveHandlerStart !== -1, 'Could not find /api/move handler');

    // Find the catch blocks after the handler
    const catchBlock = cppSource.indexOf('catch (json::parse_error', moveHandlerStart);
    assert.ok(catchBlock !== -1, 'Could not find parse_error catch block in /api/move');

    // Get the catch block content (up to next catch or closing brace)
    const nextCatch = cppSource.indexOf('catch (', catchBlock + 20);
    const blockEnd = nextCatch !== -1 ? nextCatch : cppSource.indexOf('});', catchBlock);
    const block = cppSource.substring(catchBlock, blockEnd);

    // Should NOT contain e.what() in the error message sent to client
    assert.ok(!block.includes('e.what()'),
      'SECURITY LEAK: /api/move parse_error handler sends e.what() to client — ' +
      'this can leak internal JSON parsing details');
  });

  test('LEAK-002: /api/move type_error catch does NOT leak e.what() to client', () => {
    const moveHandlerStart = cppSource.indexOf('svr.Post("/api/move"');
    assert.ok(moveHandlerStart !== -1, 'Could not find /api/move handler');

    const catchBlock = cppSource.indexOf('catch (json::type_error', moveHandlerStart);
    assert.ok(catchBlock !== -1, 'Could not find type_error catch block in /api/move');

    const nextCatch = cppSource.indexOf('catch (', catchBlock + 20);
    const blockEnd = nextCatch !== -1 ? nextCatch : cppSource.indexOf('});', catchBlock);
    const block = cppSource.substring(catchBlock, blockEnd);

    assert.ok(!block.includes('e.what()'),
      'SECURITY LEAK: /api/move type_error handler sends e.what() to client — ' +
      'this can leak internal type information');
  });

  test('LEAK-003: /api/move std::exception catch does NOT leak e.what() to client', () => {
    const moveHandlerStart = cppSource.indexOf('svr.Post("/api/move"');
    assert.ok(moveHandlerStart !== -1, 'Could not find /api/move handler');

    const catchBlock = cppSource.indexOf('catch (std::exception', moveHandlerStart);
    assert.ok(catchBlock !== -1, 'Could not find std::exception catch block in /api/move');

    // Get content until next catch or handler end
    const nextHandler = cppSource.indexOf('svr.Post(', catchBlock + 20);
    const nextSvrGet = cppSource.indexOf('svr.Get(', catchBlock + 20);
    const blockEndCandidates = [nextHandler, nextSvrGet].filter(i => i !== -1);
    const blockEnd = blockEndCandidates.length > 0 ? Math.min(...blockEndCandidates) : cppSource.length;
    const block = cppSource.substring(catchBlock, blockEnd);

    assert.ok(!block.includes('e.what()'),
      'SECURITY LEAK: /api/move std::exception handler sends e.what() to client — ' +
      'this can leak internal error details, file paths, or memory addresses');
  });

  // ── Test: /api/board/set already uses generic messages (consistency) ─────

  test('LEAK-004: /api/board/set parse_error uses generic message (reference)', () => {
    const setHandlerStart = cppSource.indexOf('/api/board/set');
    if (setHandlerStart === -1) return; // skip if handler not found

    // Find the SECOND parse_error catch (board/set handler comes after /api/move)
    const firstCatch = cppSource.indexOf('catch (json::parse_error', 0);
    const catchBlock = cppSource.indexOf('catch (json::parse_error', firstCatch + 1);
    if (catchBlock === -1) {
      // Only one parse_error catch — board/set uses catch (json::parse_error&) without e
      // Just verify no e.what() anywhere in board/set handler area
      const handlerEnd = cppSource.indexOf('svr.Post(', setHandlerStart + 20);
      const block = cppSource.substring(setHandlerStart, handlerEnd !== -1 ? handlerEnd : setHandlerStart + 2000);
      assert.ok(!block.includes('e.what()'),
        '/api/board/set handler should not leak e.what() to clients');
      return;
    }

    const nextCatch = cppSource.indexOf('catch (', catchBlock + 20);
    const blockEnd = nextCatch !== -1 ? nextCatch : cppSource.length;
    const block = cppSource.substring(catchBlock, blockEnd);

    // Should use generic message, NOT e.what()
    assert.ok(!block.includes('e.what()'),
      '/api/board/set parse_error should use generic message');
  });

  // ── Test: All error responses should use generic messages ────────────────

  test('LEAK-005: No raw exception text in any JSON error response (global check)', () => {
    // Find ALL e.what() usages in error responses
    // Pattern: err["error"] = ...e.what()... or similar
    const lines = cppSource.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match lines that assign e.what() to err["error"]
      if (line.includes('err["error"]') && line.includes('e.what()')) {
        violations.push({
          line: i + 1,
          content: line.trim(),
        });
      }
    }

    assert.equal(violations.length, 0,
      `Found ${violations.length} location(s) where e.what() is sent to clients:\n` +
      violations.map(v => `  Line ${v.line}: ${v.content}`).join('\n'));
  });

  // ── Run all tests ───────────────────────────────────────────────────────

  for (const { name, fn } of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ❌ ${name}`);
      console.log(`     ${err.message}`);
    }
  }

  return { passed, failed, tests };
}
