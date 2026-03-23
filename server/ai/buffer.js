import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
    const count = Math.min(n, this.count);
    // Reservoir sampling — O(k) instead of O(n) Fisher-Yates
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(this.buffer[i]);
    }
    for (let i = count; i < this.count; i++) {
      const j = Math.floor(Math.random() * (i + 1));
      if (j < count) result[j] = this.buffer[i];
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
    await writeFile(filePath, JSON.stringify(this._toArray()), 'utf-8');
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
