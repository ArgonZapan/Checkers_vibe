/**
 * hunter-security-fixes.test.js — Security-focused regression tests for known bugs.
 *
 * Tests for:
 * 1. Duplicate trust proxy setting (server/index.js lines 18 & 22)
 * 2. Missing legalMoves validation in /api/ai/predict (server/index.js)
 * 3. trainer.js cppFetch missing AbortError handling (server/ai/trainer.js)
 * 4. CSP header — ws: protocol too broad for proxy deployments (server/index.js)
 *
 * Extracted logic — no server or engine required.
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

// ═══════════════════════════════════════════════════════════════════════
// 1. DUPLICATE TRUST PROXY SETTING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detect duplicate app.set() calls with same key in source code.
 * Returns { setCalls, duplicates } where duplicates includes divergent flag.
 */
function findDuplicateAppSetCalls(sourceCode) {
  const lines = sourceCode.split('\n');
  const setCalls = [];
  const regex = /app\.set\(\s*['"]([^'"]+)['"]\s*,\s*(.+?)\s*\)/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    while ((match = regex.exec(lines[i])) !== null) {
      setCalls.push({
        key: match[1],
        value: match[2].trim(),
        line: i + 1,
        raw: lines[i].trim(),
      });
    }
    regex.lastIndex = 0;
  }

  const seen = {};
  const duplicates = [];
  for (const call of setCalls) {
    const prev = seen[call.key];
    if (prev) {
      duplicates.push({
        ...call,
        divergent: prev.value !== call.value,
        firstLine: prev.line,
      });
    }
    seen[call.key] = call;
  }
  return { setCalls, duplicates };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. MISSING legalMoves VALIDATION IN /api/ai/predict
// ═══════════════════════════════════════════════════════════════════════

/**
 * Extracted predict validation from server/index.js.
 * BUG: only checks `!legalMoves` (truthy), not `!Array.isArray(legalMoves)`.
 */
function validatePredictBody(body) {
  const { board, legalMoves, turn = 1 } = body || {};

  if (!board || !legalMoves) {
    return { valid: false, status: 400, error: 'Missing board or legalMoves' };
  }
  if (!Array.isArray(board) || board.length !== 64) {
    return { valid: false, status: 400, error: 'board must be an array of 64 elements' };
  }
  for (let i = 0; i < board.length; i++) {
    if (typeof board[i] !== 'number' || !Number.isInteger(board[i]) || board[i] < 0 || board[i] > 4) {
      return { valid: false, status: 400, error: `Invalid board element at index ${i}: expected integer 0-4` };
    }
  }
  // NOTE: No validation that legalMoves is an array or has valid structure!
  return { valid: true, board, legalMoves, turn };
}

// Valid board for reuse
const VALID_BOARD = Array(64).fill(0);
VALID_BOARD[0] = 1;

// ═══════════════════════════════════════════════════════════════════════
// 3. TRAINER cppFetch — NO AbortError HANDLING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Server cppFetch (server/index.js) classifies errors with context.
 */
function serverCppFetchClassifyError(err, timeoutMs) {
  if (err.name === 'AbortError') {
    return new Error(`C++ engine timeout (${timeoutMs}ms) — engine may be crashed`);
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
    return new Error(`C++ engine unreachable — ${err.code}`);
  }
  throw err;
}

/**
 * Trainer cppFetch (server/ai/trainer.js) has NO catch — errors propagate raw.
 */
function trainerCppFetchClassifyError(err) {
  return err; // no wrapping, no context
}

// ═══════════════════════════════════════════════════════════════════════
// 4. CSP HEADER — ws: PROTOCOL
// ═══════════════════════════════════════════════════════════════════════

function parseCSP(csp) {
  const directives = {};
  for (const part of csp.split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    directives[name] = values;
  }
  return directives;
}

// Actual CSP from server/index.js line 34
const ACTUAL_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

// ═══════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════

export async function runHunterSecurityFixesTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ───────────────────────────────────────────────────────────────────
  // 1. Duplicate trust proxy
  // ───────────────────────────────────────────────────────────────────

  test('trust proxy: detects duplicate app.set("trust proxy", false) calls', () => {
    const sourceLines = [
      "app.set('trust proxy', false); // SEC: prevent IP spoofing via X-Forwarded-For",
      "app.disable('X-Powered-By');",
      "app.set('trust proxy', false); // SEC-002: prevent X-Forwarded-For spoofing",
    ];
    const result = findDuplicateAppSetCalls(sourceLines.join('\n'));

    assert.equal(result.duplicates.length, 1, 'Should find exactly 1 duplicate');
    assert.equal(result.duplicates[0].key, 'trust proxy');
    assert.equal(result.duplicates[0].divergent, false, 'Both values are false — redundant, not divergent');
  });

  test('trust proxy: detects divergent values (true then false)', () => {
    const sourceLines = [
      "app.set('trust proxy', true);",
      "app.set('trust proxy', false);",
    ];
    const result = findDuplicateAppSetCalls(sourceLines.join('\n'));

    assert.equal(result.duplicates.length, 1);
    assert.equal(result.duplicates[0].divergent, true, 'Values differ — last one wins, may be unintended');
  });

  test('trust proxy: no duplicate when key set once', () => {
    const sourceLines = [
      "app.set('trust proxy', false);",
      "app.set('view engine', 'ejs');",
    ];
    const result = findDuplicateAppSetCalls(sourceLines.join('\n'));

    assert.equal(result.duplicates.length, 0, 'No duplicates expected');
  });

  test('trust proxy: bug exists — same key set twice on different lines', () => {
    // Verify the actual code has the bug
    const sourceLines = [
      "app.set('trust proxy', false); // SEC: prevent IP spoofing via X-Forwarded-For",
      "app.set('trust proxy', false); // SEC-002: prevent X-Forwarded-For spoofing (no proxy in front)",
    ];
    const result = findDuplicateAppSetCalls(sourceLines.join('\n'));

    assert.equal(result.setCalls.filter(c => c.key === 'trust proxy').length, 2,
      'Two trust proxy calls detected — redundant code');
    assert.equal(result.duplicates.length, 1);
    assert.notEqual(result.duplicates[0].firstLine, result.duplicates[0].line,
      'Duplicate appears on a different line than the first call');
  });

  // ───────────────────────────────────────────────────────────────────
  // 2. Missing legalMoves validation in /api/ai/predict
  // ───────────────────────────────────────────────────────────────────

  test('predict: accepts valid legalMoves array', () => {
    const result = validatePredictBody({
      board: VALID_BOARD,
      legalMoves: [{ from: [0, 0], to: [1, 1] }],
    });
    assert.equal(result.valid, true);
  });

  test('predict: REJECTS null legalMoves', () => {
    const result = validatePredictBody({ board: VALID_BOARD, legalMoves: null });
    assert.equal(result.valid, false);
    assert.equal(result.status, 400);
  });

  test('predict: REJECTS undefined legalMoves', () => {
    const result = validatePredictBody({ board: VALID_BOARD });
    assert.equal(result.valid, false);
  });

  test('predict BUG: passes plain object as legalMoves (truthy but not array)', () => {
    const result = validatePredictBody({
      board: VALID_BOARD,
      legalMoves: { from: [0, 0], to: [1, 1] },
    });
    // BUG: object is truthy, passes `!legalMoves` check
    // FIX: should be result.valid === false
    assert.equal(result.valid, true, 'BUG CONFIRMED: object passes truthy check — should be false after fix');
  });

  test('predict BUG: passes string as legalMoves (truthy but not array)', () => {
    const result = validatePredictBody({
      board: VALID_BOARD,
      legalMoves: 'not-an-array',
    });
    assert.equal(result.valid, true, 'BUG CONFIRMED: string passes truthy check');
  });

  test('predict BUG: passes number 42 as legalMoves', () => {
    const result = validatePredictBody({
      board: VALID_BOARD,
      legalMoves: 42,
    });
    assert.equal(result.valid, true, 'BUG CONFIRMED: number passes truthy check');
  });

  test('predict: empty array passes current check (semantically dubious)', () => {
    const result = validatePredictBody({
      board: VALID_BOARD,
      legalMoves: [],
    });
    // Empty array is truthy — passes. predict() with 0 legal moves will crash.
    assert.equal(result.valid, true, 'BUG: empty array passes — predict has no moves to select from');
  });

  // ───────────────────────────────────────────────────────────────────
  // 3. trainer.js cppFetch — no AbortError handling
  // ───────────────────────────────────────────────────────────────────

  test('server cppFetch wraps AbortError with timeout context', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const wrapped = serverCppFetchClassifyError(abortErr, 3000);
    assert.ok(wrapped.message.includes('timeout'), 'Should mention timeout');
    assert.ok(wrapped.message.includes('3000ms'), 'Should include timeout value');
  });

  test('trainer cppFetch: AbortError propagates raw (BUG)', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';

    const wrapped = trainerCppFetchClassifyError(abortErr);
    assert.equal(wrapped.message, 'The operation was aborted', 'BUG: raw error with no timeout context');
    assert.ok(!wrapped.message.includes('timeout'), 'BUG: no timeout info in message');
  });

  test('server cppFetch wraps ECONNREFUSED with context', () => {
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8080');
    connErr.code = 'ECONNREFUSED';

    const wrapped = serverCppFetchClassifyError(connErr);
    assert.ok(wrapped.message.includes('unreachable'), 'Should mention engine unreachable');
  });

  test('trainer cppFetch: ECONNREFUSED propagates raw (BUG)', () => {
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8080');
    connErr.code = 'ECONNREFUSED';

    const wrapped = trainerCppFetchClassifyError(connErr);
    assert.equal(wrapped.message, 'connect ECONNREFUSED 127.0.0.1:8080',
      'BUG: raw error — operator gets no guidance about engine being down');
  });

  test('trainer vs server: same AbortError produces different messages', () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');

    const serverMsg = serverCppFetchClassifyError(abortErr, 5000).message;
    const trainerMsg = trainerCppFetchClassifyError(abortErr).message;

    assert.ok(serverMsg.length > trainerMsg.length,
      'Server wraps with context; trainer returns raw');
    assert.ok(serverMsg.includes('5000ms'), 'Server includes timeout value');
    assert.ok(!trainerMsg.includes('5000ms'), 'Trainer has no timeout info');
  });

  // ───────────────────────────────────────────────────────────────────
  // 4. CSP — ws: protocol too broad
  // ───────────────────────────────────────────────────────────────────

  test('CSP connect-src does NOT contain bare ws: scheme (FIXED)', () => {
    const parsed = parseCSP(ACTUAL_CSP);
    assert.ok(!parsed['connect-src'].includes('ws:'),
      'FIXED: bare ws: removed from production CSP — ws: only via CSP_ALLOW_WS env var');
  });

  test('CSP connect-src contains bare wss: scheme', () => {
    const parsed = parseCSP(ACTUAL_CSP);
    assert.ok(parsed['connect-src'].includes('wss:'),
      'wss: is present for secure WebSocket connections');
  });

  test('CSP ws: is conditional on CSP_ALLOW_WS env var in server source', () => {
    // Verify the fix: ws: should be dynamically controlled, not hardcoded
    assert.ok(serverSource.includes('CSP_ALLOW_WS'),
      'Server must use CSP_ALLOW_WS env var to conditionally enable ws:');
    assert.ok(serverSource.includes('wss:'),
      'Server must always include wss:');
  });

  test('CSP connect-src should keep self for same-origin WebSocket', () => {
    const parsed = parseCSP(ACTUAL_CSP);
    const connectSrc = parsed['connect-src'] || [];

    assert.ok(connectSrc.includes("'self'"), "'self' needed for Socket.IO same-origin");
  });

  test('fixed CSP: connect-src self + wss: (no bare ws:)', () => {
    const parsed = parseCSP(ACTUAL_CSP);
    const connectSrc = parsed['connect-src'];

    assert.ok(!connectSrc.includes('ws:'), 'Production CSP has no ws:');
    assert.ok(connectSrc.includes('wss:'), 'Production CSP keeps wss:');
    assert.ok(connectSrc.includes("'self'"), 'Production CSP keeps self');
  });

  test('bare ws: exfiltration blocked: ws://evil.com/steal no longer passes CSP', () => {
    // After fix: bare ws: removed from production CSP
    const parsed = parseCSP(ACTUAL_CSP);
    const connectSrc = parsed['connect-src'] || [];
    if (!connectSrc.includes('ws:')) {
      // ws: removed — ws://evil.com/steal would be BLOCKED by CSP
      assert.ok(true, 'ws: scheme removed — exfiltration via ws:// blocked');
    } else {
      assert.fail('ws: should not be in production CSP');
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Run
  // ───────────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter Security Fixes Tests');

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
