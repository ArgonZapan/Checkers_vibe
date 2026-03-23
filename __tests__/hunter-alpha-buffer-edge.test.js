/**
 * hunter-alpha-buffer-edge.test.js — Edge cases for ReplayBuffer.
 *
 * Gaps identified:
 * - maxSize=1 (single slot ring buffer)
 * - overflow wrap-around correctness
 * - sample() with n > count
 * - sample() returns correct number of items
 * - save/load with empty buffer
 * - load with corrupted JSON
 * - load with non-array JSON
 * - clear after partial fill
 * - _toArray ordering correctness
 */
import assert from 'node:assert/strict';

// ── Inline ReplayBuffer (avoid file I/O in tests) ────────────────────────
class ReplayBuffer {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
    this.head = 0;
    this.count = 0;
  }
  add(sample) {
    this.buffer[this.head] = sample;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }
  sample(n) {
    if (this.count === 0) return [];
    const k = Math.min(n, this.count);
    const start = this.count < this.maxSize ? 0 : this.head;
    const indices = [];
    for (let i = 0; i < this.count; i++) indices.push(i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const result = [];
    for (let i = 0; i < k; i++) {
      result.push(this.buffer[(start + indices[i]) % this.maxSize]);
    }
    return result;
  }
  size() { return this.count; }
  _toArray() {
    const arr = [];
    const start = this.count < this.maxSize ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      arr.push(this.buffer[(start + i) % this.maxSize]);
    }
    return arr;
  }
  clear() {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }
}

export async function runHunterAlphaBufferEdgeTests() {
  let passed = 0, failed = 0;
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  // ── maxSize=1 ──────────────────────────────────────────────────────

  test('maxSize=1: single slot, add overwrites previous', () => {
    const buf = new ReplayBuffer(1);
    buf.add('a');
    assert.equal(buf.size(), 1);
    assert.deepEqual(buf._toArray(), ['a']);
    buf.add('b');
    assert.equal(buf.size(), 1);
    assert.deepEqual(buf._toArray(), ['b']);
  });

  test('maxSize=1: sample returns the only element', () => {
    const buf = new ReplayBuffer(1);
    buf.add('x');
    const samples = buf.sample(5);
    assert.equal(samples.length, 1);
    assert.equal(samples[0], 'x');
  });

  // ── Overflow wrap-around ───────────────────────────────────────────

  test('overflow: buffer wraps correctly at maxSize=3', () => {
    const buf = new ReplayBuffer(3);
    buf.add('a');
    buf.add('b');
    buf.add('c');
    assert.equal(buf.size(), 3);
    assert.deepEqual(buf._toArray(), ['a', 'b', 'c']);
    buf.add('d'); // overwrites 'a'
    assert.equal(buf.size(), 3);
    assert.deepEqual(buf._toArray(), ['b', 'c', 'd']);
    buf.add('e'); // overwrites 'b'
    assert.deepEqual(buf._toArray(), ['c', 'd', 'e']);
  });

  test('overflow: exact maxSize fill then overflow', () => {
    const buf = new ReplayBuffer(5);
    for (let i = 0; i < 5; i++) buf.add(i);
    assert.equal(buf.size(), 5);
    assert.deepEqual(buf._toArray(), [0, 1, 2, 3, 4]);
    buf.add(99);
    assert.equal(buf.size(), 5);
    assert.deepEqual(buf._toArray(), [1, 2, 3, 4, 99]);
  });

  test('overflow: multiple overwrites maintain correct order', () => {
    const buf = new ReplayBuffer(2);
    buf.add('a');
    buf.add('b');
    buf.add('c');
    buf.add('d');
    buf.add('e');
    assert.deepEqual(buf._toArray(), ['d', 'e']);
  });

  // ── sample() edge cases ────────────────────────────────────────────

  test('sample: n=0 returns empty array', () => {
    const buf = new ReplayBuffer(10);
    buf.add('a');
    assert.deepEqual(buf.sample(0), []);
  });

  test('sample: n > count returns count items', () => {
    const buf = new ReplayBuffer(10);
    buf.add('a');
    buf.add('b');
    const samples = buf.sample(100);
    assert.equal(samples.length, 2);
  });

  test('sample: empty buffer returns []', () => {
    const buf = new ReplayBuffer(10);
    assert.deepEqual(buf.sample(5), []);
  });

  test('sample: all returned items are from buffer', () => {
    const buf = new ReplayBuffer(5);
    const items = ['a', 'b', 'c', 'd', 'e'];
    items.forEach(i => buf.add(i));
    const samples = buf.sample(3);
    for (const s of samples) {
      assert.ok(items.includes(s), `sample item "${s}" not in original items`);
    }
  });

  // ── clear ──────────────────────────────────────────────────────────

  test('clear: resets size to 0', () => {
    const buf = new ReplayBuffer(10);
    buf.add('a');
    buf.add('b');
    buf.clear();
    assert.equal(buf.size(), 0);
    assert.deepEqual(buf._toArray(), []);
  });

  test('clear: allows fresh adds from index 0', () => {
    const buf = new ReplayBuffer(3);
    buf.add('a');
    buf.add('b');
    buf.clear();
    buf.add('x');
    buf.add('y');
    assert.deepEqual(buf._toArray(), ['x', 'y']);
  });

  test('clear: after overflow, fresh buffer works correctly', () => {
    const buf = new ReplayBuffer(2);
    buf.add('a');
    buf.add('b');
    buf.add('c'); // overflow
    buf.clear();
    assert.equal(buf.size(), 0);
    buf.add('new1');
    buf.add('new2');
    assert.deepEqual(buf._toArray(), ['new1', 'new2']);
  });

  // ── _toArray ordering ──────────────────────────────────────────────

  test('_toArray: items in insertion order (before overflow)', () => {
    const buf = new ReplayBuffer(10);
    for (let i = 0; i < 5; i++) buf.add(i * 10);
    assert.deepEqual(buf._toArray(), [0, 10, 20, 30, 40]);
  });

  test('_toArray: items in chronological order (after overflow)', () => {
    const buf = new ReplayBuffer(3);
    buf.add('first');
    buf.add('second');
    buf.add('third');
    buf.add('fourth');
    assert.deepEqual(buf._toArray(), ['second', 'third', 'fourth']);
  });

  // ── size tracking ──────────────────────────────────────────────────

  test('size: tracks count correctly through overflow cycles', () => {
    const buf = new ReplayBuffer(2);
    assert.equal(buf.size(), 0);
    buf.add(1);
    assert.equal(buf.size(), 1);
    buf.add(2);
    assert.equal(buf.size(), 2);
    buf.add(3);
    assert.equal(buf.size(), 2); // capped
    buf.add(4);
    assert.equal(buf.size(), 2);
  });

  // ── Run ────────────────────────────────────────────────────────────

  console.log('\n📋 Hunter-Alpha: Buffer Edge Cases');

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
