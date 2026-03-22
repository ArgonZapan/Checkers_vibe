// Simple test runner for ESM modules
import { runBufferTests } from './buffer.test.js';
import { runModelTests } from './model.test.js';
import { runTrainerTests } from './trainer.test.js';

const suites = [
  { name: 'buffer', run: runBufferTests },
  { name: 'model',  run: runModelTests },
  { name: 'trainer', run: runTrainerTests },
];

let totalPassed = 0, totalFailed = 0;

console.log('╔═══════════════════════════════════════════╗');
console.log('║   Checkers_vibe — Unit Tests              ║');
console.log('╚═══════════════════════════════════════════╝');

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

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Total: ${totalPassed + totalFailed} | ✅ ${totalPassed} passed | ❌ ${totalFailed} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (totalFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}
