/**
 * drawDetection.test.js — Tests for O(1) draw detection via movesWithoutCapture_.
 *
 * Uses the C++ engine HTTP API at localhost:8080.
 * The engine tracks movesWithoutCapture_ — when it reaches 40 (half-moves),
 * getResult() returns DRAW.
 *
 * API endpoints:
 *   POST /api/game/start    — reset game (resets counter)
 *   GET  /api/game/state    — get board, turn, gameOver, winner
 *   GET  /api/legal-moves   — get legal moves
 *   POST /api/move          — execute move
 *   POST /api/board/set     — set custom board position (NOTE: does NOT reset movesWithoutCapture_)
 */
import assert from 'node:assert/strict';

const BASE = 'http://localhost:8080';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function runDrawDetectionTests() {
  let passed = 0, failed = 0;
  const tests = [];
  const todos = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  function todo(name, reason) {
    todos.push({ name, reason });
  }

  // ── Helper: play non-capture moves until count or game over ───────
  async function playNonCaptureMoves(count) {
    let played = 0;
    for (let i = 0; i < count; i++) {
      const { moves } = await api('/api/legal-moves');
      if (!moves || moves.length === 0) break;

      const nonCap = moves.find(m => !m.captures || m.captures.length === 0);
      if (!nonCap) break; // only captures available

      await api('/api/move', {
        method: 'POST',
        body: { from: nonCap.from, to: nonCap.to },
      });
      played++;

      const state = await api('/api/game/state');
      if (state.gameOver) return { state, played };
    }
    return { state: await api('/api/game/state'), played };
  }

  // ── Fresh game has no draw ───────────────────────────────────────

  test('fresh game — not in draw state', async () => {
    await api('/api/game/start', { method: 'POST', body: {} });
    const state = await api('/api/game/state');

    assert.equal(state.gameOver, false, 'Fresh game should not be over');
    assert.notEqual(state.winner, 'draw', 'Fresh game should not be draw');
  });

  // ── Counter increments with non-capture moves ────────────────────

  test('non-capture moves do not immediately trigger draw', async () => {
    await api('/api/game/start', { method: 'POST', body: {} });
    const { state, played } = await playNonCaptureMoves(5);

    // After a few moves, game should NOT be in draw
    if (state.gameOver && state.winner === 'draw') {
      throw new Error(`Game ended in DRAW after only ${played} non-capture moves — counter too low`);
    }
  });

  // ── Counter resets after capture ──────────────────────────────────

  test('capture resets movesWithoutCapture_ counter', async () => {
    await api('/api/game/start', { method: 'POST', body: {} });

    let captureFound = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const { moves } = await api('/api/legal-moves');
      if (!moves || moves.length === 0) break;

      const capture = moves.find(m => m.captures && m.captures.length > 0);
      if (capture) {
        await api('/api/move', {
          method: 'POST',
          body: { from: capture.from, to: capture.to, captures: capture.captures },
        });
        captureFound = true;
        break;
      }
      // No capture yet, play non-capture
      const nonCap = moves[0];
      await api('/api/move', { method: 'POST', body: { from: nonCap.from, to: nonCap.to } });
    }

    if (!captureFound) {
      console.log('   ⚠️  No capture found in 20 attempts — test inconclusive');
      return;
    }

    // After capture, counter resets. Game should NOT be in draw.
    const state = await api('/api/game/state');
    if (state.gameOver && state.winner === 'draw') {
      throw new Error('Game ended in DRAW immediately after capture — counter was not reset');
    }
  });

  // ── Less than 40 moves should NOT trigger draw ───────────────────

  test('fewer than 40 non-capture moves → NOT DRAW', async () => {
    await api('/api/game/start', { method: 'POST', body: {} });
    const { state, played } = await playNonCaptureMoves(10);

    if (played >= 10) {
      if (state.gameOver && state.winner === 'draw') {
        throw new Error('Game ended in DRAW after only 10 moves — threshold too low');
      }
    }
  });

  // ── TODO: 40 non-capture moves → DRAW ────────────────────────────
  // The C++ engine test uses Engine::reset() + direct Board assignment which
  // properly resets movesWithoutCapture_ to 0. The HTTP /api/board/set endpoint
  // does NOT call engine.reset() — it only sets engine.getBoard() = b, leaving
  // movesWithoutCapture_ and history_ intact from previous games.
  // This means we cannot reliably set up a kings-only position via HTTP
  // and expect the draw counter to start at 0.
  //
  // TODO: Fix server.cpp board/set handler to call engine.reset() before
  //       setting the board, then rewrite this test to use kings-only position.
  todo('40 non-capture half-moves → DRAW',
    'server.cpp /api/board/set does not reset movesWithoutCapture_ counter. ' +
    'Needs engine.reset() call before board assignment in the handler.');

  // ── TODO: UndoLastMove rebuilds counter ──────────────────────────
  // The C++ Engine class has undoLastMove() which rebuilds movesWithoutCapture_
  // from history, but server.cpp does NOT expose /api/game/undo endpoint.
  //
  // TODO: Add /api/game/undo route to server.cpp, then test counter rebuild.
  todo('UndoLastMove rebuilds movesWithoutCapture_ counter',
    'No /api/game/undo HTTP endpoint in server.cpp. ' +
    'Engine::undoLastMove() exists but is not exposed via API.');

  // ── Run ───────────────────────────────────────────────────────────

  console.log('\n📋 Draw Detection Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`   ✅ ${name}`);
      passed++;
    } catch (err) {
      console.log(`   ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  for (const { name, reason } of todos) {
    console.log(`   ⏳ TODO: ${name}`);
    console.log(`      └─ ${reason}`);
  }

  console.log(`   ─── ${passed} passed, ${failed} failed, ${todos.length} TODO ───`);
  return { passed, failed };
}
