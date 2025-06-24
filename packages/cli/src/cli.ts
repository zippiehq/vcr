#!/usr/bin/env node
import { execSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';

function checkDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker is not available or not running. Please install/start Docker and try again.');
    process.exit(1);
  }
}

function runLinuxkitContainer() {
  const currentDir = cwd();
  const dockerSocket = '/var/run/docker.sock';
  const imageName = process.env.LINUXKIT_IMAGE || 'linuxkit/linuxkit:latest';
  
  console.log('Starting linuxkit container...');
  console.log(`Using image: ${imageName}`);
  console.log(`Mounting current directory: ${currentDir} -> /work`);
  console.log(`Mounting Docker socket: ${dockerSocket}`);
  
  try {
    const command = [
      'docker', 'run', '--rm', '-it',
      '-v', `${currentDir}:/work`,
      '-v', `${dockerSocket}:${dockerSocket}`,
      '-w', '/work',
      imageName
    ].join(' ');
    
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: 'inherit' });
  } catch (err) {
    console.error('Error running linuxkit container:', err);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure Docker is running');
    console.error('2. Check if the image exists: docker images');
    console.error('3. Set LINUXKIT_IMAGE environment variable to specify a different image');
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
vcr CLI - Verifiable Container Runner

Usage:
  vcr linuxkit    Run linuxkit container with current directory and Docker socket mounted
  vcr --help      Show this help message

Examples:
  vcr linuxkit    # Start linuxkit container with mounts
`);
}

function main() {
  checkDockerAvailable();
  
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case 'linuxkit':
      runLinuxkitContainer();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main(); 