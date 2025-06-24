#!/usr/bin/env node
import { execSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, unlinkSync } from 'fs';

function checkDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker is not available or not running. Please install/start Docker and try again.');
    process.exit(1);
  }
}

function buildDevContainer() {
  const currentDir = cwd();
  console.log('Building development container...');
  
  try {
    // Check if Dockerfile exists
    if (!existsSync(join(currentDir, 'Dockerfile'))) {
      console.error('Error: No Dockerfile found in current directory');
      process.exit(1);
    }
    
    const imageName = 'vcr-dev-local';
    const buildCommand = `docker build -t ${imageName} .`;
    
    console.log(`Building image: ${imageName}`);
    console.log(`Executing: ${buildCommand}`);
    execSync(buildCommand, { stdio: 'inherit', cwd: currentDir });
    
    return imageName;
  } catch (err) {
    console.error('Error building development container:', err);
    process.exit(1);
  }
}

function generateDockerCompose(imageName: string) {
  const composeConfig = {
    version: '3.8',
    services: {
      isolated_service: {
        image: imageName,
        container_name: 'vcr-isolated-service',
        networks: ['internal_net'],
        healthcheck: {
          test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
          interval: '30s',
          timeout: '10s',
          retries: 3,
          start_period: '40s'
        },
        ports: ['8080:8080']
      },
      internet_service: {
        image: 'alpine',
        container_name: 'vcr-internet-service',
        command: 'sleep infinity',
        networks: ['internal_net', 'external_net']
      }
    },
    networks: {
      internal_net: {
        driver: 'bridge',
        internal: true
      },
      external_net: {
        driver: 'bridge'
      }
    }
  };
  
  const composePath = join(cwd(), 'docker-compose.dev.json');
  writeFileSync(composePath, JSON.stringify(composeConfig, null, 2));
  return composePath;
}

function runDevEnvironment() {
  console.log('Starting development environment...');
  
  try {
    // Build the container
    const imageName = buildDevContainer();
    
    // Generate Docker Compose configuration
    const composePath = generateDockerCompose(imageName);
    console.log(`Generated Docker Compose config: ${composePath}`);
    
    // Start services
    console.log('Starting services with Docker Compose...');
    const upCommand = `docker compose -f ${composePath} up -d --wait`;
    execSync(upCommand, { stdio: 'inherit' });
    
    // Wait for health checks
    console.log('Waiting for health checks...');
    const waitCommand = `docker compose -f ${composePath} ps`;
    execSync(waitCommand, { stdio: 'inherit' });
    
    console.log('\nDevelopment environment is ready!');
    console.log('- Isolated service: http://localhost:8080');
    console.log('- Health check: http://localhost:8080/health');
    console.log('- To stop: docker compose -f docker-compose.dev.json down');
    console.log('- To view logs: docker compose -f docker-compose.dev.json logs -f');
    
  } catch (err) {
    console.error('Error starting development environment:', err);
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
  vcr run dev     Build and run development environment with isolated networking
  vcr linuxkit    Run linuxkit container with current directory and Docker socket mounted
  vcr --help      Show this help message

Examples:
  vcr run dev     # Build container and start dev environment
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
    case 'run':
      if (args[1] === 'dev') {
        runDevEnvironment();
      } else {
        console.error(`Unknown run command: ${args[1]}`);
        showHelp();
        process.exit(1);
      }
      break;
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