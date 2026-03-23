import assert from 'node:assert/strict';
import { SelfPlay } from '../ai/trainer.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

// Minimal legal moves for testing
const SAMPLE_LEGAL_MOVES = [
  { from: 8, to: 12, index: 0 },
  { from: 9, to: 13, index: 1 },
  { from: 10, to: 14, index: 2 },
  { from: 11, to: 15, index: 3 },
];

// Valid board (8x8 flat 64)
const SAMPLE_BOARD = new Array(64).fill(0);
// White pawns on row 1 (indices 8-15)
for (let i = 8; i < 16; i++) SAMPLE_BOARD[i] = 1;
// Black pawns on row 6 (indices 48-55)
for (let i = 48; i < 56; i++) SAMPLE_BOARD[i] = 3;

export async function runMoveValidationTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── _validateAndFallback tests ──────────────────────────────────────────

  test('_validateAndFallback — valid move by index passes through', () => {
    const trainer = new SelfPlay(null);
    const chosen = 2; // index into legalMoves
    const result = trainer._validateAndFallback(chosen, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.equal(result.from, 10);
    assert.equal(result.to, 14);
  });

  test('_validateAndFallback — valid move object passes through', () => {
    const trainer = new SelfPlay(null);
    const chosen = { from: 9, to: 13, index: 1 };
    const result = trainer._validateAndFallback(chosen, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.equal(result.from, 9);
    assert.equal(result.to, 13);
  });

  test('_validateAndFallback — null chosenMove falls back to random', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(null, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(result.from >= 0 && result.from <= 63);
    assert.ok(result.to >= 0 && result.to <= 63);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — undefined chosenMove falls back to random', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(undefined, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — out-of-bounds index falls back to random', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(999, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — negative index falls back to random', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(-1, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — NaN index falls back to random', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(NaN, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — move with from/to out of range falls back', () => {
    const trainer = new SelfPlay(null);
    const badMove = { from: -5, to: 999 };
    const result = trainer._validateAndFallback(badMove, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — move with from===to falls back', () => {
    const trainer = new SelfPlay(null);
    const badMove = { from: 12, to: 12 };
    const result = trainer._validateAndFallback(badMove, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — move not in legal list falls back', () => {
    const trainer = new SelfPlay(null);
    const illegalMove = { from: 0, to: 4 }; // valid coords but not in legal moves
    const result = trainer._validateAndFallback(illegalMove, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — empty legalMoves returns null', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback(0, []);
    assert.equal(result, null);
  });

  test('_validateAndFallback — string chosenMove falls back', () => {
    const trainer = new SelfPlay(null);
    const result = trainer._validateAndFallback('bad', SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  test('_validateAndFallback — object with non-numeric from/to falls back', () => {
    const trainer = new SelfPlay(null);
    const badMove = { from: 'a', to: 'b' };
    const result = trainer._validateAndFallback(badMove, SAMPLE_LEGAL_MOVES);
    assert.ok(result);
    assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === result.from && m.to === result.to));
  });

  // ── _randomLegalMove tests ──────────────────────────────────────────────

  test('_randomLegalMove — returns a valid move from the list', () => {
    const trainer = new SelfPlay(null);
    for (let i = 0; i < 20; i++) {
      const move = trainer._randomLegalMove(SAMPLE_LEGAL_MOVES);
      assert.ok(move);
      assert.ok(SAMPLE_LEGAL_MOVES.some(m => m.from === move.from && m.to === move.to));
    }
  });

  test('_randomLegalMove — returns null for empty list', () => {
    const trainer = new SelfPlay(null);
    const move = trainer._randomLegalMove([]);
    assert.equal(move, null);
  });

  test('_randomLegalMove — returns null for null input', () => {
    const trainer = new SelfPlay(null);
    const move = trainer._randomLegalMove(null);
    assert.equal(move, null);
  });

  // ── Engine health check tests ───────────────────────────────────────────

  test('isEngineUp — returns boolean without throwing', async () => {
    const trainer = new SelfPlay(null);
    // Engine is likely not running in test, so should return false
    const result = await trainer.isEngineUp();
    assert.equal(typeof result, 'boolean');
  });

  // Run
  console.log('\n── move-validation.test.js ─────────────────────────');
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  return { passed, failed };
}
