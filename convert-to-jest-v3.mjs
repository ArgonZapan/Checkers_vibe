#!/usr/bin/env node
import { readFile, writeFile, readdir } from 'node:fs/promises';

const testDirs = ['__tests__', 'server/tests'];

async function getTestFiles() {
  const files = [];
  for (const dir of testDirs) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.test.js')) files.push(`${dir}/${entry}`);
    }
  }
  return files;
}

function convertFile(content, filePath) {
  const lines = content.split('\n');
  
  // Find export function
  let exportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^export\s+(async\s+)?function\s+run\w+Tests\s*\(\s*\)\s*\{/)) {
      exportIdx = i; break;
    }
  }
  if (exportIdx === -1) return null;
  
  const exportName = lines[exportIdx].match(/(run\w+Tests)/)[1];
  let describeName = exportName.replace(/^run/, '').replace(/Tests$/, '');
  describeName = describeName.replace(/([a-z])([A-Z])/g, '$1 $2');
  
  const out = [];
  
  // Phase 1: Write preamble (everything before export function)
  for (let i = 0; i < exportIdx; i++) {
    out.push(lines[i]);
  }
  
  // Add jest import
  const hasJest = lines.slice(0, exportIdx).some(l => l.includes('@jest/globals'));
  if (!hasJest) out.push("import { describe, it } from '@jest/globals';");
  out.push('');
  
  // Phase 2: Process function body
  out.push(`describe('${describeName}', () => {`);
  
  let inRunLoop = false;
  let loopBrace = 0;
  let skipFnTest = false;
  let skipBrace = 0;
  
  for (let i = exportIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip: let passed = 0, failed = 0;
    if (trimmed.match(/^let\s+passed\s*=\s*0.*failed.*=\s*0;/)) continue;
    
    // Skip: const tests = [];
    if (trimmed === 'const tests = [];') continue;
    
    // Skip: function test(name, fn) { ... }
    if (trimmed.match(/^function\s+test\s*\(/)) {
      if (trimmed.endsWith('{') && !trimmed.includes('}')) {
        skipFnTest = true; skipBrace = 1;
      }
      continue;
    }
    if (skipFnTest) {
      for (const ch of trimmed) {
        if (ch === '{') skipBrace++;
        if (ch === '}') skipBrace--;
      }
      if (skipBrace <= 0) skipFnTest = false;
      continue;
    }
    
    // Skip: return { passed, failed };
    if (trimmed.match(/^return\s*\{/)) continue;
    
    // Skip console formatting
    if (trimmed.match(/^console\.(log|error)\(/) && 
        (trimmed.includes('──') || trimmed.includes('passed,') || 
         trimmed.includes('Total') || trimmed.includes('📋') ||
         trimmed.includes('═') || trimmed.includes('Suite'))) continue;
    
    // Detect run loop
    if (!inRunLoop && trimmed.match(/^for\s*\(/) && trimmed.includes('tests')) {
      inRunLoop = true;
      loopBrace = 0;
      for (const ch of trimmed) {
        if (ch === '{') loopBrace++;
        if (ch === '}') loopBrace--;
      }
      if (loopBrace <= 0) inRunLoop = false;
      continue;
    }
    if (inRunLoop) {
      for (const ch of trimmed) {
        if (ch === '{') loopBrace++;
        if (ch === '}') loopBrace--;
      }
      if (loopBrace <= 0) inRunLoop = false;
      continue;
    }
    
    // Last line: closing } → });
    if (i === lines.length - 1 && trimmed === '}') {
      out.push('});');
      continue;
    }
    
    // Convert test( → it(
    if (trimmed.startsWith('test(')) {
      out.push(line.replace(/\btest\(/, 'it('));
      continue;
    }
    
    out.push(line);
  }
  
  return out.join('\n');
}

async function main() {
  const files = await getTestFiles();
  let converted = 0, skipped = 0;
  
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf8');
      const result = convertFile(content, filePath);
      if (result === null) { console.log(`⏭️  ${filePath}`); skipped++; continue; }
      await writeFile(filePath, result);
      converted++;
    } catch (err) {
      console.error(`❌ ${filePath}: ${err.message}`);
    }
  }
  console.log(`Converted: ${converted}, Skipped: ${skipped}`);
}

main().catch(console.error);
