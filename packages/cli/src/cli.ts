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

function checkBuildxAvailable() {
  try {
    execSync('docker buildx version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker buildx is not available. Please install Docker buildx and try again.');
    process.exit(1);
  }
}

function checkVcrBuilder() {
  try {
    execSync('docker buildx inspect vcr-builder', { stdio: 'ignore' });
    
    // Ensure builder can access the registry network
    try {
      execSync('docker network connect vcr-network vcr-builder0', { stdio: 'ignore' });
    } catch (err) {
      // Already connected or network doesn't exist yet, that's fine
    }
  } catch (err) {
    console.log('⚠️  vcr-builder not found. Creating it...');
    try {
      // Create BuildKit configuration
      const configPath = createBuildKitConfig();
      
      // Create builder with BuildKit configuration
      const createCommand = configPath 
        ? `docker buildx create --name vcr-builder --use --driver docker-container --config=${configPath}`
        : 'docker buildx create --name vcr-builder --use --driver docker-container';
      
      execSync(createCommand, { stdio: 'inherit' });
      console.log('✅ vcr-builder created successfully');
      
      console.log('Bootstrapping vcr-builder...');
      execSync('docker buildx inspect --bootstrap', { stdio: 'inherit' });
      console.log('✅ vcr-builder bootstrapped and ready');
      
      // Connect to registry network
      try {
        execSync('docker network connect vcr-network vcr-builder0', { stdio: 'ignore' });
        console.log('✅ vcr-builder connected to vcr-network');
      } catch (networkErr) {
        console.log('ℹ️  Network connection will be handled later');
      }
    } catch (createErr) {
      console.error('Error creating vcr-builder:', createErr);
      process.exit(1);
    }
  }
}

function checkLocalRegistry() {
  try {
    const registryRunning = execSync('docker ps --filter "name=vcr-registry" --format "{{.Names}}"', { encoding: 'utf8' }).trim();
    if (registryRunning) {
      // Registry is running, no need to print
    } else {
      console.log('⚠️  vcr-registry not running. Starting it...');
      startLocalRegistry();
    }
  } catch (err) {
    console.log('⚠️  vcr-registry not running. Starting it...');
    startLocalRegistry();
  }
}

function startLocalRegistry() {
  try {
    // Create a custom network for registry communication
    try {
      execSync('docker network create vcr-network', { stdio: 'ignore' });
      console.log('✅ vcr-network created');
    } catch (err) {
      // Network might already exist, that's fine
      console.log('ℹ️  vcr-network already exists');
    }
    
    // Check if registry container exists but is stopped
    const registryExists = execSync('docker ps -a --filter "name=vcr-registry" --format "{{.Names}}"', { encoding: 'utf8' }).trim();
    
    if (registryExists) {
      console.log('Starting existing vcr-registry container...');
      execSync('docker start vcr-registry', { stdio: 'inherit' });
    } else {
      console.log('Creating and starting vcr-registry...');
      // Configure registry as insecure for local development with HTTP
      const registryConfig = {
        version: '0.1',
        storage: {
          delete: { enabled: true }
        },
        http: {
          addr: ':5000',
          headers: {
            'X-Content-Type-Options': ['nosniff']
          }
        }
      };
      
      // Write config to temp file
      const configPath = '/tmp/registry-config.yml';
      writeFileSync(configPath, JSON.stringify(registryConfig, null, 2));
      
      execSync(`docker run -d -p 5001:5000 --restart=always --name vcr-registry --network vcr-network -v ${configPath}:/etc/docker/registry/config.yml registry:3`, { stdio: 'inherit' });
    }
    
    // Connect existing registry to network if not already connected
    try {
      execSync('docker network connect vcr-network vcr-registry', { stdio: 'ignore' });
    } catch (err) {
      // Already connected, that's fine
    }
    
    // Wait for registry to be ready by checking HTTP connectivity
    console.log('Waiting for registry to be ready...');
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    
    while (attempts < maxAttempts) {
      try {
        execSync('curl -f http://localhost:5001/v2/', { stdio: 'ignore' });
        console.log('✅ vcr-registry is ready');
        return;
      } catch (err) {
        attempts++;
        if (attempts < maxAttempts) {
          console.log(`Waiting for registry... (attempt ${attempts}/${maxAttempts})`);
          execSync('sleep 1', { stdio: 'ignore' });
        }
      }
    }
    
    console.error('Error: Registry failed to start within 30 seconds');
    process.exit(1);
    
  } catch (err) {
    console.error('Error starting vcr-registry:', err);
    process.exit(1);
  }
}

function getNativePlatform(): string {
  try {
    const os = execSync('docker version --format "{{.Server.Os}}"', { encoding: 'utf8' }).trim();
    const arch = execSync('docker version --format "{{.Server.Arch}}"', { encoding: 'utf8' }).trim();
    return `${os}/${arch}`;
  } catch (err) {
    console.error('Error: Could not determine native platform');
    process.exit(1);
  }
}

function resolvePlatforms(profile: string): string[] {
  switch (profile) {
    case 'dev':
      return [getNativePlatform()];
    case 'test':
    case 'prod':
    case 'prod-debug':
      return ['linux/riscv64'];
    default:
      console.error(`Error: Unknown profile '${profile}'`);
      process.exit(1);
  }
}

function verifyRegistryConnectivity() {
  try {
    execSync('curl -f http://localhost:5001/v2/', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Cannot connect to registry at localhost:5001');
    console.error('Please ensure vcr-registry is running');
    process.exit(1);
  }
}

function buildImage(imageTag: string, profile: string, cacheDir?: string) {
  const currentDir = cwd();
  console.log(`Building image: ${imageTag}`);
  console.log(`Profile: ${profile}`);
  
  // Check if Dockerfile exists
  if (!existsSync(join(currentDir, 'Dockerfile'))) {
    console.error('Error: No Dockerfile found in current directory');
    process.exit(1);
  }
  
  // Resolve platforms
  const platforms = resolvePlatforms(profile);
  
  // Construct full image name with local registry
  const fullImageName = `host.docker.internal:5001/${imageTag}`;
  
  // Build command
  const buildArgs = [
    'buildx',
    'build',
    '--builder', 'vcr-builder',
    '--platform', platforms.join(','),
    '-t', fullImageName,
    '--push'
  ];
  
  // Add cache directory if specified
  if (cacheDir) {
    buildArgs.push('--cache-from', `type=local,src=${cacheDir}`);
    buildArgs.push('--cache-to', `type=local,dest=${cacheDir},mode=max`);
  }
  
  // Add context directory
  buildArgs.push('.');
  
  const buildCommand = `docker ${buildArgs.join(' ')}`;
  
  try {
    verifyRegistryConnectivity();
    execSync(buildCommand, { stdio: 'inherit', cwd: currentDir });
    console.log(`\n✅ Build completed successfully!`);
    console.log(`Image pushed to: localhost:5001/${imageTag}`);
    
    // For test profile, also build LinuxKit image
    if (profile === 'test') {
      console.log('\n🔄 Building LinuxKit image for test profile...');
      const yamlPath = generateLinuxKitYaml(imageTag);
      buildLinuxKitImage(yamlPath);
    }
  } catch (err) {
    console.error('Error building image:', err);
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
      traefik: {
        image: 'traefik:v2.10',
        container_name: 'vcr-traefik',
        command: [
          '--api.insecure=true',
          '--providers.docker=true',
          '--providers.docker.exposedbydefault=false',
          '--entrypoints.web.address=:8080'
        ],
        ports: ['8080:8080'],
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        networks: ['internal_net', 'external_net'],
        labels: [
          'traefik.enable=true',
          'traefik.http.routers.traefik.rule=Host(`localhost`) && PathPrefix(`/api`) || PathPrefix(`/dashboard`)',
          'traefik.http.routers.traefik.service=api@internal',
          'traefik.http.routers.traefik.entrypoints=web'
        ]
      },
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
        labels: [
          'traefik.enable=true',
          'traefik.http.routers.isolated.rule=PathPrefix(`/function`)',
          'traefik.http.routers.isolated.entrypoints=web',
          'traefik.http.services.isolated.loadbalancer.server.port=8080',
          'traefik.http.services.isolated.loadbalancer.server.scheme=http'
        ]
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
    console.log('- Traefik Dashboard: http://localhost:8080/dashboard/');
    console.log('- Function endpoint: http://localhost:8080/function');
    console.log('- Health check: http://localhost:8080/function/health');
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
  vcr build -t <name:tag> [options]  Build and push container images
  vcr run dev                        Build and run development environment with isolated networking
  vcr linuxkit                       Run linuxkit container with current directory and Docker socket mounted
  vcr --help                         Show this help message

Build Options:
  -t, --tag <name:tag>              Image name:tag (required)
  --profile <dev|test|prod|prod-debug>  Build profile (default: dev)
  --cache-dir <dir>                 Optional path to store exported build metadata

Build Profiles:
  dev        Native platform only, no dev tools, no attestation
  test       RISC-V 64-bit, with dev tools, no attestation
  prod       RISC-V 64-bit, no dev tools, with attestation
  prod-debug RISC-V 64-bit, with dev tools, with attestation

Examples:
  vcr build -t web3link/myapp:1.2.3                    # Fast dev loop (native)
  vcr build -t web3link/myapp:1.2.3 --profile test     # RISC-V with dev tools
  vcr build -t web3link/myapp:1.2.3 --profile prod     # Production RISC-V
  vcr run dev                                          # Start dev environment
  vcr linuxkit                                         # Start linuxkit container

Prerequisites:
  - Docker and buildx installed
  - vcr-builder and vcr-registry will be created/started automatically if needed
`);
}

function checkRiscv64Support() {  
  try {
    // Try to run hello-world RISC-V 64-bit image
    execSync('docker run --rm --platform linux/riscv64 hello-world:latest', { stdio: 'pipe' });
  } catch (err) {
    console.log('⚠️  RISC-V 64-bit binary execution not supported. Installing binfmt emulation...');
    try {
      execSync('docker run --privileged --rm tonistiigi/binfmt --install riscv64', { stdio: 'inherit' });
      console.log('✅ RISC-V 64-bit binfmt emulation installed');
      
      // Verify installation worked
      console.log('Verifying RISC-V 64-bit support...');
      execSync('docker run --rm --platform linux/riscv64 hello-world:latest', { stdio: 'pipe' });
      console.log('✅ RISC-V 64-bit binary execution is now supported');
    } catch (installErr) {
      console.error('Error installing RISC-V 64-bit support:', installErr);
      console.error('Please run manually: docker run --privileged --rm tonistiigi/binfmt --install riscv64');
      process.exit(1);
    }
  }
}

function createBuildKitConfig() {
  console.log('Creating BuildKit configuration for insecure registry...');
  try {
    const buildkitConfig = `[registry."vcr-registry:5000"]
http = true
insecure = true

[registry."host.docker.internal:5001"]
http = true
insecure = true

[registry."localhost:5001"]
http = true
insecure = true
`;
    
    const configPath = '/tmp/buildkitd.toml';
    writeFileSync(configPath, buildkitConfig);
    console.log('✅ BuildKit configuration created');
    return configPath;
  } catch (err) {
    console.error('Error creating BuildKit config:', err);
    return null;
  }
}

function generateLinuxKitYaml(imageTag: string) {
  const yamlConfig = `init:
  - ghcr.io/zippiehq/vcr-init:8eea386739975a43af558eec757a7dcb3a3d2e7b
  - ghcr.io/zippiehq/vcr-runc:667e7ea2c426a2460ca21e3da065a57dbb3369c9
  - ghcr.io/zippiehq/vcr-containerd:a988a1a8bcbacc2c0390ca0c08f949e2b4b5915d
onboot:
  - name: dhcpcd
    image: ghcr.io/zippiehq/vcr-dhcpcd:157df9ef45a035f1542ec2270e374f18efef98a5
    command: ["/sbin/dhcpcd", "--nobackground", "-f", "/dhcpcd.conf", "-1"]
services:
  - name: getty
    image: ghcr.io/zippiehq/vcr-getty:05eca453695984a69617f1f1f0bcdae7f7032967
    env:
     - INSECURE=true
  - name: app
    image: localhost:5001/${imageTag}
`;
  
  const yamlPath = join(cwd(), 'minimal.yml');
  writeFileSync(yamlPath, yamlConfig);
  console.log(`Generated LinuxKit YAML: ${yamlPath}`);
  return yamlPath;
}

function buildLinuxKitImage(yamlPath: string) {
  console.log('Building LinuxKit image...');
  
  const currentDir = cwd();
  const imageName = process.env.LINUXKIT_IMAGE || 'ghcr.io/zippiehq/vcr-linuxkit-builder:latest';
  
  console.log(`Using LinuxKit image: ${imageName}`);
  console.log(`Working directory: ${currentDir}`);
  
  try {
    const command = [
      'docker', 'run', '--rm',
      '--network', 'host',
      '-v', `${currentDir}:/work`,
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
      '-w', '/work',
      imageName,
      'build', '--format', 'tar', '--arch', 'riscv64', '--decompress-kernel', 'minimal.yml'
    ].join(' ');
    
    console.log(`Executing: ${command}`);
    execSync(command, { stdio: 'inherit', cwd: currentDir });
    
    console.log('✅ LinuxKit image built successfully');    
  } catch (err) {
    console.error('Error building LinuxKit image:', err);
    process.exit(1);
  }
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
    case 'build':
      checkBuildxAvailable();
      checkVcrBuilder();
      checkLocalRegistry();
      
      let imageTag: string | undefined;
      let profile = 'dev';
      let cacheDir: string | undefined;
      
      // Parse build arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        if (arg === '-t' || arg === '--tag') {
          if (nextArg) {
            imageTag = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: -t/--tag requires a value');
            process.exit(1);
          }
        } else if (arg === '--profile') {
          if (nextArg) {
            profile = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --profile requires a value');
            process.exit(1);
          }
        } else if (arg === '--cache-dir') {
          if (nextArg) {
            cacheDir = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --cache-dir requires a value');
            process.exit(1);
          }
        }
      }
      
      if (!imageTag) {
        console.error('Error: -t/--tag is required');
        process.exit(1);
      }
      
      // Check RISC-V support if needed
      if (profile !== 'dev') {
        checkRiscv64Support();
      }
      
      buildImage(imageTag, profile, cacheDir);
      break;
      
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