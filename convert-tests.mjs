#!/usr/bin/env node
/**
 * convert-tests.mjs — Convert custom runner test files to Jest API.
 * 
 * For each .test.js file:
 * 1. Keep ESM imports as-is
 * 2. Wrap all content in describe()
 * 3. Convert test(name, () => { ... }) to it(name, () => { ... })
 * 4. Remove the run loop and export function wrapper
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

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
  const result = [];
  let inImports = true;
  let inFunction = false;
  let inRunLoop = false;
  let braceDepth = 0;
  let funcStartLine = -1;
  let describeName = '';
  let testCallIndent = '';
  let foundExport = false;
  
  // Phase 1: Collect imports and the body of the exported function
  const imports = [];
  const functionBody = [];
  let exportMatch = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Collect import lines
    if (inImports && (trimmed.startsWith('import ') || trimmed === '' || trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/') || trimmed.startsWith('//'))) {
      if (trimmed.startsWith('import ')) {
        imports.push(line);
      } else if (!trimmed.startsWith('export ')) {
        imports.push(line);
      }
      if (trimmed.startsWith('export ')) {
        inImports = false;
      }
      continue;
    }
    
    // Detect export async function runXxxTests()
    const expMatch = line.match(/^export\s+async\s+function\s+(\w+)\s*\(\s*\)\s*\{/);
    if (expMatch) {
      inFunction = true;
      braceDepth = 1;
      foundExport = true;
      describeName = expMatch[1].replace(/^run/, '').replace(/Tests$/, '');
      // Convert camelCase to spaced words for describe name
      describeName = describeName.replace(/([a-z])([A-Z])/g, '$1 $2');
      continue;
    }
    
    if (inFunction) {
      // Track brace depth
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      
      // Detect the run loop start
      if (trimmed.startsWith('for (') && (trimmed.includes(' of tests') || trimmed.includes(' of { tests }'))) {
        inRunLoop = true;
      }
      
      // Detect console.log lines that are just formatting
      if (trimmed.startsWith('console.log(') && (trimmed.includes('📋') || trimmed.includes('──') || trimmed.includes('passed,') || trimmed.includes('Total'))) {
        continue;
      }
      
      // Detect return { passed, failed }
      if (trimmed.startsWith('return {') && trimmed.includes('passed') && trimmed.includes('failed')) {
        continue;
      }
      
      if (!inRunLoop) {
        functionBody.push(line);
      }
      
      if (braceDepth === 0) {
        inFunction = false;
      }
    }
  }
  
  if (!foundExport) {
    return null; // Not a convertible file
  }
  
  // Phase 2: Process the function body
  // Replace local test() calls with it()
  // Replace let passed = 0, failed = 0; with nothing
  // Replace const tests = []; with nothing
  // Replace function test(name, fn) { tests.push({ name, fn }); } with nothing
  
  const processedBody = [];
  for (const line of functionBody) {
    const trimmed = line.trim();
    
    // Skip test infrastructure lines
    if (trimmed === 'let passed = 0, failed = 0;') continue;
    if (trimmed === 'const tests = [];') continue;
    if (trimmed.match(/^function\s+test\s*\(\s*name\s*,\s*fn\s*\)\s*\{\s*$/)) continue;
    if (trimmed === 'tests.push({ name, fn });') continue;
    if (trimmed === '}') {
      // This could be closing function test() or something else
      // We need to track this better, but for now skip single } lines after tests.push
      continue;
    }
    
    // Convert test('name', () => { → it('name', () => {
    const testCallMatch = line.match(/^(\s*)test\((.*)/);
    if (testCallMatch) {
      const indent = testCallMatch[1];
      const rest = testCallMatch[2];
      // Check if it's test('name', async () => { or test('name', () => {
      processedBody.push(`${indent}it(${rest}`);
      continue;
    }
    
    processedBody.push(line);
  }
  
  // Phase 3: Assemble the output
  const result2 = [];
  
  // Add imports
  for (const imp of imports) {
    // Add jest globals import
    if (imp.trim().startsWith('import assert')) {
      result2.push(imp);
      result2.push("import { describe, it, expect } from '@jest/globals';");
    } else {
      result2.push(imp);
    }
  }
  
  // Remove duplicate jest globals import
  const seenJestImport = new Set();
  
  result2.push('');
  result2.push(`describe('${describeName}', () => {`);
  
  for (const line of processedBody) {
    if (line.trim() === '') {
      result2.push(line);
    } else {
      result2.push('  ' + line);
    }
  }
  
  result2.push('});');
  result2.push('');
  
  return result2.join('\n');
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
        console.log(`  ⏭️  ${filePath} — no export function found, skipping`);
        skipped++;
        continue;
      }
      
      await writeFile(filePath, result);
      console.log(`  ✅ ${filePath}`);
      converted++;
    } catch (err) {
      console.error(`  ❌ ${filePath}: ${err.message}`);
    }
  }
  
  console.log(`\nConverted: ${converted}, Skipped: ${skipped}`);
}

main().catch(console.error);
