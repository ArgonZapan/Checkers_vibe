#!/usr/bin/env node
/**
 * run.js — Test runner for __tests__/ directory.
 *
 * Usage: node __tests__/run.js
 */
import { runBoardConvertTests } from './boardConvert.test.js';
import { runBoardConvertEdgeTests } from './boardConvertEdge.test.js';
import { runWsMoveValidationTests } from './wsMoveValidation.test.js';
import { runWsSetSpeedTests } from './wsSetSpeed.test.js';
import { runDrawDetectionTests } from './drawDetection.test.js';
import { runTrainerPolicyFixTests } from './trainerPolicyFix.test.js';
import { runTrainerLogicTests } from './trainerLogic.test.js';
import { runBoardSetLookupTests } from './boardSetLookup.test.js';
import { runBoardConvertInvalidTests } from './boardConvertInvalid.test.js';
import { runPredictMaskingTests } from './predictMasking.test.js';
import { runWebsocketHandlersTests } from './websocketHandlers.test.js';
import { runTrainerPlayGameTests } from './trainerPlayGame.test.js';
import { runPolicyIndexTests } from './policyIndex.test.js';
import { runTrainImportTests } from './trainImport.test.js';
import { runBoardAreEqualTests } from './boardAreEqual.test.js';

const suites = [
  { name: 'boardConvert',        run: runBoardConvertTests },
  { name: 'boardConvertEdge',    run: runBoardConvertEdgeTests },
  { name: 'wsMoveValidation',    run: runWsMoveValidationTests },
  { name: 'wsSetSpeed',          run: runWsSetSpeedTests },
  { name: 'drawDetection',       run: runDrawDetectionTests },
  { name: 'trainerPolicyFix',    run: runTrainerPolicyFixTests },
  { name: 'trainerLogic',        run: runTrainerLogicTests },
  { name: 'boardSetLookup',      run: runBoardSetLookupTests },
  { name: 'boardConvertInvalid', run: runBoardConvertInvalidTests },
  { name: 'predictMasking',      run: runPredictMaskingTests },
  { name: 'websocketHandlers',   run: runWebsocketHandlersTests },
  { name: 'trainerPlayGame',     run: runTrainerPlayGameTests },
  { name: 'policyIndex',         run: runPolicyIndexTests },
  { name: 'trainImport',         run: runTrainImportTests },
  { name: 'boardAreEqual',       run: runBoardAreEqualTests },
];

let totalPassed = 0, totalFailed = 0;

console.log('╔═══════════════════════════════════════════════╗');
console.log('║   Checkers_vibe — Validation & Logic Tests   ║');
console.log('╚═══════════════════════════════════════════════╝');

for (const suite of suites) {
  try {
    const { passed, failed } = await suite.run();
    totalPassed += passed;
    totalFailed += failed;
  } catch (err) {
    console.error(`\n💥 ${suite.name} suite crashed:`, err.message);
    totalFailed++;
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Total: ${totalPassed + totalFailed} | ✅ ${totalPassed} passed | ❌ ${totalFailed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (totalFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
