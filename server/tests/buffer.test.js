import assert from 'node:assert/strict';
import { ReplayBuffer } from '../ai/buffer.js';

import { describe, it } from '@jest/globals';

describe('Buffer', () => {


  // add + size
  it('add + size', () => {
    const buf = new ReplayBuffer(100);
    assert.equal(buf.size(), 0);
    buf.add({ a: 1 });
    assert.equal(buf.size(), 1);
    buf.add({ b: 2 });
    buf.add({ c: 3 });
    assert.equal(buf.size(), 3);
  });

  // maxSize (FIFO)
  it('maxSize — oldest entries removed when full', () => {
    const buf = new ReplayBuffer(5);
    for (let i = 0; i < 5; i++) buf.add({ id: i });
    assert.equal(buf.size(), 5);
    buf.add({ id: 99 });
    assert.equal(buf.size(), 5);
    // First element should now be id:1, not id:0
    const arr = buf._toArray();
    assert.equal(arr[0].id, 1);
    assert.equal(arr[4].id, 99);
  });

  // sample
  it('sample — returns n elements', () => {
    const buf = new ReplayBuffer(100);
    for (let i = 0; i < 20; i++) buf.add({ id: i });
    const s = buf.sample(5);
    assert.equal(s.length, 5);
    // All should be valid items from buffer
    for (const item of s) {
      assert.ok(item.id >= 0 && item.id < 20);
    }
  });

  it('sample — returns empty on empty buffer', () => {
    const buf = new ReplayBuffer(100);
    const s = buf.sample(5);
    assert.deepEqual(s, []);
  });

  it('sample — clamps to buffer size', () => {
    const buf = new ReplayBuffer(100);
    buf.add('a');
    buf.add('b');
    const s = buf.sample(10);
    assert.equal(s.length, 2);
  });

  // save / load
  it('save + load — roundtrip', async () => {
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

  it('load — missing file starts fresh', async () => {
    const buf = new ReplayBuffer(100);
    buf.add('old');
    await buf.load('/tmp/test-buffer-nonexistent.json');
    assert.equal(buf.size(), 0);
  });

  // clear
  it('clear — empties buffer', () => {
    const buf = new ReplayBuffer(100);
    buf.add('x');
    buf.add('y');
    assert.equal(buf.size(), 2);
    buf.clear();
    assert.equal(buf.size(), 0);
  });

  // Run tests

}
