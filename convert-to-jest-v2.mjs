#!/usr/bin/env node
/**
 * convert-to-jest-v2.mjs — Convert custom runner test files to Jest API.
 * Preserves ALL code inside the function body (helpers, classes, etc.)
 * Only removes test runner infrastructure and converts test() → it().
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';

const testDirs = ['__tests__', 'server/tests'];

async function getTestFiles() {
  const files = [];
  for (const dir of testDirs) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.test.js')) {
        files.push(`${dir}/${entry}`);
      }
    }
  }
  return files;
}

function convertFile(content, filePath) {
  const lines = content.split('\n');
  
  // Step 1: Find the export function line
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
  
  // Step 2: Extract everything before the export function (imports, classes, helpers, comments)
  const preambleLines = [];
  for (let i = 0; i < exportLineIdx; i++) {
    preambleLines.push(lines[i]);
  }
  // Trim trailing blank lines
  while (preambleLines.length > 0 && preambleLines[preambleLines.length - 1].trim() === '') {
    preambleLines.pop();
  }
  // Extract just import lines for checking later
  const importLines = preambleLines.filter(l => l.trim().startsWith('import '));
  
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
  
  // Step 4: Extract the function body
  const bodyLines = lines.slice(exportLineIdx + 1, funcEndIdx);
  
  // Step 5: Identify lines to remove (test runner infrastructure)
  // and find where the run loop starts
  const removeLineIndices = new Set();
  let runLoopStartIdx = -1;
  
  for (let i = 0; i < bodyLines.length; i++) {
    const trimmed = bodyLines[i].trim();
    
    // Test runner infrastructure
    if (trimmed === 'let passed = 0, failed = 0;') { removeLineIndices.add(i); continue; }
    if (trimmed === 'const tests = [];') { removeLineIndices.add(i); continue; }
    
    // function test(name, fn) { — could be 1 or 2 lines
    if (trimmed.match(/^function\s+test\s*\(\s*name\s*,\s*fn\s*\)\s*\{\s*$/)) {
      removeLineIndices.add(i);
      // Next line should be tests.push(...)
      if (i + 1 < bodyLines.length && bodyLines[i + 1].trim().startsWith('tests.push')) {
        removeLineIndices.add(i + 1);
      }
      // Next should be closing }
      if (i + 2 < bodyLines.length && bodyLines[i + 2].trim() === '}') {
        removeLineIndices.add(i + 2);
      }
      continue;
    }
    
    // Single-line function test(name, fn) { tests.push({ name, fn }); }
    if (trimmed.match(/^function\s+test\s*\(/) && trimmed.includes('tests.push')) {
      removeLineIndices.add(i);
      continue;
    }
    
    // Run loop: for (const { name, fn } of tests) { or similar
    if (trimmed.startsWith('for (') && (trimmed.includes(' of tests') || trimmed.includes(' of { tests }'))) {
      runLoopStartIdx = i;
      // Find the end of this for loop
      let loopBrace = 0;
      for (let j = i; j < bodyLines.length; j++) {
        for (const ch of bodyLines[j]) {
          if (ch === '{') loopBrace++;
          if (ch === '}') loopBrace--;
        }
        removeLineIndices.add(j);
        if (loopBrace === 0 && j > i) break;
      }
      continue;
    }
    
    // Also handle for (const t of tests) pattern
    if (trimmed.startsWith('for (') && trimmed.includes('tests')) {
      runLoopStartIdx = i;
      let loopBrace = 0;
      for (let j = i; j < bodyLines.length; j++) {
        for (const ch of bodyLines[j]) {
          if (ch === '{') loopBrace++;
          if (ch === '}') loopBrace--;
        }
        removeLineIndices.add(j);
        if (loopBrace === 0 && j > i) break;
      }
      continue;
    }
    
    // Also handle: for (const t of tests) { ... } — same pattern
    if (trimmed.match(/^for\s*\(/) && trimmed.includes('tests')) {
      runLoopStartIdx = i;
      let loopBrace = 0;
      for (let j = i; j < bodyLines.length; j++) {
        for (const ch of bodyLines[j]) {
          if (ch === '{') loopBrace++;
          if (ch === '}') loopBrace--;
        }
        removeLineIndices.add(j);
        if (loopBrace === 0 && j > i) break;
      }
      continue;
    }
    
    // Also handle: return { passed, failed };
    if (trimmed === 'return { passed, failed };') { removeLineIndices.add(i); continue; }
    if (trimmed.match(/^return\s*\{\s*passed\s*,\s*failed\s*\}\s*;$/)) { removeLineIndices.add(i); continue; }
    
    // Console.log lines that are just formatting (suite headers/footers)
    if (trimmed.match(/^console\.log\(/) && 
        (trimmed.includes('📋') || trimmed.includes('──') || trimmed.includes('passed,') || 
         trimmed.includes('Total') || trimmed.includes('══'))) {
      removeLineIndices.add(i);
      continue;
    }
  }
  
  // Step 6: Build output body, converting test() → it()
  const outputBody = [];
  for (let i = 0; i < bodyLines.length; i++) {
    if (removeLineIndices.has(i)) continue;
    
    const line = bodyLines[i];
    const trimmed = line.trim();
    
    // Convert test('name', ...) → it('name', ...)
    if (trimmed.startsWith('test(')) {
      const converted = line.replace(/\btest\(/, 'it(');
      outputBody.push(converted);
      continue;
    }
    
    outputBody.push(line);
  }
  
  // Step 7: Assemble final output
  const output = [];
  
  for (const line of preambleLines) output.push(line);
  if (!importLines.some(l => l.includes('@jest/globals'))) {
    output.push("import { describe, it } from '@jest/globals';");
  }
  
  output.push('');
  output.push(`describe('${describeName}', () => {`);
  
  for (const line of outputBody) {
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
  console.log(`Found ${files.length} test files`);
  
  let converted = 0;
  let skipped = 0;
  
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      const result = convertFile(content, filePath);
      
      if (result === null) {
        console.log(`  ⏭️  ${filePath}`);
        skipped++;
        continue;
      }
      
      await writeFile(filePath, result);
      converted++;
    } catch (err) {
      console.error(`  ❌ ${filePath}: ${err.message}`);
    }
  }
  
  console.log(`\nConverted: ${converted}, Skipped: ${skipped}`);
}

main().catch(console.error);
