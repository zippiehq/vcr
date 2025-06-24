#!/usr/bin/env node
import { execSync } from 'child_process';

function checkDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker is not available or not running. Please install/start Docker and try again.');
    process.exit(1);
  }
}

function main() {
  checkDockerAvailable();
  // TODO: Add command parsing and implementation
  console.log('vcr CLI (placeholder)');
}

main(); 