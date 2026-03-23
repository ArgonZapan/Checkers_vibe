#!/usr/bin/env node
/**
 * run.js — Test runner for __tests__/ directory.
 *
 * Usage: node __tests__/run.js
 */
import { runBoardConvertTests } from './boardConvert.test.js';
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
import { runConfigSpeedHelpersTests } from './configSpeedHelpers.test.js';
import { runTrainerRewardHelpersTests } from './trainerRewardHelpers.test.js';
import { runColorTurnConversionTests } from './colorTurnConversion.test.js';
import { runWsHandlerLogicTests } from './wsHandlerLogic.test.js';
import { runModelValidationTests } from './modelValidation.test.js';
import { runTrainerArrayMovesTests } from './trainerArrayMoves.test.js';
import { runBufferTests } from './buffer.test.js';
import { runAutoSaveLogicTests } from './autoSaveLogic.test.js';
import { runAutoSaveTimingTests } from './autoSaveTiming.test.js';
import { runApiEndpointValidationTests } from './apiEndpointValidation.test.js';
import { runWsConnectionLifecycleTests } from './wsConnectionLifecycle.test.js';
import { runProxyLogicTests } from './proxyLogic.test.js';
import { runIssues132to134Tests } from './issues132to134.test.js';
import { runIssue129Tests } from './issue129.test.js';
import { runIssue130Tests } from './issue130.test.js';
import { runIssue131Tests } from './issue131.test.js';
import { runBoardConvertAdditionalTests } from './boardConvertAdditional.test.js';
import { runBoardConvertEdgeTests } from './boardConvertEdge.test.js';
import { runSetSpeedModeValidationTests } from './setSpeedModeValidation.test.js';
import { runAiMovePredictionTests } from './aiMovePrediction.test.js';
import { runCppFetchLogicTests } from './cppFetchLogic.test.js';
import { runResetHandlerLogicTests } from './resetHandlerLogic.test.js';
import { runKingMovesPathTests } from './kingMovesPath.test.js';
import { runHunterCoverageGapsTests } from './hunter-coverageGaps.test.js';
import { runConfigAiBoardTests } from './configAiBoard.test.js';
import { runRateLimiterThrottleTests } from './rateLimiterThrottle.test.js';
import { runSecurityHeadersTests } from './securityHeaders.test.js';
import { runGetGameStateLogicTests } from './getGameStateLogic.test.js';
import { runAiFallbackLogicTests } from './aiFallbackLogic.test.js';
import { runSelfPlayStateTests } from './selfPlayState.test.js';
import { runProxyPathRewriteTests } from './proxyPathRewrite.test.js';
import { runTrainerHelpersDeepTests } from './trainerHelpersDeep.test.js';
import { runBoardConvertOversizedTests } from './boardConvertOversized.test.js';
import { runKingMultiCaptureAndUndoTests } from './kingMultiCaptureAndUndo.test.js';
import { runDrawDetectionExtraTests } from './drawDetectionExtra.test.js';
import { runHandleMoveFlowTests } from './handleMoveFlow.test.js';
import { runAiMoveFlowTests } from './aiMoveFlow.test.js';
import { runTrainBellmanTests } from './trainBellman.test.js';
import { runSetParamsWhitelistTests } from './setParamsWhitelist.test.js';
import { runMoveSerializationTests } from './moveSerialization.test.js';
import { runProxyBodyReplayTests } from './proxyBodyReplay.test.js';
import { runCspHeadersTests } from './cspHeaders.test.js';
import { runRaceConditionTests } from './raceCondition.test.js';
import { runMoveQueueResilienceTests } from './moveQueueResilience.test.js';
import { runBoardToCppValidationTests } from './boardToCppValidation.test.js';
import { runLegalMovesMemoizationTests } from './legalMovesMemoization.test.js';
import { runEpsilonValidationResilienceTests } from './epsilonValidationResilience.test.js';
import { runCSPResilienceTests } from './cspResilience.test.js';
import { runResilienceHunterSubAlpha003Tests } from './resilience-hunter-sub-alpha-003.test.js';
import { runCspHeaderContentTests } from './cspHeaderContent.test.js';
import { runPredictPolicyIndexTests } from './predictPolicyIndex.test.js';
import { runBoardRoundTripTests } from './boardRoundTrip.test.js';
import { runAutoSaveRaceConditionTests } from './autoSaveRaceCondition.test.js';
import { runSecurityFixesTests } from './securityFixes.test.js';
import { runEpsilonValidationServerTests } from './epsilonValidationServer.test.js';
import { runAutoSaveDirtySnapshotTests } from './autoSaveDirtySnapshot.test.js';
import { runCspCompletenessTests } from './cspCompleteness.test.js';
import { runWsHandlerInputGapsTests } from './wsHandlerInputGaps.test.js';
import { runRateLimitSecurityTests } from './rateLimitSecurity.test.js';
import { runHunterSecurityFixesTests } from './hunter-security-fixes.test.js';

const suites = [
  { name: 'boardConvert',        run: runBoardConvertTests },
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
  { name: 'configSpeedHelpers',  run: runConfigSpeedHelpersTests },
  { name: 'trainerRewardHelpers', run: runTrainerRewardHelpersTests },
  { name: 'colorTurnConversion', run: runColorTurnConversionTests },
  { name: 'wsHandlerLogic',      run: runWsHandlerLogicTests },
  { name: 'modelValidation',     run: runModelValidationTests },
  { name: 'trainerArrayMoves',   run: runTrainerArrayMovesTests },
  { name: 'buffer',              run: runBufferTests },
  { name: 'autoSaveLogic',       run: runAutoSaveLogicTests },
  { name: 'autoSaveTiming',     run: runAutoSaveTimingTests },
  { name: 'apiEndpointValidation', run: runApiEndpointValidationTests },
  { name: 'wsConnectionLifecycle', run: runWsConnectionLifecycleTests },
  { name: 'proxyLogic',          run: runProxyLogicTests },
  { name: 'issues132to134',      run: runIssues132to134Tests },
  { name: 'issue129',            run: runIssue129Tests },
  { name: 'issue130',            run: runIssue130Tests },
  { name: 'issue131',            run: runIssue131Tests },
  { name: 'boardConvertAdditional', run: runBoardConvertAdditionalTests },
  { name: 'boardConvertEdge',     run: runBoardConvertEdgeTests },
  { name: 'setSpeedModeValidation', run: runSetSpeedModeValidationTests },
  { name: 'aiMovePrediction',    run: runAiMovePredictionTests },
  { name: 'cppFetchLogic',       run: runCppFetchLogicTests },
  { name: 'resetHandlerLogic',   run: runResetHandlerLogicTests },
  { name: 'kingMovesPath',       run: runKingMovesPathTests },
  { name: 'hunterCoverageGaps',  run: runHunterCoverageGapsTests },
  { name: 'configAiBoard',       run: runConfigAiBoardTests },
  { name: 'rateLimiterThrottle', run: runRateLimiterThrottleTests },
  { name: 'securityHeaders',     run: runSecurityHeadersTests },
  { name: 'getGameStateLogic',   run: runGetGameStateLogicTests },
  { name: 'aiFallbackLogic',     run: runAiFallbackLogicTests },
  { name: 'selfPlayState',       run: runSelfPlayStateTests },
  { name: 'proxyPathRewrite',    run: runProxyPathRewriteTests },
  { name: 'trainerHelpersDeep',  run: runTrainerHelpersDeepTests },
  { name: 'boardConvertOversized', run: runBoardConvertOversizedTests },
  { name: 'kingMultiCaptureAndUndo', run: runKingMultiCaptureAndUndoTests },
  { name: 'drawDetectionExtra',     run: runDrawDetectionExtraTests },
  { name: 'handleMoveFlow',        run: runHandleMoveFlowTests },
  { name: 'aiMoveFlow',            run: runAiMoveFlowTests },
  { name: 'trainBellman',          run: runTrainBellmanTests },
  { name: 'setParamsWhitelist',    run: runSetParamsWhitelistTests },
  { name: 'moveSerialization',     run: runMoveSerializationTests },
  { name: 'proxyBodyReplay',       run: runProxyBodyReplayTests },
  { name: 'cspHeaders',            run: runCspHeadersTests },
  { name: 'raceCondition',         run: runRaceConditionTests },
  { name: 'moveQueueResilience',   run: runMoveQueueResilienceTests },
  { name: 'boardToCppValidation',  run: runBoardToCppValidationTests },
  { name: 'legalMovesMemoization', run: runLegalMovesMemoizationTests },
  { name: 'epsilonValidationResilience', run: runEpsilonValidationResilienceTests },
  { name: 'cspResilience', run: runCSPResilienceTests },
  { name: 'resilienceHunterSubAlpha003', run: runResilienceHunterSubAlpha003Tests },
  { name: 'cspHeaderContent', run: runCspHeaderContentTests },
  { name: 'predictPolicyIndex', run: runPredictPolicyIndexTests },
  { name: 'boardRoundTrip', run: runBoardRoundTripTests },
  { name: 'autoSaveRaceCondition', run: runAutoSaveRaceConditionTests },
  { name: 'securityFixes', run: runSecurityFixesTests },
  { name: 'epsilonValidationServer', run: runEpsilonValidationServerTests },
  { name: 'autoSaveDirtySnapshot', run: runAutoSaveDirtySnapshotTests },
  { name: 'cspCompleteness', run: runCspCompletenessTests },
  { name: 'wsHandlerInputGaps', run: runWsHandlerInputGapsTests },
  { name: 'rateLimitSecurity', run: runRateLimitSecurityTests },
  { name: 'hunterSecurityFixes', run: runHunterSecurityFixesTests },
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
