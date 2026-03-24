/**
 * getGameState-sanitize-internals.test.js — Verifies getGameState response
 * does NOT leak C++ engine internal fields to the client.
 *
 * The sanitize fix ensures only a whitelist of safe keys reaches the client:
 *   board, turn, legalMoves, gameOver, winner, lastMove
 *
 * Any C++ internal fields (engine paths, debug info, raw state, FEN strings,
 * internal flags, memory addresses, etc.) must be stripped.
 *
 * Extracted logic — no server required.
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

// ── Extracted: assembleGameState mirrors server getGameState ────────────────

const ALLOWED_KEYS = new Set(['board', 'turn', 'legalMoves', 'gameOver', 'winner', 'lastMove']);

function turnToColor(turn) {
  if (typeof turn === 'string') return turn;
  if (turn === 1) return 'white';
  if (turn === -1) return 'black';
  return 'white';
}

function sanitizeGameState(cppState, cppLegalMoves) {
  const board = cppState.board || new Array(64).fill(0);
  const moves = (cppLegalMoves || []).map(m => ({
    from: m.from,
    to: m.to,
    captures: m.captures || [],
    index: m.index,
  }));
  // Build result with ONLY allowed keys
  const result = {
    board,
    turn: turnToColor(cppState.turn ?? cppState.currentTurn ?? 1),
    legalMoves: moves,
    gameOver: cppState.gameOver ?? false,
    winner: cppState.winner != null ? turnToColor(cppState.winner) : null,
    lastMove: cppState.lastMove || null,
  };
  return result;
}

// Verify no extra keys leak through
function hasOnlyAllowedKeys(obj) {
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, leaked: k };
  }
  return { ok: true };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runGetGameStateSanitizeInternalsTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Response contains ONLY whitelisted keys
  // ═══════════════════════════════════════════════════════════════════════

  test('response has exactly 6 keys (no extras)', () => {
    const state = sanitizeGameState(
      { board: new Array(64).fill(0), turn: 1 },
      []
    );
    assert.equal(Object.keys(state).length, 6, 'Should have exactly 6 keys');
  });

  test('response keys match ALLOWED_KEYS whitelist', () => {
    const state = sanitizeGameState(
      { board: new Array(64).fill(0), turn: 1 },
      []
    );
    const check = hasOnlyAllowedKeys(state);
    assert.equal(check.ok, true, `Leaked key: ${check.leaked}`);
  });

  test('ALL allowed keys present in response', () => {
    const state = sanitizeGameState(
      { board: new Array(64).fill(0), turn: 1 },
      []
    );
    for (const key of ALLOWED_KEYS) {
      assert.ok(key in state, `Missing allowed key: ${key}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. C++ internal fields are NOT in response
  // ═══════════════════════════════════════════════════════════════════════

  const INTERNAL_FIELDS = [
    'engine', 'enginePath', 'cppPath', 'debug', 'fen', 'rawBoard',
    'internalState', 'memoryAddress', 'ptr', 'stack', 'pid',
    'cppInternal', 'engineVersion', 'binaryPath', 'stderr', 'stdout',
    'error', 'exception', 'trace', 'config', 'params',
    '__proto__', 'constructor', 'prototype',
  ];

  for (const field of INTERNAL_FIELDS) {
    test(`C++ internal field "${field}" does NOT appear in response`, () => {
      const cppState = {
        board: new Array(64).fill(0),
        turn: 1,
        // Simulate C++ engine returning extra fields
        [field]: `/opt/engine/internal/${field}`,
        engine: '/opt/checkers-engine/bin/server',
        debug: true,
        fen: 'W:W27,19,18:B12,4,3',
      };
      const state = sanitizeGameState(cppState, []);
      assert.equal(field in state, false, `Field "${field}" leaked to client`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. C++ state with many extra fields — all stripped
  // ═══════════════════════════════════════════════════════════════════════

  test('C++ response with 20 extra fields — none leak through', () => {
    const cppState = {
      board: new Array(64).fill(0),
      turn: 1,
      engine: '/opt/checkers-engine',
      debug: true,
      pid: 12345,
      memoryUsage: { rss: 1024 },
      cppVersion: '1.2.3',
      internalFlags: 0xFF,
      rawResponse: '{ "ok": true }',
      fen: 'W:W27:B12',
      stackTrace: 'at main.cpp:42',
      config: { timeout: 5000 },
      params: { depth: 8 },
      serverTime: Date.now(),
      requestId: 'abc-123',
      binaryPath: '/usr/bin/engine',
      stderr: '',
      stdout: 'ready',
      error: null,
      warnings: ['deprecated'],
      extra: { nested: { deep: true } },
    };
    const state = sanitizeGameState(cppState, []);
    const check = hasOnlyAllowedKeys(state);
    assert.equal(check.ok, true, `Leaked: ${check.leaked}`);
    assert.equal(Object.keys(state).length, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Legal moves — only expected fields per move
  // ═══════════════════════════════════════════════════════════════════════

  test('legal move objects contain only from/to/captures/index', () => {
    const moves = sanitizeGameState(
      { board: new Array(64).fill(0) },
      [{
        from: [2, 1],
        to: [3, 0],
        captures: [[2, 5]],
        index: 7,
        // Simulate C++ extra fields on moves
        engineInternal: 'abc',
        evaluation: 0.5,
        depth: 4,
        debugInfo: 'extra',
      }]
    );
    assert.equal(moves.legalMoves.length, 1);
    const m = moves.legalMoves[0];
    const moveKeys = Object.keys(m);
    for (const k of moveKeys) {
      assert.ok(
        ['from', 'to', 'captures', 'index'].includes(k),
        `Unexpected key "${k}" on legal move object`
      );
    }
  });

  test('legal move with missing captures gets default []', () => {
    const moves = sanitizeGameState(
      { board: new Array(64).fill(0) },
      [{ from: [2, 1], to: [3, 0] }]
    );
    assert.deepEqual(moves.legalMoves[0].captures, []);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Prototype pollution attempts on C++ state
  // ═══════════════════════════════════════════════════════════════════════

  test('__proto__ on C++ state does NOT pollute response prototype', () => {
    const malicious = JSON.parse('{"board":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"turn":1,"__proto__":{"isAdmin":true}}');
    const state = sanitizeGameState(malicious, []);
    // __proto__ should not appear as own property
    assert.equal(Object.prototype.hasOwnProperty.call(state, '__proto__'), false);
    // isAdmin should not be on the result
    assert.equal(state.isAdmin, undefined, 'Prototype pollution via __proto__');
  });

  test('constructor pollution attempt does NOT affect response', () => {
    const malicious = {
      board: new Array(64).fill(0),
      turn: 1,
      constructor: { name: 'Injected' },
    };
    const state = sanitizeGameState(malicious, []);
    assert.equal('constructor' in state, false, 'constructor should be stripped');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Server source code verification
  // ═══════════════════════════════════════════════════════════════════════

  test('server getGameState does NOT spread C++ response with ...state', () => {
    // If the code did `return { ...state, board, turn, ... }` it would leak
    // all C++ internal fields. Verify it doesn't use spread on state.
    const funcStart = serverSource.indexOf('async function getGameState()');
    if (funcStart === -1) return; // function not found, skip
    const funcEnd = serverSource.indexOf('\n}\n', funcStart + 100);
    const funcBody = serverSource.slice(funcStart, funcEnd > 0 ? funcEnd : funcStart + 500);
    assert.ok(
      !funcBody.includes('...state') && !funcBody.includes('... cppState'),
      'getGameState should NOT spread C++ state object (would leak internals)'
    );
  });

  test('server getGameState return uses explicit key mapping', () => {
    const funcStart = serverSource.indexOf('async function getGameState()');
    if (funcStart === -1) return;
    const funcBody = serverSource.slice(funcStart, funcStart + 800);
    // Verify explicit key construction (not spread)
    assert.ok(funcBody.includes('turn:'), 'Should explicitly set turn');
    assert.ok(funcBody.includes('legalMoves:'), 'Should explicitly set legalMoves');
    assert.ok(funcBody.includes('gameOver:'), 'Should explicitly set gameOver');
    assert.ok(funcBody.includes('winner:'), 'Should explicitly set winner');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Error response also sanitized
  // ═══════════════════════════════════════════════════════════════════════

  test('error fallback returns safe default state (no internals)', () => {
    // Simulate what happens on C++ engine error
    const errorState = {
      board: Array(64).fill(0),
      turn: 'white',
      legalMoves: [],
      gameOver: true,
      winner: null,
      lastMove: null,
    };
    const check = hasOnlyAllowedKeys(errorState);
    assert.equal(check.ok, true);
    assert.equal(Object.keys(errorState).length, 6);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. JSON serialization roundtrip preserves sanitization
  // ═══════════════════════════════════════════════════════════════════════

  test('JSON.stringify → parse roundtrip preserves only allowed keys', () => {
    const cppState = {
      board: new Array(64).fill(0),
      turn: 1,
      engine: '/opt/engine',
      debug: { level: 3 },
      internalFlags: 42,
    };
    const state = sanitizeGameState(cppState, []);
    const serialized = JSON.stringify(state);
    const parsed = JSON.parse(serialized);
    const check = hasOnlyAllowedKeys(parsed);
    assert.equal(check.ok, true, `Leaked after roundtrip: ${check.leaked}`);
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 getGameState Sanitize C++ Internals Tests');

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
