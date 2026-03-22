import assert from 'node:assert/strict';
import { ReplayBuffer } from '../ai/buffer.js';

export async function runBufferTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // add + size
  test('add + size', () => {
    const buf = new ReplayBuffer(100);
    assert.equal(buf.size(), 0);
    buf.add({ a: 1 });
    assert.equal(buf.size(), 1);
    buf.add({ b: 2 });
    buf.add({ c: 3 });
    assert.equal(buf.size(), 3);
  });

  // maxSize (FIFO)
  test('maxSize — oldest entries removed when full', () => {
    const buf = new ReplayBuffer(5);
    for (let i = 0; i < 5; i++) buf.add({ id: i });
    assert.equal(buf.size(), 5);
    buf.add({ id: 99 });
    assert.equal(buf.size(), 5);
    // First element should now be id:1, not id:0
    assert.equal(buf.buffer[0].id, 1);
    assert.equal(buf.buffer[4].id, 99);
  });

  // sample
  test('sample — returns n elements', () => {
    const buf = new ReplayBuffer(100);
    for (let i = 0; i < 20; i++) buf.add({ id: i });
    const s = buf.sample(5);
    assert.equal(s.length, 5);
    // All should be valid items from buffer
    for (const item of s) {
      assert.ok(item.id >= 0 && item.id < 20);
    }
  });

  test('sample — returns empty on empty buffer', () => {
    const buf = new ReplayBuffer(100);
    const s = buf.sample(5);
    assert.deepEqual(s, []);
  });

  test('sample — clamps to buffer size', () => {
    const buf = new ReplayBuffer(100);
    buf.add('a');
    buf.add('b');
    const s = buf.sample(10);
    assert.equal(s.length, 2);
  });

  // save / load
  test('save + load — roundtrip', async () => {
    const buf = new ReplayBuffer(100);
    buf.add({ board: [1, 2, 3], result: 1 });
    buf.add({ board: [4, 5, 6], result: -1 });
    const testPath = '/tmp/test-buffer.json';
    await buf.save(testPath);

    const buf2 = new ReplayBuffer(100);
    await buf2.load(testPath);
    assert.equal(buf2.size(), 2);
    assert.deepEqual(buf2.buffer[0], { board: [1, 2, 3], result: 1 });
    assert.deepEqual(buf2.buffer[1], { board: [4, 5, 6], result: -1 });
  });

  test('load — missing file starts fresh', async () => {
    const buf = new ReplayBuffer(100);
    buf.add('old');
    await buf.load('/tmp/test-buffer-nonexistent.json');
    assert.equal(buf.size(), 0);
  });

  // clear
  test('clear — empties buffer', () => {
    const buf = new ReplayBuffer(100);
    buf.add('x');
    buf.add('y');
    assert.equal(buf.size(), 2);
    buf.clear();
    assert.equal(buf.size(), 0);
  });

  // Run tests
  console.log('\n── buffer.test.js ──────────────────────────');
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
