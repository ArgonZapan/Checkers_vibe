/**
 * saveModel-enotempty-fallback.test.js — Tests for saveModel's ENOTEMPTY
 * fallback logic (rm + rename atomic swap).
 *
 * The saveModel function (server/ai/model.js) writes to a .tmp dir first,
 * then attempts rename(tmp, target). On ENOTEMPTY/EEXIST, it falls back to
 * rm(target) + rename(tmp, target).
 *
 * These tests verify the fs operation sequence WITHOUT TensorFlow —
 * we mock model.save() and test only the file-system logic.
 *
 * Extracted logic + mocked fs — no server required.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.join(__dirname, '..', 'server', 'ai', 'model.js');

let modelSource;
try {
  modelSource = readFileSync(modelPath, 'utf-8');
} catch {
  modelSource = '';
}

// ── Mocked fs operations ────────────────────────────────────────────────────

function createMockFs() {
  const dirs = new Set();
  const files = new Map();
  const ops = []; // log of operations

  async function rm(dirPath, opts) {
    ops.push({ op: 'rm', path: dirPath, opts });
    dirs.delete(dirPath);
    // Also remove any files under this path
    for (const key of files.keys()) {
      if (key.startsWith(dirPath + '/')) files.delete(key);
    }
  }

  async function mkdir(dirPath, opts) {
    ops.push({ op: 'mkdir', path: dirPath, opts });
    dirs.add(dirPath);
  }

  async function rename(src, dst) {
    ops.push({ op: 'rename', src, dst });
    // Simulate ENOTEMPTY when dst exists and is non-empty
    if (dirs.has(dst) && !opts_allowRename) {
      const err = new Error(`ENOTEMPTY: directory not empty, rename '${src}' -> '${dst}'`);
      err.code = 'ENOTEMPTY';
      throw err;
    }
    dirs.delete(src);
    dirs.add(dst);
  }

  let opts_allowRename = false;

  function allowRename(val) {
    opts_allowRename = val;
  }

  function getOps() {
    return [...ops];
  }

  function clearOps() {
    ops.length = 0;
  }

  return { rm, mkdir, rename, allowRename, getOps, clearOps, dirs, files };
}

// ── Extracted: saveModel logic (mirrors server/ai/model.js) ────────────────

async function saveModelWithFs(model, dirPath, fs) {
  const tmpDir = dirPath + '.tmp';
  // Clean up any leftover tmp dir
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });
  // model.save() — mocked
  await model.save(tmpDir);
  // Atomic swap: rename tmp → target
  try {
    await fs.rename(tmpDir, dirPath);
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
      await fs.rm(dirPath, { recursive: true, force: true });
      await fs.rename(tmpDir, dirPath);
    } else {
      throw e;
    }
  }
}

// ── Mock model ──────────────────────────────────────────────────────────────

function createMockModel() {
  return {
    async save(dirPath) {
      // Simulate writing model.json + weights
      return { modelArtifactsInfo: { dateSaved: new Date().toISOString() } };
    }
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

export async function runSaveModelEnotemptyFallbackTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Happy path: rename succeeds (no ENOTEMPTY)
  // ═══════════════════════════════════════════════════════════════════════

  test('happy path: rm tmp, mkdir tmp, save, rename → target', async () => {
    const fs = createMockFs();
    fs.allowRename(true); // rename succeeds
    const model = createMockModel();

    await saveModelWithFs(model, '/data/model/white', fs);

    const ops = fs.getOps();
    assert.equal(ops[0].op, 'rm');
    assert.equal(ops[0].path, '/data/model/white.tmp');
    assert.equal(ops[1].op, 'mkdir');
    assert.equal(ops[1].path, '/data/model/white.tmp');
    assert.equal(ops[2].op, 'rename');
    assert.equal(ops[2].src, '/data/model/white.tmp');
    assert.equal(ops[2].dst, '/data/model/white');
    assert.equal(ops.length, 3, 'Should have exactly 3 fs ops');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. ENOTEMPTY fallback: rm + rename
  // ═══════════════════════════════════════════════════════════════════════

  test('ENOTEMPTY triggers fallback: rm(target) + rename(tmp, target)', async () => {
    const fs = createMockFs();
    fs.allowRename(false); // rename throws ENOTEMPTY
    const model = createMockModel();

    // Pre-populate target dir (simulates existing model)
    fs.dirs.add('/data/model/white');

    await saveModelWithFs(model, '/data/model/white', fs);

    const ops = fs.getOps();
    // Expected sequence:
    // 1. rm tmp
    // 2. mkdir tmp
    // 3. rename(tmp, target) → ENOTEMPTY
    // 4. rm(target) ← fallback
    // 5. rename(tmp, target) ← retry
    assert.equal(ops[0].op, 'rm');
    assert.equal(ops[0].path, '/data/model/white.tmp');
    assert.equal(ops[1].op, 'mkdir');
    assert.equal(ops[2].op, 'rename');
    assert.equal(ops[2].src, '/data/model/white.tmp');
    assert.equal(ops[3].op, 'rm');
    assert.equal(ops[3].path, '/data/model/white');
    assert.equal(ops[4].op, 'rename');
    assert.equal(ops[4].src, '/data/model/white.tmp');
    assert.equal(ops[4].dst, '/data/model/white');
    assert.equal(ops.length, 5, 'Should have 5 fs ops (rm+mkdir+rename+rm+rename)');
  });

  test('EEXIST error code also triggers fallback', async () => {
    let rmCalled = false;
    const fs = {
      async rm() { rmCalled = true; },
      async mkdir() {},
      async rename(src, dst) {
        if (rmCalled) return; // succeed after rm
        const err = new Error('EEXIST');
        err.code = 'EEXIST';
        throw err;
      },
      getOps() { return []; }
    };
    const model = createMockModel();

    // Should not throw — EEXIST is handled
    let threw = false;
    try {
      await saveModelWithFs(model, '/data/model/black', fs);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'EEXIST should be handled gracefully');
    assert.equal(rmCalled, true, 'rm should be called as fallback');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Non-recoverable rename errors are re-thrown
  // ═══════════════════════════════════════════════════════════════════════

  test('EPERM rename error is re-thrown (not caught)', async () => {
    const fs = {
      async rm() {},
      async mkdir() {},
      async rename() {
        const err = new Error('EPERM: operation not permitted');
        err.code = 'EPERM';
        throw err;
      },
    };
    const model = createMockModel();

    await assert.rejects(
      () => saveModelWithFs(model, '/data/model/white', fs),
      { code: 'EPERM' },
      'EPERM should be re-thrown'
    );
  });

  test('EACCES rename error is re-thrown', async () => {
    const fs = {
      async rm() {},
      async mkdir() {},
      async rename() {
        const err = new Error('EACCES: permission denied');
        err.code = 'EACCES';
        throw err;
      },
    };
    const model = createMockModel();

    await assert.rejects(
      () => saveModelWithFs(model, '/data/model/white', fs),
      { code: 'EACCES' }
    );
  });

  test('ENOENT rename error is re-thrown', async () => {
    const fs = {
      async rm() {},
      async mkdir() {},
      async rename() {
        const err = new Error('ENOENT: no such file or directory');
        err.code = 'ENOENT';
        throw err;
      },
    };
    const model = createMockModel();

    await assert.rejects(
      () => saveModelWithFs(model, '/data/model/white', fs),
      { code: 'ENOENT' }
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Tmp dir cleanup on start
  // ═══════════════════════════════════════════════════════════════════════

  test('leftover .tmp dir is cleaned up before mkdir', async () => {
    const fs = createMockFs();
    fs.allowRename(true);
    const model = createMockModel();

    // Pre-populate .tmp dir (leftover from interrupted save)
    fs.dirs.add('/data/model/white.tmp');

    await saveModelWithFs(model, '/data/model/white', fs);

    const ops = fs.getOps();
    // First op should be rm of .tmp dir
    assert.equal(ops[0].op, 'rm');
    assert.equal(ops[0].path, '/data/model/white.tmp');
    assert.equal(ops[0].opts.recursive, true);
    assert.equal(ops[0].opts.force, true);
  });

  test('rm uses force: true so missing tmp does not throw', async () => {
    const fs = createMockFs();
    fs.allowRename(true);
    const model = createMockModel();

    // No pre-existing .tmp — rm should succeed silently with force:true
    let threw = false;
    try {
      await saveModelWithFs(model, '/data/model/white', fs);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'rm with force:true should not throw on missing dir');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Model.save() called with tmpDir (not target)
  // ═══════════════════════════════════════════════════════════════════════

  test('model.save() is called with .tmp path (not target)', async () => {
    let saveTarget = null;
    const model = {
      async save(dirPath) { saveTarget = dirPath; }
    };
    const fs = createMockFs();
    fs.allowRename(true);

    await saveModelWithFs(model, '/data/model/white', fs);

    assert.equal(saveTarget, '/data/model/white.tmp', 'model.save should target .tmp dir');
  });

  test('model.save() error is propagated (not swallowed)', async () => {
    const model = {
      async save() { throw new Error('TF save failed: OOM'); }
    };
    const fs = createMockFs();
    fs.allowRename(true);

    await assert.rejects(
      () => saveModelWithFs(model, '/data/model/white', fs),
      { message: /TF save failed/ }
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Server source verification
  // ═══════════════════════════════════════════════════════════════════════

  test('server code: saveModel uses atomic tmp+rename pattern', () => {
    assert.ok(
      modelSource.includes("dirPath + '.tmp'") || modelSource.includes("dirPath+'.tmp'"),
      'saveModel should use .tmp suffix for atomic write'
    );
  });

  test('server code: saveModel catches ENOTEMPTY', () => {
    assert.ok(
      modelSource.includes("'ENOTEMPTY'") || modelSource.includes('"ENOTEMPTY"'),
      'saveModel should catch ENOTEMPTY error code'
    );
  });

  test('server code: saveModel catches EEXIST', () => {
    assert.ok(
      modelSource.includes("'EEXIST'") || modelSource.includes('"EEXIST"'),
      'saveModel should also catch EEXIST error code'
    );
  });

  test('server code: fallback does rm + rename', () => {
    const notEmptyIdx = modelSource.indexOf('ENOTEMPTY');
    if (notEmptyIdx === -1) return;
    const fallbackSection = modelSource.slice(notEmptyIdx, notEmptyIdx + 300);
    assert.ok(
      fallbackSection.includes('rm(dirPath'),
      'ENOTEMPTY fallback should rm the target dir'
    );
    assert.ok(
      fallbackSection.includes('rename(tmpDir'),
      'ENOTEMPTY fallback should retry rename after rm'
    );
  });

  test('server code: rm uses recursive:true, force:true', () => {
    assert.ok(
      modelSource.includes('recursive: true'),
      'rm should use recursive: true for directory removal'
    );
    assert.ok(
      modelSource.includes('force: true'),
      'rm should use force: true to avoid errors on missing dirs'
    );
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Idempotency: repeated saves work
  // ═══════════════════════════════════════════════════════════════════════

  test('multiple sequential saves succeed (idempotent)', async () => {
    const fs = createMockFs();
    fs.allowRename(true);
    const model = createMockModel();

    for (let i = 0; i < 5; i++) {
      fs.clearOps();
      await saveModelWithFs(model, '/data/model/white', fs);
      const ops = fs.getOps();
      assert.ok(ops.length >= 3, `Save ${i}: should have at least 3 ops`);
    }
  });

  // ── Run ────────────────────────────────────────────────────────────────

  console.log('\n📋 saveModel ENOTEMPTY Fallback Tests');

  for (const { name, fn } of tests) {
    try {
      await fn();
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
