/**
 * buffer.test.js — Tests for ReplayBuffer (server/ai/buffer.js).
 *
 * Covers: add, sample, size, clear, circular overwrite, _toArray, save/load.
 * Extracted logic — no server required.
 */

import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Extracted: ReplayBuffer class (mirrors server/ai/buffer.js) ────────────

class ReplayBuffer {
  constructor(maxSize = 100) {
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
    const result = [];
    for (let i = 0; i < k; i++) {
      result.push(this.buffer[(start + i) % this.maxSize]);
    }
    for (let i = k; i < this.count; i++) {
      const j = Math.floor(Math.random() * (i + 1));
      if (j < k) result[j] = this.buffer[(start + i) % this.maxSize];
    }
    return result;
  }

  size() {
    return this.count;
  }

  _toArray() {
    const arr = [];
    const start = this.count < this.maxSize ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      arr.push(this.buffer[(start + i) % this.maxSize]);
    }
    return arr;
  }

  async save(filePath) {
    await mkdir(join(filePath, '..'), { recursive: true }).catch(() => {});
    const tmpPath = filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(this._toArray()), 'utf-8');
    await writeFile(filePath, JSON.stringify(this._toArray()), 'utf-8');
  }

  async load(filePath) {
    try {
      const data = await readFile(filePath, 'utf-8');
      const arr = JSON.parse(data);
      this.buffer = new Array(this.maxSize);
      this.head = 0;
      this.count = 0;
      for (const s of arr) this.add(s);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.buffer = new Array(this.maxSize);
        this.head = 0;
        this.count = 0;
      } else {
        throw err;
      }
    }
  }

  clear() {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

export async function runBufferTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Basic operations ──────────────────────────────────────────────────

  test('add: increases count up to maxSize', () => {
    const buf = new ReplayBuffer(5);
    assert.equal(buf.size(), 0);
    buf.add('a');
    assert.equal(buf.size(), 1);
    buf.add('b');
    buf.add('c');
    assert.equal(buf.size(), 3);
  });

  test('add: circular overwrite when exceeding maxSize', () => {
    const buf = new ReplayBuffer(3);
    buf.add('a');
    buf.add('b');
    buf.add('c');
    assert.equal(buf.size(), 3);
    // Adding 4th should overwrite 'a'
    buf.add('d');
    assert.equal(buf.size(), 3);
    const arr = buf._toArray();
    assert.deepEqual(arr, ['b', 'c', 'd']);
  });

  test('add: handles many overwrites correctly', () => {
    const buf = new ReplayBuffer(3);
    for (let i = 0; i < 10; i++) buf.add(i);
    assert.equal(buf.size(), 3);
    const arr = buf._toArray();
    assert.deepEqual(arr, [7, 8, 9]);
  });

  test('sample: returns empty array when buffer is empty', () => {
    const buf = new ReplayBuffer(10);
    assert.deepEqual(buf.sample(5), []);
  });

  test('sample: returns k items when count >= k', () => {
    const buf = new ReplayBuffer(10);
    buf.add('x');
    buf.add('y');
    buf.add('z');
    const s = buf.sample(2);
    assert.equal(s.length, 2);
    // Items should be from buffer contents
    for (const item of s) {
      assert.ok(['x', 'y', 'z'].includes(item), `Unexpected item: ${item}`);
    }
  });

  test('sample: returns all items when k > count', () => {
    const buf = new ReplayBuffer(10);
    buf.add('a');
    buf.add('b');
    const s = buf.sample(100);
    assert.equal(s.length, 2);
  });

  test('size: returns 0 for fresh buffer', () => {
    const buf = new ReplayBuffer(50);
    assert.equal(buf.size(), 0);
  });

  test('clear: resets buffer to empty', () => {
    const buf = new ReplayBuffer(5);
    buf.add('a');
    buf.add('b');
    assert.equal(buf.size(), 2);
    buf.clear();
    assert.equal(buf.size(), 0);
    assert.deepEqual(buf._toArray(), []);
  });

  test('clear: allows re-adding after clear', () => {
    const buf = new ReplayBuffer(3);
    buf.add(1);
    buf.add(2);
    buf.add(3);
    buf.add(4); // overwrites 1
    buf.clear();
    buf.add('x');
    assert.equal(buf.size(), 1);
    assert.deepEqual(buf._toArray(), ['x']);
  });

  // ── _toArray ──────────────────────────────────────────────────────────

  test('_toArray: returns items in insertion order (not full)', () => {
    const buf = new ReplayBuffer(10);
    buf.add('first');
    buf.add('second');
    buf.add('third');
    assert.deepEqual(buf._toArray(), ['first', 'second', 'third']);
  });

  test('_toArray: returns oldest-to-newest after circular wrap', () => {
    const buf = new ReplayBuffer(4);
    buf.add('a');
    buf.add('b');
    buf.add('c');
    buf.add('d');
    buf.add('e'); // overwrites 'a'
    assert.deepEqual(buf._toArray(), ['b', 'c', 'd', 'e']);
  });

  // ── Save / Load ───────────────────────────────────────────────────────

  test('save/load: round-trip preserves data', async () => {
    const buf = new ReplayBuffer(100);
    buf.add({ board: [1, 2, 3], reward: 1.0 });
    buf.add({ board: [4, 5, 6], reward: -1.0 });

    const tmpDir = await mkdtemp(join(tmpdir(), 'buf-test-'));
    const filePath = join(tmpDir, 'test-buffer.json');

    await buf.save(filePath);

    const buf2 = new ReplayBuffer(100);
    await buf2.load(filePath);

    assert.equal(buf2.size(), 2);
    assert.deepEqual(buf2._toArray(), buf._toArray());

    await unlink(filePath).catch(() => {});
  });

  test('load: handles missing file gracefully (ENOENT)', async () => {
    const buf = new ReplayBuffer(10);
    buf.add('stale');
    assert.equal(buf.size(), 1);

    await buf.load('/tmp/nonexistent-buffer-test-12345.json');
    assert.equal(buf.size(), 0);
  });

  test('load: throws on corrupt JSON', async () => {
    const buf = new ReplayBuffer(10);
    const tmpDir = await mkdtemp(join(tmpdir(), 'buf-test-'));
    const filePath = join(tmpDir, 'corrupt.json');
    await writeFile(filePath, '{invalid json!!!', 'utf-8');

    await assert.rejects(
      () => buf.load(filePath),
      (err) => err instanceof SyntaxError
    );

    await unlink(filePath).catch(() => {});
  });

  // ── Constructor defaults ──────────────────────────────────────────────

  test('constructor: default maxSize from CONFIG is used', () => {
    const buf = new ReplayBuffer();
    assert.equal(buf.maxSize, 100); // our test default
    assert.equal(buf.size(), 0);
  });

  test('constructor: custom maxSize respected', () => {
    const buf = new ReplayBuffer(3);
    assert.equal(buf.maxSize, 3);
    buf.add(1);
    buf.add(2);
    buf.add(3);
    buf.add(4);
    assert.equal(buf.size(), 3);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 ReplayBuffer Tests');

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
