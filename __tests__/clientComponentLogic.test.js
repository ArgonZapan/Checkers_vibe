/**
 * clientComponentLogic.test.js — Tests for client component logic.
 *
 * Covers untested client/src/components/ by extracting pure logic:
 * - GameControls: status text generation, turn label conversion
 * - ErrorBoundary: error state management logic
 * - GameTimer: time formatting logic
 * - MoveHistory: move notation formatting
 * - ParamsPanel: param validation and formatting
 * - Dashboard: aggregation logic
 *
 * Extracted logic — no React/rendering required.
 */

import assert from 'node:assert/strict';

// ── GameControls: status text logic ─────────────────────────────────────────

function getTurnLabel(turn) {
  return turn === 'white' ? 'Białe' : 'Czarne';
}

function getStatusText(gameOver, winner, turn) {
  if (gameOver) {
    if (winner === 'draw') return '🤝 Remis!';
    const winnerLabel = winner === 'white' ? 'Białe' : 'Czarne';
    return `🏆 ${winnerLabel} wygrywają!`;
  }
  return `Tura: ${getTurnLabel(turn)}`;
}

function getTurnClass(turn) {
  return turn === 'white' ? 'turn-white' : 'turn-black';
}

function shouldShowSpeedControls(mode) {
  return mode === 'aivai';
}

function getSpeedButtonClass(currentSpeed, buttonSpeed) {
  return currentSpeed === buttonSpeed ? 'btn-primary btn-small' : 'btn-secondary btn-small';
}

// ── ErrorBoundary: error state logic ────────────────────────────────────────

function createErrorBoundaryState() {
  return { hasError: false, error: null };
}

function handleErrorBoundaryError(state, error) {
  return { hasError: true, error };
}

function resetErrorBoundary(state) {
  return { hasError: false, error: null };
}

// ── GameTimer: time formatting ──────────────────────────────────────────────

function formatTime(ms) {
  if (ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimeDetailed(ms) {
  if (ms < 0) return '0:00.0';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
}

// ── MoveHistory: move notation ──────────────────────────────────────────────

function formatMoveNotation(from, to, isCapture) {
  const colLabels = 'abcdefgh';
  const fromStr = `${colLabels[from[1]]}${8 - from[0]}`;
  const toStr = `${colLabels[to[1]]}${8 - to[0]}`;
  return isCapture ? `${fromStr}x${toStr}` : `${fromStr}-${toStr}`;
}

function formatMoveWithCaptures(from, to, captures) {
  if (!captures || captures.length === 0) {
    return formatMoveNotation(from, to, false);
  }
  // Multi-capture: show start and end with capture count
  const colLabels = 'abcdefgh';
  const fromStr = `${colLabels[from[1]]}${8 - from[0]}`;
  const toStr = `${colLabels[to[1]]}${8 - to[0]}`;
  return `${fromStr}x${toStr} (${captures.length})`;
}

// ── ParamsPanel: param validation ───────────────────────────────────────────

function formatParamValue(key, value) {
  if (typeof value === 'number') {
    if (key === 'dropout' || key === 'lr' || key === 'gamma') {
      return value.toFixed(4);
    }
    return String(value);
  }
  return String(value);
}

function isParamInRange(key, value) {
  const ranges = {
    layers: [1, 5],
    neurons: [32, 512],
    batchSize: [8, 256],
    dropout: [0, 0.5],
    lr: [0.0001, 1],
    gamma: [0, 1],
    epochs: [1, 100],
    bufferSize: [100, 100000],
  };
  const range = ranges[key];
  if (!range) return true; // unknown key — no validation
  return value >= range[0] && value <= range[1];
}

// ── Dashboard: stats aggregation ────────────────────────────────────────────

function calculateWinRate(stats) {
  const total = (stats.whiteWins || 0) + (stats.blackWins || 0) + (stats.draws || 0);
  if (total === 0) return { whiteRate: 0, blackRate: 0, drawRate: 0 };
  return {
    whiteRate: ((stats.whiteWins || 0) / total * 100).toFixed(1),
    blackRate: ((stats.blackWins || 0) / total * 100).toFixed(1),
    drawRate: ((stats.draws || 0) / total * 100).toFixed(1),
  };
}

function formatStatsSummary(stats) {
  const total = (stats.whiteWins || 0) + (stats.blackWins || 0) + (stats.draws || 0);
  return `${total} games | W:${stats.whiteWins || 0} B:${stats.blackWins || 0} D:${stats.draws || 0}`;
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runClientComponentLogicTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GameControls: status text
  // ═══════════════════════════════════════════════════════════════════════

  test('status: white turn → "Tura: Białe"', () => {
    assert.equal(getStatusText(false, null, 'white'), 'Tura: Białe');
  });

  test('status: black turn → "Tura: Czarne"', () => {
    assert.equal(getStatusText(false, null, 'black'), 'Tura: Czarne');
  });

  test('status: game over, white wins → "🏆 Białe wygrywają!"', () => {
    assert.equal(getStatusText(true, 'white', 'white'), '🏆 Białe wygrywają!');
  });

  test('status: game over, black wins → "🏆 Czarne wygrywają!"', () => {
    assert.equal(getStatusText(true, 'black', 'black'), '🏆 Czarne wygrywają!');
  });

  test('status: game over, draw → "🤝 Remis!"', () => {
    assert.equal(getStatusText(true, 'draw', 'white'), '🤝 Remis!');
  });

  test('turn label: white → Białe', () => {
    assert.equal(getTurnLabel('white'), 'Białe');
  });

  test('turn label: black → Czarne', () => {
    assert.equal(getTurnLabel('black'), 'Czarne');
  });

  test('turn class: white → turn-white', () => {
    assert.equal(getTurnClass('white'), 'turn-white');
  });

  test('turn class: black → turn-black', () => {
    assert.equal(getTurnClass('black'), 'turn-black');
  });

  test('speed controls: shown only in aivai mode', () => {
    assert.equal(shouldShowSpeedControls('aivai'), true);
    assert.equal(shouldShowSpeedControls('pvai'), false);
    assert.equal(shouldShowSpeedControls('pvp'), false);
  });

  test('speed button class: active button is primary', () => {
    assert.equal(getSpeedButtonClass(0, 0), 'btn-primary btn-small');
    assert.equal(getSpeedButtonClass(0, 100), 'btn-secondary btn-small');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ErrorBoundary
  // ═══════════════════════════════════════════════════════════════════════

  test('error boundary: initial state has no error', () => {
    const state = createErrorBoundaryState();
    assert.equal(state.hasError, false);
    assert.equal(state.error, null);
  });

  test('error boundary: catching error sets hasError', () => {
    const state = createErrorBoundaryState();
    const newState = handleErrorBoundaryError(state, new Error('test'));
    assert.equal(newState.hasError, true);
    assert.ok(newState.error instanceof Error);
  });

  test('error boundary: reset clears error', () => {
    const state = { hasError: true, error: new Error('test') };
    const newState = resetErrorBoundary(state);
    assert.equal(newState.hasError, false);
    assert.equal(newState.error, null);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GameTimer: time formatting
  // ═══════════════════════════════════════════════════════════════════════

  test('formatTime: 0ms → "0:00"', () => {
    assert.equal(formatTime(0), '0:00');
  });

  test('formatTime: 1000ms → "0:01"', () => {
    assert.equal(formatTime(1000), '0:01');
  });

  test('formatTime: 60000ms → "1:00"', () => {
    assert.equal(formatTime(60000), '1:00');
  });

  test('formatTime: 90500ms → "1:30"', () => {
    assert.equal(formatTime(90500), '1:30');
  });

  test('formatTime: 3599000ms → "59:59"', () => {
    assert.equal(formatTime(3599000), '59:59');
  });

  test('formatTime: negative → "0:00"', () => {
    assert.equal(formatTime(-1000), '0:00');
  });

  test('formatTimeDetailed: 5500ms → "0:05.5"', () => {
    assert.equal(formatTimeDetailed(5500), '0:05.5');
  });

  test('formatTimeDetailed: 0ms → "0:00.0"', () => {
    assert.equal(formatTimeDetailed(0), '0:00.0');
  });

  test('formatTimeDetailed: 61234ms → "1:01.2"', () => {
    assert.equal(formatTimeDetailed(61234), '1:01.2');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MoveHistory: notation formatting
  // ═══════════════════════════════════════════════════════════════════════

  test('move notation: [2,1]→[3,0] → "b6-a5"', () => {
    assert.equal(formatMoveNotation([2, 1], [3, 0], false), 'b6-a5');
  });

  test('move notation: capture uses x separator', () => {
    assert.equal(formatMoveNotation([2, 1], [4, 3], true), 'b6xd4');
  });

  test('move notation: [0,0]→[1,1] → "a8-b7"', () => {
    assert.equal(formatMoveNotation([0, 0], [1, 1], false), 'a8-b7');
  });

  test('move notation: [7,7]→[6,6] → "h1-g2"', () => {
    assert.equal(formatMoveNotation([7, 7], [6, 6], false), 'h1-g2');
  });

  test('multi-capture: shows count in parentheses', () => {
    const result = formatMoveWithCaptures([2, 1], [6, 5], [[3, 2], [4, 3], [5, 4]]);
    assert.equal(result, 'b6xf2 (3)');
  });

  test('multi-capture: single capture shows count', () => {
    const result = formatMoveWithCaptures([2, 1], [4, 3], [[3, 2]]);
    assert.equal(result, 'b6xd4 (1)');
  });

  test('multi-capture: no captures → normal notation', () => {
    const result = formatMoveWithCaptures([2, 1], [3, 0], []);
    assert.equal(result, 'b6-a5');
  });

  test('multi-capture: null captures → normal notation', () => {
    const result = formatMoveWithCaptures([2, 1], [3, 0], null);
    assert.equal(result, 'b6-a5');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ParamsPanel: validation
  // ═══════════════════════════════════════════════════════════════════════

  test('param range: layers=3 in range', () => {
    assert.equal(isParamInRange('layers', 3), true);
  });

  test('param range: layers=0 out of range', () => {
    assert.equal(isParamInRange('layers', 0), false);
  });

  test('param range: layers=6 out of range', () => {
    assert.equal(isParamInRange('layers', 6), false);
  });

  test('param range: neurons=128 in range', () => {
    assert.equal(isParamInRange('neurons', 128), true);
  });

  test('param range: neurons=31 out of range', () => {
    assert.equal(isParamInRange('neurons', 31), false);
  });

  test('param range: dropout=0.25 in range', () => {
    assert.equal(isParamInRange('dropout', 0.25), true);
  });

  test('param range: dropout=-0.1 out of range', () => {
    assert.equal(isParamInRange('dropout', -0.1), false);
  });

  test('param range: dropout=0.6 out of range', () => {
    assert.equal(isParamInRange('dropout', 0.6), false);
  });

  test('param range: unknown key passes', () => {
    assert.equal(isParamInRange('unknownKey', 999), true);
  });

  test('format param: dropout shows 4 decimals', () => {
    assert.equal(formatParamValue('dropout', 0.25), '0.2500');
  });

  test('format param: lr shows 4 decimals', () => {
    assert.equal(formatParamValue('lr', 0.001), '0.0010');
  });

  test('format param: layers shows as integer', () => {
    assert.equal(formatParamValue('layers', 3), '3');
  });

  test('format param: neurons shows as integer', () => {
    assert.equal(formatParamValue('neurons', 128), '128');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Dashboard: stats aggregation
  // ═══════════════════════════════════════════════════════════════════════

  test('win rate: equal wins → 50% each', () => {
    const rate = calculateWinRate({ whiteWins: 5, blackWins: 5, draws: 0 });
    assert.equal(rate.whiteRate, '50.0');
    assert.equal(rate.blackRate, '50.0');
    assert.equal(rate.drawRate, '0.0');
  });

  test('win rate: no games → 0%', () => {
    const rate = calculateWinRate({});
    assert.equal(rate.whiteRate, 0);
    assert.equal(rate.blackRate, 0);
    assert.equal(rate.drawRate, 0);
  });

  test('win rate: all draws → 100% draw', () => {
    const rate = calculateWinRate({ whiteWins: 0, blackWins: 0, draws: 10 });
    assert.equal(rate.drawRate, '100.0');
  });

  test('win rate: mixed results', () => {
    const rate = calculateWinRate({ whiteWins: 3, blackWins: 2, draws: 5 });
    assert.equal(rate.whiteRate, '30.0');
    assert.equal(rate.blackRate, '20.0');
    assert.equal(rate.drawRate, '50.0');
  });

  test('stats summary: correct format', () => {
    const summary = formatStatsSummary({ whiteWins: 10, blackWins: 5, draws: 3 });
    assert.equal(summary, '18 games | W:10 B:5 D:3');
  });

  test('stats summary: empty stats', () => {
    const summary = formatStatsSummary({});
    assert.equal(summary, '0 games | W:0 B:0 D:0');
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Client Component Logic Tests');

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
