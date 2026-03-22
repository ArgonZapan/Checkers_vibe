import assert from 'node:assert/strict';
import { SelfPlay } from '../ai/trainer.js';

export async function runTrainerTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // Constructor — default params
  test('constructor — default parameters', () => {
    const trainer = new SelfPlay(null);
    assert.equal(trainer.running, false);
    assert.equal(trainer.epsilonWhite, 0.3);
    assert.equal(trainer.epsilonBlack, 0.3);
    assert.equal(trainer.networkSizeWhite, 'small');
    assert.equal(trainer.networkSizeBlack, 'small');
    assert.equal(trainer.modelWhite, null);
    assert.equal(trainer.modelBlack, null);
    assert.equal(trainer.buffer.size(), 0);
    assert.equal(trainer.stats.gamesPlayed, 0);
  });

  test('constructor — stats object', () => {
    const trainer = new SelfPlay(null);
    assert.equal(trainer.stats.whiteWins, 0);
    assert.equal(trainer.stats.blackWins, 0);
    assert.equal(trainer.stats.draws, 0);
    assert.equal(trainer.stats.lastLoss, null);
  });

  // setParams
  test('setParams — changes epsilon', () => {
    const trainer = new SelfPlay(null);
    trainer.setParams(0.1, undefined, 'white');
    assert.equal(trainer.epsilonWhite, 0.1);
    assert.equal(trainer.epsilonBlack, 0.3); // unchanged
    trainer.setParams(0.05, undefined, 'black');
    assert.equal(trainer.epsilonBlack, 0.05);
  });

  test('setParams — changes epsilon for both', () => {
    const trainer = new SelfPlay(null);
    trainer.setParams(0.2, undefined, 'both');
    assert.equal(trainer.epsilonWhite, 0.2);
    assert.equal(trainer.epsilonBlack, 0.2);
  });

  test('setParams — changes networkSize and creates model', () => {
    const trainer = new SelfPlay(null);
    trainer.setParams(undefined, 'medium', 'white');
    assert.equal(trainer.networkSizeWhite, 'medium');
    assert.ok(trainer.modelWhite !== null);
    assert.equal(trainer.modelBlack, null);
  });

  test('setParams — updates stats epsilon', () => {
    const trainer = new SelfPlay(null);
    trainer.setParams(0.15, undefined, 'both');
    assert.equal(trainer.stats.epsilonWhite, 0.15);
    assert.equal(trainer.stats.epsilonBlack, 0.15);
  });

  // start / stop
  test('start — sets running to true', async () => {
    const trainer = new SelfPlay(null);
    // Override _loop to prevent actual game loop
    trainer._loop = async () => { /* no-op */ };
    await trainer.start();
    assert.equal(trainer.running, true);
    trainer.stop();
  });

  test('stop — sets running to false', async () => {
    const trainer = new SelfPlay(null);
    trainer._loop = async () => { /* no-op */ };
    await trainer.start();
    assert.equal(trainer.running, true);
    trainer.stop();
    assert.equal(trainer.running, false);
  });

  test('start — double start is safe', async () => {
    const trainer = new SelfPlay(null);
    let loopCount = 0;
    trainer._loop = async () => { loopCount++; };
    await trainer.start();
    await trainer.start(); // should be ignored
    assert.equal(loopCount, 1);
    trainer.stop();
  });

  // getStatus
  test('getStatus — returns correct structure', () => {
    const trainer = new SelfPlay(null);
    const status = trainer.getStatus();
    assert.equal(status.running, false);
    assert.ok(status.stats);
    assert.equal(status.bufferSize, 0);
    assert.equal(status.networkSizeWhite, 'small');
    assert.equal(status.networkSizeBlack, 'small');
  });

  // restart
  test('restart — resets stats for "both"', async () => {
    const trainer = new SelfPlay(null);
    trainer.stats.gamesPlayed = 10;
    trainer.stats.draws = 3;
    trainer.buffer.add('test');
    await trainer.restart('both');
    assert.equal(trainer.stats.gamesPlayed, 0);
    assert.equal(trainer.stats.draws, 0);
    assert.equal(trainer.buffer.size(), 0);
    assert.equal(trainer.epsilonWhite, 0.3);
    assert.equal(trainer.epsilonBlack, 0.3);
  });

  test('restart — white only resets white wins', async () => {
    const trainer = new SelfPlay(null);
    trainer.stats.gamesPlayed = 5;
    trainer.stats.whiteWins = 3;
    trainer.stats.blackWins = 2;
    await trainer.restart('white');
    assert.equal(trainer.stats.whiteWins, 0);
    assert.equal(trainer.stats.blackWins, 2); // unchanged
    assert.equal(trainer.stats.gamesPlayed, 5); // unchanged
  });

  // Run
  console.log('\n── trainer.test.js ─────────────────────────');
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
