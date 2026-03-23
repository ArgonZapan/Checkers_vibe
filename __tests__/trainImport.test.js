/**
 * trainImport.test.js — Verify that the `train` function is exported from model.js.
 *
 * This test validates the fix where `train` was missing from model.js exports,
 * causing import errors in trainer.js and server/index.js.
 *
 * We can't import model.js directly (TensorFlow dependency), so we verify
 * the export declaration exists in the source file.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function runTrainImportTests() {
  let passed = 0, failed = 0;
  const tests = [];

  function test(name, fn) {
    tests.push({ name, fn });
  }

  // ── Source file checks ────────────────────────────────────────────────

  const modelSrc = readFileSync(
    new URL('../server/ai/model.js', import.meta.url),
    'utf-8'
  );

  const trainerSrc = readFileSync(
    new URL('../server/ai/trainer.js', import.meta.url),
    'utf-8'
  );

  test('model.js exports train function', () => {
    assert.ok(
      /export\s+async\s+function\s+train\s*\(/.test(modelSrc),
      'model.js contains "export async function train("'
    );
  });

  test('train function has correct signature (model, batch, epochs)', () => {
    const match = modelSrc.match(/export\s+async\s+function\s+train\s*\(([^)]*)\)/);
    assert.ok(match, 'Found train function signature');
    const params = match[1].trim();
    assert.ok(params.includes('model'), 'First param includes "model"');
    assert.ok(params.includes('batch'), 'Second param includes "batch"');
    assert.ok(params.includes('epochs'), 'Third param includes "epochs"');
  });

  test('train has default value for epochs parameter', () => {
    assert.ok(
      /export\s+async\s+function\s+train\s*\([^)]*epochs\s*=\s*\d+/.test(modelSrc),
      'train has default epochs value'
    );
  });

  test('trainer.js imports train from model.js', () => {
    assert.ok(
      /import\s*\{[^}]*\btrain\b[^}]*\}\s*from\s*['"]\.\/model\.js['"]/.test(trainerSrc),
      'trainer.js imports train from ./model.js'
    );
  });

  test('trainer.js uses train in its code', () => {
    // Verify train is actually called, not just imported
    const usageCount = (trainerSrc.match(/\btrain\s*\(/g) || []).length;
    assert.ok(usageCount > 0, `train() is called in trainer.js (${usageCount} times)`);
  });

  test('model.js exports all expected functions', () => {
    const expectedExports = [
      'createModel',
      'boardToTensor',
      'buildInputArray',
      'computePolicyIndex',
      'predict',
      'train',
      'saveModel',
      'loadModel',
    ];

    for (const name of expectedExports) {
      const regex = new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\s*\\(`);
      assert.ok(
        regex.test(modelSrc),
        `model.js exports ${name}`
      );
    }
  });

  test('train function body exists (not empty stub)', () => {
    // Find the train function and verify it has meaningful content
    const trainStart = modelSrc.indexOf('export async function train(');
    assert.ok(trainStart !== -1, 'Found train function');

    // Find the next export (or end of file) to bound the function
    const nextExport = modelSrc.indexOf('\nexport ', trainStart + 10);
    const funcBody = nextExport === -1
      ? modelSrc.slice(trainStart)
      : modelSrc.slice(trainStart, nextExport);

    // Should have meaningful content: model.fit, tensor operations, etc.
    assert.ok(
      funcBody.includes('fit') || funcBody.includes('trainOnBatch') || funcBody.includes('optimizer'),
      'train function body contains training logic'
    );
    assert.ok(funcBody.length > 200, `train function body is substantial (${funcBody.length} chars)`);
  });

  // ── Run ───────────────────────────────────────────────────────────────

  console.log('\n📋 Train Import Tests');

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
