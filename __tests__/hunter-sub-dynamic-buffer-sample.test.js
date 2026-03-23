/**
 * Regression test: ReplayBuffer.sample() must never return undefined elements.
 *
 * Bug: when buffer.count < maxSize, the ring buffer has undefined slots.
 * The shuffle uses indices 0..count-1, which when mapped through (start + i) % maxSize
 * with start=0 (not-full buffer) maps correctly. The real issue is ensuring the
 * Fisher-Yates shuffle only selects from valid indices.
 */
import assert from 'node:assert/strict';
import { ReplayBuffer } from '../server/ai/buffer.js';

export async function runBufferSampleTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  test('sample from partially filled buffer returns only defined elements', () => {
    const buf = new ReplayBuffer(10000);
    for (let i = 0; i < 50; i++) {
      buf.add({ id: i, value: `sample-${i}` });
    }
    for (let trial = 0; trial < 20; trial++) {
      const samples = buf.sample(20);
      assert.equal(samples.length, 20);
      for (const s of samples) {
        assert.ok(s !== undefined && s !== null, 'sample must not be undefined/null');
        assert.ok(typeof s.id === 'number' && s.id >= 0 && s.id < 50,
          `sample.id should be 0-49, got ${s.id}`);
      }
    }
  });

  test('sample from nearly empty buffer (1 element)', () => {
    const buf = new ReplayBuffer(10000);
    buf.add({ id: 0, value: 'only-one' });
    const samples = buf.sample(1);
    assert.equal(samples.length, 1);
    assert.ok(samples[0] !== undefined);
    assert.equal(samples[0].id, 0);
  });

  test('sample from full buffer (wrapped around) returns valid elements', () => {
    const buf = new ReplayBuffer(100);
    for (let i = 0; i < 130; i++) {
      buf.add({ id: i, value: `sample-${i}` });
    }
    assert.equal(buf.size(), 100);
    for (let trial = 0; trial < 20; trial++) {
      const samples = buf.sample(50);
      assert.equal(samples.length, 50);
      for (const s of samples) {
        assert.ok(s !== undefined && s !== null, 'sample must not be undefined/null');
        assert.ok(s.id >= 30 && s.id < 130,
          `Full buffer sample.id should be 30-129, got ${s.id}`);
      }
    }
  });

  test('sample returns correct count (capped at buffer size)', () => {
    const buf = new ReplayBuffer(10000);
    for (let i = 0; i < 10; i++) buf.add({ id: i });
    assert.equal(buf.sample(5).length, 5);
    assert.equal(buf.sample(10).length, 10);
    assert.equal(buf.sample(100).length, 10); // capped at count
  });

  test('sample returns empty array for empty buffer', () => {
    const buf = new ReplayBuffer(10000);
    assert.deepEqual(buf.sample(5), []);
  });

  test('sample after clear returns empty', () => {
    const buf = new ReplayBuffer(100);
    for (let i = 0; i < 50; i++) buf.add({ id: i });
    buf.clear();
    assert.equal(buf.size(), 0);
    assert.deepEqual(buf.sample(10), []);
  });

  test('sample from buffer at exactly maxSize (just filled)', () => {
    const buf = new ReplayBuffer(10);
    for (let i = 0; i < 10; i++) buf.add({ id: i });
    assert.equal(buf.size(), 10);
    for (let trial = 0; trial < 10; trial++) {
      const samples = buf.sample(5);
      assert.equal(samples.length, 5);
      for (const s of samples) {
        assert.ok(s !== undefined && s !== null);
        assert.ok(s.id >= 0 && s.id < 10);
      }
    }
  });

  console.log('\n📋 ReplayBuffer Sample — No Undefined Elements Tests');

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
