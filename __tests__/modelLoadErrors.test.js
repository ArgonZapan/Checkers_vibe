// modelLoadErrors.test.js — Test loadModel error handling and saveModel atomic writes
import assert from 'node:assert/strict';
import { describe, it } from '@jest/globals';
import * as tf from '@tensorflow/tfjs-node';
import { createModel, saveModel, loadModel } from '../server/ai/model.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';

describe('loadModel Error Handling & saveModel Atomicity', () => {
  const TEST_DIR = '/tmp/test-model-errors-' + Date.now();

  it('loadModel: throws on non-existent directory', async () => {
    await assert.rejects(
      () => loadModel('/tmp/nonexistent-model-dir-xyz'),
      (err) => {
        // TF.js throws on missing model.json
        return err.message.includes('model.json') || err.code === 'ENOENT';
      }
    );
  });

  it('loadModel: throws on corrupted model.json', async () => {
    const dir = TEST_DIR + '-corrupt';
    await mkdir(dir, { recursive: true });
    await writeFile(dir + '/model.json', '{ invalid json !!!');
    await assert.rejects(
      () => loadModel(dir),
      (err) => {
        // Should be a parse error
        return err instanceof Error;
      }
    );
    await rm(dir, { recursive: true, force: true });
  });

  it('saveModel: atomic write survives — target dir exists after save', async () => {
    const model = createModel('small');
    const dir = TEST_DIR + '-atomic';
    await saveModel(model, dir);
    // Verify model.json exists in the target dir
    const { access } = await import('node:fs/promises');
    await access(dir + '/model.json'); // throws if missing
    // Verify no leftover .tmp dir
    await assert.rejects(
      () => access(dir + '.tmp'),
      (err) => err.code === 'ENOENT'
    );
    model.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('saveModel: overwrites existing model without error', async () => {
    const dir = TEST_DIR + '-overwrite';
    const model1 = createModel('small');
    await saveModel(model1, dir);
    // Save second model (should overwrite atomically)
    const model2 = createModel('medium');
    await saveModel(model2, dir);
    // Load and verify it's the medium model (more layers)
    const loaded = await loadModel(dir);
    const denseLayers = loaded.layers.filter(l => l.getClassName() === 'Dense');
    // medium has 3 trunk layers (256, 128, 64) + policy(48) + value(1) = 5 Dense
    assert.ok(denseLayers.length >= 4, 'loaded model should have medium architecture');
    model1.dispose();
    model2.dispose();
    loaded.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('saveModel: cleans up leftover .tmp dir from previous interrupted save', async () => {
    const dir = TEST_DIR + '-cleanup-tmp';
    // Simulate leftover .tmp dir
    await mkdir(dir + '.tmp', { recursive: true });
    await writeFile(dir + '.tmp/dummy', 'leftover');
    const model = createModel('small');
    await saveModel(model, dir);
    // .tmp should have been cleaned up
    const { access } = await import('node:fs/promises');
    await assert.rejects(() => access(dir + '.tmp/dummy'));
    model.dispose();
    await rm(dir, { recursive: true, force: true });
    await rm(dir + '.tmp', { recursive: true, force: true }).catch(() => {});
  });
});
