#!/usr/bin/env node

// Simple test script for tar context functionality
const { execSync } = require('child_process');
const { join } = require('path');
const { existsSync, writeFileSync, mkdirSync } = require('fs');

console.log('🧪 Testing tar context functionality...');

// Create a test directory
const testDir = join(__dirname, 'test-context');
if (existsSync(testDir)) {
  execSync(`rm -rf "${testDir}"`);
}
mkdirSync(testDir, { recursive: true });

// Create some test files
writeFileSync(join(testDir, 'Dockerfile'), 'FROM alpine:latest\nCOPY . /app\n');
writeFileSync(join(testDir, 'app.py'), 'print("Hello, World!")\n');
writeFileSync(join(testDir, 'requirements.txt'), 'flask\n');
writeFileSync(join(testDir, '.dockerignore'), '*.pyc\n__pycache__\n.git\nnode_modules\n');

// Create a subdirectory
mkdirSync(join(testDir, 'src'));
writeFileSync(join(testDir, 'src', 'main.py'), 'print("Main app")\n');

// Create files that should be ignored
writeFileSync(join(testDir, 'test.pyc'), 'ignored\n');
mkdirSync(join(testDir, '__pycache__'));
writeFileSync(join(testDir, '__pycache__', 'test.pyc'), 'ignored\n');

console.log('✅ Test files created');

// Test the tar context builder
try {
  const { TarContextBuilder } = require('./dist/tar-context');
  
  const builder = new TarContextBuilder({
    contextPath: testDir,
    outputPath: join(testDir, 'context.tar'),
    deterministic: true,
    forceDocker: true
  });
  
  console.log('📦 Creating tar context...');
  const tarPath = builder.createTar();
  console.log(`✅ Tar created: ${tarPath}`);
  
  // List contents of tar
  console.log('📋 Tar contents:');
  const contents = execSync(`tar -tf "${tarPath}"`, { encoding: 'utf8' });
  console.log(contents);
  
  // Clean up
  builder.cleanup();
  execSync(`rm -rf "${testDir}"`);
  
  console.log('✅ Test completed successfully!');
} catch (err) {
  console.error('❌ Test failed:', err);
  process.exit(1);
} 