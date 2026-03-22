import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class ReplayBuffer {
  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.buffer = [];
  }

  add(sample) {
    this.buffer.push(sample);
    if (this.buffer.length > this.maxSize) {
      this.buffer.splice(0, this.buffer.length - this.maxSize);
    }
  }

  sample(n) {
    if (this.buffer.length === 0) return [];
    const count = Math.min(n, this.buffer.length);
    const indices = new Set();
    while (indices.size < count) {
      indices.add(Math.floor(Math.random() * this.buffer.length));
    }
    return [...indices].map(i => this.buffer[i]);
  }

  size() {
    return this.buffer.length;
  }

  async save(filePath) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(this.buffer), 'utf-8');
    console.log(`[Buffer] Saved ${this.buffer.length} samples to ${filePath}`);
  }

  async load(filePath) {
    try {
      const data = await readFile(filePath, 'utf-8');
      this.buffer = JSON.parse(data);
      console.log(`[Buffer] Loaded ${this.buffer.length} samples from ${filePath}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`[Buffer] No existing buffer at ${filePath}, starting fresh`);
        this.buffer = [];
      } else {
        throw err;
      }
    }
  }

  clear() {
    this.buffer = [];
    console.log('[Buffer] Cleared');
  }
}
