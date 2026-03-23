#!/usr/bin/env node
/**
 * convert-to-jest.mjs — Convert custom runner test files to Jest API.
 * Handles multi-line test bodies with nested braces.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const testDirs = ['__tests__', 'server/tests'];

async function getTestFiles() {
  const files = [];
  for (const dir of testDirs) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.test.js')) {
        files.push(join(dir, entry));
      }
    }
  }
  return files;
}

function convertFile(content, filePath) {
  const lines = content.split('\n');
  
  // Step 1: Find the export function line
  let exportLineIdx = -1;
  let exportFuncName = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export\s+async\s+function\s+(run\w+Tests)\s*\(\s*\)\s*\{/);
    if (m) {
      exportLineIdx = i;
      exportFuncName = m[1];
      break;
    }
  }
  if (exportLineIdx === -1) return null;
  
  // Step 2: Extract imports (everything before export function, excluding comments/blank)
  const importLines = [];
  for (let i = 0; i < exportLineIdx; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('import ')) {
      importLines.push(lines[i]);
    }
  }
  
  // Step 3: Find the matching closing brace for the export function
  let braceDepth = 0;
  let funcEndIdx = -1;
  for (let i = exportLineIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          funcEndIdx = i;
          break;
        }
      }
    }
    if (funcEndIdx !== -1) break;
  }
  if (funcEndIdx === -1) return null;
  
  // Step 4: Extract the function body (between export line and closing brace)
  const bodyLines = lines.slice(exportLineIdx + 1, funcEndIdx);
  
  // Step 5: Parse the body to extract individual test blocks
  // Pattern: test('name', () => { ... }) or test('name', async () => { ... })
  // with potential multi-line bodies
  const testBlocks = [];
  let i = 0;
  
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const trimmed = line.trim();
    
    // Match test('name', () => { or test('name', async () => {
    const testStartMatch = trimmed.match(/^test\(\s*(['"`])(.+?)\1\s*,\s*(async\s+)?\(\s*\)\s*=>\s*\{/);
    
    if (testStartMatch) {
      const isAsync = !!testStartMatch[3];
      const testName = testStartMatch[2];
      const indent = line.match(/^(\s*)/)[1];
      
      // Find the end of this test block by tracking braces
      let testBraceDepth = 1;
      const testBodyLines = [line.replace(/^(\s*)test\(/, `${indent}it(`)];
      let j = i + 1;
      
      while (j < bodyLines.length && testBraceDepth > 0) {
        const bodyLine = bodyLines[j];
        for (const ch of bodyLine) {
          if (ch === '{') testBraceDepth++;
          if (ch === '}') testBraceDepth--;
        }
        testBodyLines.push(bodyLine);
        j++;
      }
      
      testBlocks.push(testBodyLines.join('\n'));
      i = j;
    } else {
      i++;
    }
  }
  
  if (testBlocks.length === 0) {
    // Fallback: try simpler pattern where test() calls don't have nested braces
    // e.g., test('name', () => assert.ok(true));
    return convertSimplePattern(content, filePath);
  }
  
  // Step 6: Build the describe name
  let describeName = exportFuncName.replace(/^run/, '').replace(/Tests$/, '');
  describeName = describeName.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Step 7: Assemble output
  const output = [];
  
  // Imports
  const hasJestImport = importLines.some(l => l.includes('@jest/globals'));
  for (const imp of importLines) {
    output.push(imp);
  }
  if (!hasJestImport) {
    output.push("import { describe, it } from '@jest/globals';");
  }
  
  output.push('');
  output.push(`describe('${describeName}', () => {`);
  
  for (const block of testBlocks) {
    // Indent each line of the test block by 2 spaces
    for (const line of block.split('\n')) {
      if (line.trim() === '') {
        output.push('');
      } else {
        output.push('  ' + line);
      }
    }
    output.push('');
  }
  
  output.push('});');
  output.push('');
  
  return output.join('\n');
}

function convertSimplePattern(content, filePath) {
  // For files where test() calls are single-expression (no nested braces)
  // e.g., test('name', () => assert.ok(true));
  const lines = content.split('\n');
  
  let exportLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^export\s+async\s+function\s+run\w+Tests\s*\(\s*\)\s*\{/)) {
      exportLineIdx = i;
      break;
    }
  }
  if (exportLineIdx === -1) return null;
  
  const exportFuncName = lines[exportLineIdx].match(/(run\w+Tests)/)[1];
  let describeName = exportFuncName.replace(/^run/, '').replace(/Tests$/, '');
  describeName = describeName.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  // Extract imports
  const importLines = [];
  for (let i = 0; i < exportLineIdx; i++) {
    if (lines[i].trim().startsWith('import ')) {
      importLines.push(lines[i]);
    }
  }
  
  // Find the closing brace of the export function
  let braceDepth = 0;
  let funcEndIdx = -1;
  for (let i = exportLineIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          funcEndIdx = i;
          break;
        }
      }
    }
    if (funcEndIdx !== -1) break;
  }
  
  const bodyLines = lines.slice(exportLineIdx + 1, funcEndIdx);
  
  // Convert test() to it() in body, remove infrastructure lines
  const processedBody = [];
  for (const line of bodyLines) {
    const trimmed = line.trim();
    
    // Skip infrastructure
    if (trimmed === 'let passed = 0, failed = 0;') continue;
    if (trimmed === 'const tests = [];') continue;
    if (trimmed.match(/^function\s+test\s*\(\s*name\s*,\s*fn\s*\)\s*\{\s*$/)) continue;
    if (trimmed === 'tests.push({ name, fn });') continue;
    if (trimmed === '}' && processedBody.length > 0 && processedBody[processedBody.length - 1].trim() === 'tests.push({ name, fn });') {
      processedBody.pop(); // Remove the tests.push line and this closing brace
      continue;
    }
    if (trimmed.match(/^function\s+test\s*\(/)) continue;
    
    // Convert test( to it(
    if (trimmed.startsWith('test(')) {
      processedBody.push(line.replace(/\btest\(/, 'it('));
      continue;
    }
    
    processedBody.push(line);
  }
  
  const output = [];
  const hasJestImport = importLines.some(l => l.includes('@jest/globals'));
  for (const imp of importLines) output.push(imp);
  if (!hasJestImport) output.push("import { describe, it } from '@jest/globals';");
  
  output.push('');
  output.push(`describe('${describeName}', () => {`);
  for (const line of processedBody) {
    if (line.trim() === '') {
      output.push('');
    } else {
      output.push('  ' + line);
    }
  }
  output.push('});');
  output.push('');
  
  return output.join('\n');
}

async function main() {
  const files = await getTestFiles();
  console.log(`Found ${files.length} test files to convert`);
  
  let converted = 0;
  let skipped = 0;
  
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      const result = convertFile(content, filePath);
      
      if (result === null) {
        console.log(`  ⏭️  ${filePath} — could not convert`);
        skipped++;
        continue;
      }
      
      await writeFile(filePath, result);
      console.log(`  ✅ ${filePath} — converted`);
      converted++;
    } catch (err) {
      console.error(`  ❌ ${filePath}: ${err.message}`);
    }
  }
  
  console.log(`\nConverted: ${converted}, Skipped: ${skipped}`);
}

main().catch(console.error);
