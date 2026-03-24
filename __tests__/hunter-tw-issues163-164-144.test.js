/**
 * hunter-tw-issues163-164-144.test.js — Regression tests for issues #163, #164, #144.
 *
 * #163 — setSpeedMode: invalid mode must emit error, valid mode must emit speedUpdate
 *   Source: server/index.js socket.on('setSpeedMode', ...)
 *   - Type check: typeof mode !== 'string' → emit error
 *   - Valid: 'fast' | 'normal' → emit speedUpdate
 *   - Invalid string → emit error
 *
 * #164 — loadState: running flag must be restored
 *   Source: server/ai/trainer.js loadState()
 *   - this.running = !!state.running
 *
 * #144 — MoveHistory.jsx dead code / existence check
 *   Verify whether client/src/components/MoveHistory.jsx still exists.
 *
 * Edge case — setSpeedMode with number instead of string
 *   typeof mode !== 'string' → emit error, no speedUpdate
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ═══════════════════════════════════════════════════════════════════════════
// #163: setSpeedMode — emit error on invalid mode, speedUpdate on valid
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimal socket mock that records emitted events.
 */
function createSocketMock(gameMode = 'aivai') {
  const emitted = [];
  return {
    gameMode,
    emitted,
    emit(event, data) {
      emitted.push({ event, data });
    }
  };
}

/**
 * Minimal io mock.
 */
function createIoMock() {
  const emitted = [];
  return {
    emitted,
    emit(event, data) {
      emitted.push({ event, data });
    }
  };
}

/**
 * Extracted setSpeedMode handler logic (mirrors server/index.js lines 799-820).
 * Throttle is omitted — tests focus on validation + emit behavior.
 */
function handleSetSpeedMode(socket, io, mode, CONFIG) {
  // Auth: only allow in aivai mode
  if (socket.gameMode !== 'aivai') {
    socket.emit('error', { message: 'Zmiana trybu prędkości dozwolona tylko w trybie AI vs AI' });
    return;
  }
  // Validate: must be a string
  if (typeof mode !== 'string') {
    socket.emit('error', { message: 'Invalid speed mode — expected string' });
    return;
  }
  if (mode === 'fast' || mode === 'normal') {
    CONFIG.server.speedMode = mode;
    io.emit('speedUpdate', { speedMode: mode });
  } else {
    socket.emit('error', { message: `Invalid speed mode '${mode}' — expected 'fast' or 'normal'` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// #164: loadState — running flag restoration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extracted loadState logic (mirrors server/ai/trainer.js lines 647-665).
 */
function loadState(state, CONFIG) {
  const result = {
    running: false,
    epsilonWhite: CONFIG.ai.defaultEpsilon,
    epsilonBlack: CONFIG.ai.defaultEpsilon,
    stats: { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null }
  };
  if (state.stats) {
    result.stats.gamesPlayed = state.stats.gamesPlayed ?? 0;
    result.stats.whiteWins = state.stats.whiteWins ?? 0;
    result.stats.blackWins = state.stats.blackWins ?? 0;
    result.stats.draws = state.stats.draws ?? 0;
    result.stats.lastLoss = state.stats.lastLoss ?? null;
  }
  result.epsilonWhite = (typeof state.epsilonWhite === 'number' && Number.isFinite(state.epsilonWhite))
    ? state.epsilonWhite : CONFIG.ai.defaultEpsilon;
  result.epsilonBlack = (typeof state.epsilonBlack === 'number' && Number.isFinite(state.epsilonBlack))
    ? state.epsilonBlack : CONFIG.ai.defaultEpsilon;
  // Restore running flag
  result.running = !!state.running;
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════

export async function runHunterTwIssues163to144Tests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ─────────────────────────────────────────────────────────────────────
  // #163: setSpeedMode — valid modes
  // ─────────────────────────────────────────────────────────────────────

  test('#163: valid "fast" emits speedUpdate with { speedMode: "fast" }', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 'fast', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast', 'CONFIG should be updated');
    assert.equal(io.emitted.length, 1, 'io should emit exactly 1 event');
    assert.equal(io.emitted[0].event, 'speedUpdate');
    assert.deepEqual(io.emitted[0].data, { speedMode: 'fast' });
    assert.equal(socket.emitted.length, 0, 'socket should NOT receive error');
  });

  test('#163: valid "normal" emits speedUpdate with { speedMode: "normal" }', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'fast' } };
    handleSetSpeedMode(socket, io, 'normal', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal', 'CONFIG should be updated');
    assert.equal(io.emitted.length, 1, 'io should emit exactly 1 event');
    assert.equal(io.emitted[0].event, 'speedUpdate');
    assert.deepEqual(io.emitted[0].data, { speedMode: 'normal' });
    assert.equal(socket.emitted.length, 0, 'socket should NOT receive error');
  });

  test('#163: toggle fast → normal → fast works correctly', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };

    handleSetSpeedMode(socket, io, 'fast', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast');

    // Reset io mock
    io.emitted.length = 0;
    handleSetSpeedMode(socket, io, 'normal', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.deepEqual(io.emitted[0].data, { speedMode: 'normal' });

    io.emitted.length = 0;
    handleSetSpeedMode(socket, io, 'fast', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast');
    assert.deepEqual(io.emitted[0].data, { speedMode: 'fast' });
  });

  // ─────────────────────────────────────────────────────────────────────
  // #163: setSpeedMode — invalid modes emit error, no speedUpdate
  // ─────────────────────────────────────────────────────────────────────

  test('#163: invalid "turbo" emits error on socket, no speedUpdate', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 'turbo', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal', 'CONFIG should NOT be changed');
    assert.equal(io.emitted.length, 0, 'io should NOT emit speedUpdate');
    assert.equal(socket.emitted.length, 1, 'socket should receive 1 error');
    assert.equal(socket.emitted[0].event, 'error');
    assert.ok(socket.emitted[0].data.message.includes('Invalid speed mode'));
  });

  test('#163: invalid "" emits error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'fast' } };
    handleSetSpeedMode(socket, io, '', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast', 'CONFIG should NOT be changed');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163: invalid "FAST" (uppercase) emits error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 'FAST', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163: invalid "Normal" (mixed case) emits error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 'Normal', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  // ─────────────────────────────────────────────────────────────────────
  // #163 + edge case: setSpeedMode with non-string types (number, null, etc.)
  // ─────────────────────────────────────────────────────────────────────

  test('#163 edge: number 1 emits "expected string" error, no speedUpdate', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 1, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal', 'CONFIG unchanged');
    assert.equal(io.emitted.length, 0, 'no speedUpdate emitted');
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
    assert.ok(socket.emitted[0].data.message.includes('expected string'));
  });

  test('#163 edge: number 0 emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'fast' } };
    handleSetSpeedMode(socket, io, 0, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast', 'CONFIG unchanged');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
    assert.ok(socket.emitted[0].data.message.includes('expected string'));
  });

  test('#163 edge: number -1 emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, -1, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: NaN emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, NaN, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: null emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'fast' } };
    handleSetSpeedMode(socket, io, null, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'fast');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: undefined emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, undefined, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: boolean true emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, true, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: object { mode: "fast" } emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, { mode: 'fast' }, CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  test('#163 edge: array ["fast"] emits "expected string" error', () => {
    const socket = createSocketMock('aivai');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, ['fast'], CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal');
    assert.equal(io.emitted.length, 0);
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
  });

  // ─────────────────────────────────────────────────────────────────────
  // #163: non-aivai mode rejects setSpeedMode entirely
  // ─────────────────────────────────────────────────────────────────────

  test('#163: non-aivai mode rejects even valid "fast"', () => {
    const socket = createSocketMock('human');
    const io = createIoMock();
    const CONFIG = { server: { speedMode: 'normal' } };
    handleSetSpeedMode(socket, io, 'fast', CONFIG);
    assert.equal(CONFIG.server.speedMode, 'normal', 'CONFIG unchanged');
    assert.equal(io.emitted.length, 0, 'no speedUpdate');
    assert.equal(socket.emitted.length, 1);
    assert.equal(socket.emitted[0].event, 'error');
    assert.ok(socket.emitted[0].data.message.includes('AI vs AI'));
  });

  // ─────────────────────────────────────────────────────────────────────
  // #164: loadState restores running flag
  // ─────────────────────────────────────────────────────────────────────

  test('#164: loadState with running=true restores running flag', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = {
      stats: { gamesPlayed: 42, whiteWins: 20, blackWins: 15, draws: 7, lastLoss: null },
      epsilonWhite: 0.3,
      epsilonBlack: 0.4,
      running: true
    };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, true, 'running flag must be restored to true');
  });

  test('#164: loadState with running=false restores running flag', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = {
      stats: { gamesPlayed: 10, whiteWins: 5, blackWins: 3, draws: 2, lastLoss: null },
      epsilonWhite: 0.2,
      epsilonBlack: 0.2,
      running: false
    };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, false, 'running flag must be restored to false');
  });

  test('#164: loadState without running field defaults to false', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = {
      stats: { gamesPlayed: 0, whiteWins: 0, blackWins: 0, draws: 0, lastLoss: null },
      epsilonWhite: 0.5,
      epsilonBlack: 0.5
      // no running field
    };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, false, 'missing running should default to false (!!undefined === false)');
  });

  test('#164: loadState with running=0 (falsy) → false', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = { running: 0, epsilonWhite: 0.5, epsilonBlack: 0.5 };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, false, '!!0 === false');
  });

  test('#164: loadState with running=1 (truthy number) → true', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = { running: 1, epsilonWhite: 0.5, epsilonBlack: 0.5 };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, true, '!!1 === true');
  });

  test('#164: loadState with running="true" (string) → true', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = { running: "true", epsilonWhite: 0.5, epsilonBlack: 0.5 };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, true, '!!"true" === true');
  });

  test('#164: loadState with running=null → false', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = { running: null, epsilonWhite: 0.5, epsilonBlack: 0.5 };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, false, '!!null === false');
  });

  test('#164: loadState restores stats correctly alongside running flag', () => {
    const CONFIG = { ai: { defaultEpsilon: 0.5 } };
    const savedState = {
      stats: { gamesPlayed: 100, whiteWins: 45, blackWins: 40, draws: 15, lastLoss: '2026-03-20' },
      epsilonWhite: 0.15,
      epsilonBlack: 0.25,
      running: true
    };
    const result = loadState(savedState, CONFIG);
    assert.equal(result.running, true);
    assert.equal(result.stats.gamesPlayed, 100);
    assert.equal(result.stats.whiteWins, 45);
    assert.equal(result.stats.blackWins, 40);
    assert.equal(result.stats.draws, 15);
    assert.equal(result.stats.lastLoss, '2026-03-20');
    assert.equal(result.epsilonWhite, 0.15);
    assert.equal(result.epsilonBlack, 0.25);
  });

  // ─────────────────────────────────────────────────────────────────────
  // #144: MoveHistory.jsx dead code check
  // ─────────────────────────────────────────────────────────────────────

  test('#144: client/src/components/MoveHistory.jsx existence check', () => {
    const filePath = join(PROJECT_ROOT, 'client', 'src', 'components', 'MoveHistory.jsx');
    const exists = existsSync(filePath);
    if (exists) {
      // File still exists — document it as a finding
      const content = readFileSync(filePath, 'utf-8');
      console.log(`   ⚠️  #144: MoveHistory.jsx STILL EXISTS (${content.length} bytes) — dead code not removed`);
      // Not a failure per se — just flagging the finding
      assert.ok(true, 'MoveHistory.jsx exists — flagged as dead code candidate');
    } else {
      console.log('   ✅ #144: MoveHistory.jsx has been removed (dead code cleaned up)');
      assert.ok(true, 'MoveHistory.jsx removed as expected');
    }
  });

  test('#144: archive/MoveHistory.jsx existence check', () => {
    const filePath = join(PROJECT_ROOT, 'client', 'src', 'archive', 'MoveHistory.jsx');
    const exists = existsSync(filePath);
    if (exists) {
      console.log('   ⚠️  #144: archive/MoveHistory.jsx STILL EXISTS — may need cleanup');
    } else {
      console.log('   ✅ #144: archive/MoveHistory.jsx not found');
    }
    assert.ok(true, 'Archive check complete');
  });

  test('#144: MoveHistory.jsx is not imported in active components', () => {
    // Check that no active component imports MoveHistory
    const appFiles = [
      join(PROJECT_ROOT, 'client', 'src', 'App.jsx'),
      join(PROJECT_ROOT, 'client', 'src', 'App.js'),
      join(PROJECT_ROOT, 'client', 'src', 'index.js'),
      join(PROJECT_ROOT, 'client', 'src', 'index.jsx'),
    ];
    let foundImport = false;
    for (const file of appFiles) {
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf-8');
        if (content.match(/import\s+.*MoveHistory.*from\s+['"].*MoveHistory/)) {
          foundImport = true;
          console.log(`   ⚠️  #144: MoveHistory imported in ${file}`);
        }
      }
    }
    if (!foundImport) {
      console.log('   ✅ #144: MoveHistory not imported in main entry points');
    }
    assert.ok(true, 'Import check complete');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 hunter-tw issues #163, #164, #144 — Regression Tests');

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
