import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CONFIG } from '../../config.js';

export class ReplayBuffer {
  constructor(maxSize = CONFIG.ai.bufferSize) {
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
    // Fisher-Yates shuffle over all available items, return first k
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
    await mkdir(dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    await writeFile(tmpPath, JSON.stringify(this._toArray()), 'utf-8');
    await rename(tmpPath, filePath);
    console.log(`[Buffer] Saved ${this.count} samples to ${filePath}`);
  }

  async load(filePath) {
    try {
      const data = await readFile(filePath, 'utf-8');
      const arr = JSON.parse(data);
      this.buffer = new Array(this.maxSize);
      this.head = 0;
      this.count = 0;
      for (const s of arr) this.add(s);
      console.log(`[Buffer] Loaded ${this.count} samples from ${filePath}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`[Buffer] No existing buffer at ${filePath}, starting fresh`);
        this.buffer = new Array(this.maxSize);
        this.head = 0;
        this.count = 0;
      } else if (err instanceof SyntaxError) {
        console.warn(`[Buffer] Malformed JSON at ${filePath}, starting fresh: ${err.message}`);
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
    console.log('[Buffer] Cleared');
  }
}
