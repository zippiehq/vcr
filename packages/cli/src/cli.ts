#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { handleBuildCommand, handleUpCommand } from './commands/build';
import { handleLogsCommand, handleExecCommand, handleShellCommand, handleCatCommand } from './commands/container';
import { generateLinuxKitYaml, generateDockerCompose } from './generate';

export function checkDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker is not available or not running. Please install/start Docker and try again.');
    process.exit(1);
  }
}

function checkVsockSupport() {
  console.log('Checking for vsock support...');
  try {
    // Run a privileged container to check for /dev/vsock
    const result = execSync('docker run --rm --privileged alpine:latest ls -la /dev/vsock', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    if (result.includes('/dev/vsock')) {
      console.log('✅ vsock support detected');
      return true;
    } else {
      console.error('❌ Error: /dev/vsock not found in privileged container');
      console.error('vsock support is required for VCR to function properly.');
      console.error('Please ensure your system supports vsock or install the necessary kernel modules.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error: Failed to check vsock support');
    console.error('vsock support is required for VCR to function properly.');
    console.error('Please ensure your system supports vsock or install the necessary kernel modules.');
    console.error('');
    console.error('You can try installing vsock support with:');
    console.error('  sudo modprobe vsock_loopback');
    console.error('  sudo modprobe vhost_vsock');
    process.exit(1);
  }
}

export function checkBuildxAvailable() {
  try {
    execSync('docker buildx version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker buildx is not available. Please install Docker buildx and try again.');
    process.exit(1);
  }
}

export function checkVcrBuilder() {
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
      // Ensure vcr-network exists before creating builder
      try {
        execSync('docker network create vcr-network', { stdio: 'ignore' });
        console.log('✅ vcr-network created');
      } catch (networkErr) {
        // Network might already exist, that's fine
        console.log('ℹ️  vcr-network already exists');
      }
      
      // Create BuildKit configuration
      const configPath = createBuildKitConfig();
      
      // Create builder with BuildKit configuration
      const createCommand = configPath 
        ? `docker buildx create --name vcr-builder --use --driver docker-container --driver-opt network=vcr-network --config=${configPath}`
        : 'docker buildx create --name vcr-builder --use --driver docker-container --driver-opt network=vcr-network';
      
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

export function checkLocalRegistry() {
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

function getCacheDirectory(imageDigest?: string): string {
  const baseCacheDir = join(homedir(), '.cache', 'vcr');
  
  // Create base cache directory if it doesn't exist
  if (!existsSync(baseCacheDir)) {
    mkdirSync(baseCacheDir, { recursive: true });
  }
  
  if (imageDigest) {
    // Remove 'sha256:' prefix for directory name
    const digestDir = imageDigest.replace('sha256:', '');
    const digestCacheDir = join(baseCacheDir, digestDir);
    
    // Create digest-specific cache directory if it doesn't exist
    if (!existsSync(digestCacheDir)) {
      mkdirSync(digestCacheDir, { recursive: true });
    }
    
    return digestCacheDir;
  }
  
  return baseCacheDir;
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

function getRegistryUrl(context: 'host' | 'docker' = 'docker'): string {
  // For host access (from CLI script), use localhost:5001
  // For Docker network access (from containers), use vcr-registry:5000
  return context === 'host' ? 'localhost:5001' : 'vcr-registry:5000';
}

export function buildImage(imageTag: string, profile: string, cacheDir?: string, forceRebuild = false): string | undefined {
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
  const fullImageName = `vcr-registry:5000/${imageTag}`;
  
  // Build command
  const buildArgs = [
    'buildx',
    'build',
    '--builder', 'vcr-builder',
    '--platform', platforms.join(','),
    '-t', fullImageName,
    '--push',
    '--provenance=false',
    '--sbom=false'
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
    execSync(buildCommand, { 
      stdio: 'inherit', 
      cwd: currentDir,
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' }
    });
    console.log(`\n✅ Build completed successfully!`);
    console.log(`Image pushed to: ${getRegistryUrl('docker')}/${imageTag}`);
    
    // Capture the image digest after successful build
    let imageDigest: string | undefined;
    try {
      const localImageName = `${getRegistryUrl('host')}/${imageTag}`;
      const digestOutput = execSync(`docker buildx imagetools inspect ${localImageName} --format '{{json .}}'`, { encoding: 'utf8' });
      const digestData = JSON.parse(digestOutput);
      imageDigest = digestData.manifest.digest;
      console.log(`Image digest: ${imageDigest}`);
    } catch (digestErr) {
      console.log('Could not retrieve image digest');
    }
    
    // Get cache directory based on image digest
    const cacheDir = getCacheDirectory(imageDigest);
    console.log(`Cache directory: ${cacheDir}`);
    
    // For test and prod profiles, also build LinuxKit image
    if (profile === 'test' || profile === 'prod') {
      console.log(`\n🔄 Building LinuxKit image for ${profile} profile...`);
      const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, imageDigest);
      buildLinuxKitImage(yamlPath, profile, imageDigest, cacheDir, forceRebuild);
    }
    
    return imageDigest;
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

export function getPathHash(): string {
  const currentPath = cwd();
  return createHash('sha256').update(currentPath).digest('hex').substring(0, 8);
}

export function getComposeCacheDirectory(): string {
  const pathHash = getPathHash();
  const composeCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  // Create compose cache directory if it doesn't exist
  if (!existsSync(composeCacheDir)) {
    mkdirSync(composeCacheDir, { recursive: true });
  }
  
  return composeCacheDir;
}

export function detectProfileAndSshKey(): { profile: 'dev' | 'test' | 'prod', sshKeyPath?: string } {
  const pathHash = getPathHash();
  const containerName = `${pathHash}-vcr-isolated-service`;
  
  try {
    const containerInfo = execSync(`docker inspect ${containerName} --format '{{.Config.Image}}'`, { encoding: 'utf8' }).trim();
    
    if (containerInfo === 'ghcr.io/zippiehq/vcr-snapshot-builder') {
      // This is a test or prod profile - find SSH key and determine which one
      const baseCacheDir = join(homedir(), '.cache', 'vcr');
      let sshKeyPath: string | undefined;
      
      if (existsSync(baseCacheDir)) {
        // First check base cache directory
        const baseKeyPath = join(baseCacheDir, 'ssh.debug-key');
        if (existsSync(baseKeyPath)) {
          sshKeyPath = baseKeyPath;
        } else {
          // Check digest-specific directories
          const cacheEntries = execSync(`ls -1 "${baseCacheDir}"`, { encoding: 'utf8' }).trim().split('\n');
          for (const entry of cacheEntries) {
            if (entry && entry !== 'linuxkit-cache') { // Skip non-digest directories
              const digestKeyPath = join(baseCacheDir, entry, 'ssh.debug-key');
              if (existsSync(digestKeyPath)) {
                sshKeyPath = digestKeyPath;
                break;
              }
            }
          }
        }
      }
      
      // Determine if it's test or prod by checking the command
      try {
        const containerCmd = execSync(`docker inspect ${containerName} --format '{{join .Config.Cmd " "}}'`, { encoding: 'utf8' }).trim();
        if (containerCmd.includes('cartesi-machine')) {
          return { profile: 'prod', sshKeyPath };
        } else {
          return { profile: 'test', sshKeyPath };
        }
      } catch (cmdErr) {
        // Fallback to test if we can't determine
        return { profile: 'test', sshKeyPath };
      }
    } else {
      return { profile: 'dev' };
    }
  } catch (inspectErr) {
    // Fallback to dev profile if we can't inspect the container
    return { profile: 'dev' };
  }
}



export function runDevEnvironment(imageTag: string, profile: string, cacheDir?: string, forceRebuild = false, forceRestart = false) {
  console.log('Starting development environment...');
  
  try {
    // Check for potential port conflicts
    console.log('Checking for potential port conflicts...');
    try {
      // Get all running containers and their port mappings
      const allContainers = execSync('docker ps --format "{{.Names}}:{{.Ports}}"', { encoding: 'utf8' }).trim();
      const pathHash = getPathHash();
      
      // Check for containers using port 8080 that aren't ours
      const containersUsing8080 = allContainers.split('\n').filter(line => 
        line.includes(':8080') && !line.startsWith(`${pathHash}-vcr-`)
      );
      
      if (containersUsing8080.length > 0) {
        console.error('❌ Error: Port 8080 is already in use by another container');
        containersUsing8080.forEach(container => console.error(`   ${container}`));
        console.error('');
        console.error('Please stop the conflicting container or use a different port.');
        console.error('You can stop all VCR environments with: vcr prune --local');
        process.exit(1);
      }
    } catch (err) {
      console.log('ℹ️  Could not check for port conflicts');
    }
    
    // Check for vsock support
    checkVsockSupport();
    
    // Build the container
    const imageDigest = buildImage(imageTag, profile, cacheDir, forceRebuild);
    
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    let needsUpdate = false;
    
    // Check if compose file exists and if tag matches
    if (!forceRestart && existsSync(composePath)) {
      try {
        const composeContent = readFileSync(composePath, 'utf8');
        const composeConfig = JSON.parse(composeContent);
        const currentImage = composeConfig.services?.isolated_service?.image;
        
        if (currentImage) {
          const expectedImage = imageDigest ? `localhost:5001/${imageTag}@${imageDigest}` : `localhost:5001/${imageTag}`;
          if (currentImage !== expectedImage) {
            console.log(`🔄 Image tag changed from ${currentImage} to ${expectedImage}`);
            needsUpdate = true;
          } else {
            console.log('✅ Image tag matches existing compose file');
          }
        }
      } catch (err) {
        console.log('⚠️  Could not read existing compose file, will regenerate');
        needsUpdate = true;
      }
    } else {
      needsUpdate = true;
    }
    
    // Generate or update Docker Compose configuration
    if (needsUpdate) {
      generateDockerCompose(imageTag, profile, imageDigest);
      console.log(`Generated Docker Compose config: ${composePath}`);
    }
    
    // Start services
    console.log('Starting services with Docker Compose...');
    if (needsUpdate) {
      // Check if containers already exist
      const containersExist = existsSync(composePath) && execSync(`docker compose -f ${composePath} ps --services --filter "status=running"`, { encoding: 'utf8' }).trim().length > 0;
      
      if (containersExist) {
        // Containers exist, force recreate only the isolated_service
        console.log('Force recreating isolated_service...');
        execSync(`docker compose -f ${composePath} up -d --force-recreate isolated_service`, { stdio: 'inherit' });
      } else {
        // First startup, just start all services normally
        console.log('Starting all services...');
        execSync(`docker compose -f ${composePath} up -d --wait`, { stdio: 'inherit' });
      }
    } else {
      // Just ensure all services are running
      execSync(`docker compose -f ${composePath} up -d --wait`, { stdio: 'inherit' });
    }
    
    // Wait for health checks
    console.log('Waiting for health checks...');
    const waitCommand = `docker compose -f ${composePath} ps`;
    execSync(waitCommand, { stdio: 'inherit' });
    
    console.log('\nDevelopment environment is ready!');
    console.log('- Function endpoint: http://localhost:8080/function');
    console.log('- Health check: http://localhost:8080/function/health');
    console.log('- To stop: vcr down');
    console.log('- To view container logs: vcr logs');
    console.log('- To follow container logs: vcr logs -f');
    console.log('- To view system logs: vcr logs --system');
    
  } catch (err) {
    console.error('Error starting development environment:', err);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
vcr CLI - Verifiable Container Runner

Usage:
  vcr create <dir> --template <lang>  Create new project from template
  vcr build [-t <name:tag>] [options]  Build and push container images
  vcr up [-t <name:tag>] [options]    Build and run development environment with isolated networking
  vcr down                           Stop development environment
  vcr logs [-f|--follow] [--system]  View container or system logs
  vcr exec [--system] <command>      Execute command in container or system
  vcr shell [--system]               Open shell in container or system
  vcr cat <file-path>                View file contents in container
  vcr prune [--local]                Clean up VCR environment (cache, registry, builder)
  vcr --help                         Show this help message

Create Options:
  --template <lang>                  Template language (e.g., python, node, go, rust)

Build Options:
  -t, --tag <name:tag>              Image name:tag (optional, defaults to vcr-build-<path-hash>:latest)
  --profile <dev|test|prod|prod-debug>  Build profile (default: dev)
  --cache-dir <dir>                 Optional path to store exported build metadata
  --force-rebuild                   Force rebuild of cached artifacts (LinuxKit, Cartesi machine, etc.)
  --restart                         Force restart containers even if image tag matches (up command only)

Prune Options:
  --local                           Only clean current project's cache and stop its environment

Build Profiles:
  dev        Native platform only, no dev tools, no attestation
  test       RISC-V 64-bit, with dev tools, no attestation
  prod       RISC-V 64-bit, no dev tools, with attestation
  prod-debug RISC-V 64-bit, with dev tools, with attestation

Examples:
  vcr create myapp --template python    # Create new Python project
  vcr create webapp --template node     # Create new Node.js project
  vcr create api --template go          # Create new Go project
  vcr create service --template rust    # Create new Rust project
  vcr build                          # Build with default tag (vcr-build-<path-hash>:latest)
  vcr build -t web3link/myapp:1.2.3                    # Fast dev loop (native)
  vcr build -t web3link/myapp:1.2.3 --profile test     # RISC-V with dev tools
  vcr build -t web3link/myapp:1.2.3 --profile prod     # Production RISC-V
  vcr build -t web3link/myapp:1.2.3 --force-rebuild    # Force rebuild all artifacts
  vcr up                            # Build and run with default tag
  vcr up -t web3link/myapp:1.2.3                      # Build and run dev environment
  vcr up -t web3link/myapp:1.2.3 --profile test       # Build and run with RISC-V
  vcr up -t web3link/myapp:1.2.3 --force-rebuild      # Force rebuild before running
  vcr up --restart                                   # Force restart containers
  vcr down                                             # Stop development environment
  vcr logs                                             # View container logs
  vcr logs -f                                          # Follow container logs in real-time
  vcr logs --system                                    # View system logs (Docker container logs)
  vcr logs --system -f                                 # Follow system logs in real-time
  vcr exec ls -la                                      # Execute command in container
  vcr exec cat /app/config.json                        # View file in container
  vcr exec --system ps aux                             # Execute command in system (VM/container)
  vcr shell                                            # Open shell in container
  vcr shell --system                                   # Open shell in system (VM/container)
  vcr cat /app/config.json                             # View file in container
  vcr cat /app/logs/app.log                            # View log file
  vcr prune                                            # Clean up entire VCR environment
  vcr prune --local                                    # Clean up only current project

Notes:
  - Docker Compose files are stored in ~/.cache/vcr/<path-hash>/ for each project directory
  - Use 'vcr down' to stop the environment (no need to specify compose file path)
  - Use 'vcr logs' to view container logs (no need to specify compose file path)
  - Use 'vcr logs --system' to view system logs (Docker container logs)
  - Use 'vcr exec' to run commands in the container
  - Use 'vcr exec --system' to run commands in the system (VM/container)
  - Use 'vcr shell' to get an interactive shell in the container
  - Use 'vcr shell --system' to get an interactive shell in the system (VM/container)
  - Use 'vcr cat' to quickly view file contents in the application container
  - Container paths should start with /app/ to avoid ambiguity
  - Default image tags are based on the current directory path hash
  - vcr up automatically detects image changes and restarts containers when needed
  - Logs behavior varies by profile:
    * dev: vcr logs shows container logs, vcr logs --system shows all compose logs
    * test/prod: vcr logs shows /var/log/app.log via SSH, vcr logs --system shows container logs
  - Shell behavior varies by profile:
    * dev: vcr shell opens container shell, vcr shell --system opens container shell
    * test/prod: vcr shell opens container via containerd, vcr shell --system opens VM shell
  - Exec behavior varies by profile:
    * dev: vcr exec runs in container, vcr exec --system runs in container
    * test/prod: vcr exec runs in container via containerd, vcr exec --system runs in VM
  - Cat behavior varies by profile:
    * dev: vcr cat uses Docker exec to view files in container
    * test/prod: vcr cat uses SSH + containerd to view files in container

Prerequisites:
  - Docker and buildx installed
  - vcr-builder and vcr-registry will be created/started automatically if needed
`);
}

export function checkRiscv64Support() {
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



function buildLinuxKitImage(yamlPath: string, profile: string, imageDigest?: string, cacheDir?: string, forceRebuild = false) {
  console.log('Building LinuxKit image...');
  
  if (imageDigest) {
    console.log(`Using image digest: ${imageDigest}`);
  }
  
  const currentDir = cwd();
  const imageName = process.env.LINUXKIT_IMAGE || 'ghcr.io/zippiehq/vcr-linuxkit-builder:latest';
  
  // Get current user UID/GID for Docker commands
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  
  console.log(`Using LinuxKit image: ${imageName}`);
  console.log(`Working directory: ${currentDir}`);
  console.log(`Cache directory: ${cacheDir}`);
  
  try {
    // Check if we need to rebuild LinuxKit image
    const vcTarPath = cacheDir ? join(cacheDir, 'vc.tar') : join(currentDir, 'vc.tar');
    const vcSquashfsPath = cacheDir ? join(cacheDir, 'vc.squashfs') : join(currentDir, 'vc.squashfs');
    
    if (!forceRebuild && existsSync(vcSquashfsPath)) {
      console.log('✅ vc.squashfs already exists, skipping LinuxKit build and squashfs creation');
    } else {
      if (forceRebuild && existsSync(vcTarPath)) {
        console.log('🔄 Force rebuild: removing existing vc.tar');
        unlinkSync(vcTarPath);
      }
      
      // Ensure .moby directory exists in cache
      if (cacheDir) {
        const mobyDir = join(cacheDir, '.moby');
        if (!existsSync(mobyDir)) {
          mkdirSync(mobyDir, { recursive: true });
        }
      }
      
      // Ensure LinuxKit cache directory exists
      const linuxkitCacheDir = join(homedir(), '.cache', 'vcr', 'linuxkit-cache');
      if (!existsSync(linuxkitCacheDir)) {
        mkdirSync(linuxkitCacheDir, { recursive: true });
      }
      
    const command = [
      'docker', 'run', '--rm',
      '--user', `${uid}:${gid}`,
      '--network', 'host',
      '-e', 'HOME=/cache',
      '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-v', `${linuxkitCacheDir}:/home/user/.linuxkit/cache`,
        ...(cacheDir ? ['-v', `${cacheDir}/.moby:/.moby`] : []),
      '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-w', '/cache',
      imageName,
        'build', '--format', 'tar', '--arch', 'riscv64', '--decompress-kernel', '--no-sbom', 'vc.yml'
      ];
    
    
      console.log(`Executing: ${command.join(' ')}`);
      execSync(command.join(' '), { stdio: 'inherit', cwd: currentDir });
    
    console.log('✅ LinuxKit image built successfully');
      
      // Print SHA256 of vc.tar before it gets consumed
      try {
        if (existsSync(vcTarPath)) {
          const vcTarHash = execSync(`sha256sum "${vcTarPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc.tar SHA256: ${vcTarHash}`);
        } else {
          console.log('⚠️  vc.tar not found after LinuxKit build');
        }
      } catch (err) {
        console.log('⚠️  Could not calculate vc.tar SHA256:', err);
      }
      
      // Start snapshot builder to create squashfs
      console.log('Creating squashfs from vc.tar...');
      const snapshotCommand = [
        'docker', 'run', '--rm',
        '--user', `${uid}:${gid}`,
        '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-w', '/cache',
        'ghcr.io/zippiehq/vcr-snapshot-builder',
        'bash', '-c',
        'rm -f /cache/vc.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs - /cache/vc.squashfs -tar -noI -noId -noD -noF -noX -reproducible < /cache/vc.tar && cp /usr/share/qemu/images/linux-riscv64-Image /cache/vc.qemu-kernel && rm /cache/vc.tar'
      ];
      
      console.log(`Executing: ${snapshotCommand.join(' ')}`);
      const result = spawnSync(snapshotCommand[0], snapshotCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
      
      if (result.status !== 0) {
        console.error('Command failed with output:');
        if (result.stdout) console.error('stdout:', result.stdout.toString());
        if (result.stderr) console.error('stderr:', result.stderr.toString());
        throw new Error(`Command failed with status ${result.status}`);
      }
      
      console.log('✅ Squashfs created successfully');
    }
    
    // Additional steps for prod profile
    if (profile === 'prod') {
      const cmSnapshotPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot') : join(currentDir, 'vc-cm-snapshot');
      const cmSquashfsPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs') : join(currentDir, 'vc-cm-snapshot.squashfs');
      const verityPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs.verity') : join(currentDir, 'vc-cm-snapshot.squashfs.verity');
      const rootHashPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs.root-hash') : join(currentDir, 'vc-cm-snapshot.squashfs.root-hash');
      
      // Check if we need to create Cartesi machine snapshot
      if (!forceRebuild && existsSync(cmSnapshotPath)) {
        console.log('✅ vc-cm-snapshot already exists, skipping Cartesi machine creation');
      } else {
        if (forceRebuild && existsSync(cmSnapshotPath)) {
          console.log('🔄 Force rebuild: removing existing vc-cm-snapshot');
          execSync(`rm -rf "${cmSnapshotPath}"`, { stdio: 'ignore' });
        }
        
        console.log('Creating Cartesi machine snapshot...');
        const cartesiCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          'rm -rf /cache/vc-cm-snapshot && cartesi-machine --flash-drive="label:root,filename:/cache/vc.squashfs" --append-bootargs="loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro" --max-mcycle=0 --store=/cache/vc-cm-snapshot'
        ];
        
        console.log(`Executing: ${cartesiCommand.join(' ')}`);
        const cartesiResult = spawnSync(cartesiCommand[0], cartesiCommand.slice(1), { stdio: 'inherit', cwd: currentDir });
        
        if (cartesiResult.status !== 0) {
          console.error('Cartesi machine command failed with status:', cartesiResult.status);
          throw new Error(`Cartesi machine command failed with status ${cartesiResult.status}`);
        }
        
        console.log('✅ Cartesi machine snapshot created successfully');
        
        // Print the hash from vc-cm-snapshot/hash
        try {
          const hashPath = join(cmSnapshotPath, 'hash');
          if (existsSync(hashPath)) {
            const hashBuffer = readFileSync(hashPath);
            const hash = hashBuffer.toString('hex');
            console.log(`🔐 Cartesi machine hash: ${hash}`);
          } else {
            console.error('❌ Error: Cartesi machine hash file not found at vc-cm-snapshot/hash');
            console.error('This indicates the Cartesi machine creation failed or the hash file was not generated.');
            console.error('Checking if snapshot directory exists and listing contents...');
            try {
              if (existsSync(cmSnapshotPath)) {
                const contents = execSync(`ls -la "${cmSnapshotPath}"`, { encoding: 'utf8' });
                console.error('Snapshot directory contents:');
                console.error(contents);
              } else {
                console.error('Snapshot directory does not exist');
              }
            } catch (listErr) {
              console.error('Could not list snapshot directory contents:', listErr);
            }
            process.exit(1);
          }
        } catch (hashErr) {
          console.error('❌ Error: Could not read Cartesi machine hash:', hashErr);
          process.exit(1);
        }
      }
      
      // Check if we need to compress Cartesi machine snapshot
      if (!forceRebuild && existsSync(cmSquashfsPath)) {
        console.log('✅ vc-cm-snapshot.squashfs already exists, skipping compression');
      } else {
        console.log('Creating compressed Cartesi machine snapshot...');
        const compressCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          'rm -f /cache/vc-cm-snapshot.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs /cache/vc-cm-snapshot /cache/vc-cm-snapshot.squashfs -comp zstd -reproducible'
        ];
        
        console.log(`Executing: ${compressCommand.join(' ')}`);
        const compressResult = spawnSync(compressCommand[0], compressCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (compressResult.status !== 0) {
          console.error('Compression command failed with output:');
          if (compressResult.stdout) console.error('stdout:', compressResult.stdout.toString());
          if (compressResult.stderr) console.error('stderr:', compressResult.stderr.toString());
          throw new Error(`Compression command failed with status ${compressResult.status}`);
        }
        
        console.log('✅ Compressed Cartesi machine snapshot created successfully');
      }
      
      // Check if we need to create verity hash tree
      if (!forceRebuild && existsSync(verityPath) && existsSync(rootHashPath)) {
        console.log('✅ Verity files already exist, skipping verity creation');
      } else {
        console.log('Creating verity hash tree...');
        
        // Read Cartesi machine hash for salt and UUID generation
        let cartesiMachineHash = '';
        try {
          const hashPath = join(cmSnapshotPath, 'hash');
          if (existsSync(hashPath)) {
            const hashBuffer = readFileSync(hashPath);
            cartesiMachineHash = hashBuffer.toString('hex');
            console.log(`Using Cartesi machine hash for verity: ${cartesiMachineHash}`);
          } else {
            console.error('Error: Cartesi machine hash file not found');
            process.exit(1);
          }
        } catch (err) {
          console.error('Error reading Cartesi machine hash:', err);
          process.exit(1);
        }
        
        // Use Cartesi machine hash for salt (first 32 chars)
        const salt = cartesiMachineHash.substring(0, 32);
        
        // Generate deterministic UUID from Cartesi machine hash (first 32 chars of hash)
        const uuidBase = cartesiMachineHash.substring(0, 32);
        const deterministicUuid = `${uuidBase.substring(0, 8)}-${uuidBase.substring(8, 12)}-${uuidBase.substring(12, 16)}-${uuidBase.substring(16, 20)}-${uuidBase.substring(20, 32)}`;
        
        const verityCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          `veritysetup --root-hash-file /cache/vc-cm-snapshot.squashfs.root-hash --salt=${salt} --uuid=${deterministicUuid} format /cache/vc-cm-snapshot.squashfs /cache/vc-cm-snapshot.squashfs.verity`
        ];
        
        console.log(`Executing: ${verityCommand.join(' ')}`);
        const verityResult = spawnSync(verityCommand[0], verityCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (verityResult.status !== 0) {
          console.error('Verity setup command failed with output:');
          if (verityResult.stdout) console.error('stdout:', verityResult.stdout.toString());
          if (verityResult.stderr) console.error('stderr:', verityResult.stderr.toString());
          throw new Error(`Verity setup command failed with status ${verityResult.status}`);
        }
        
        console.log('✅ Verity hash tree created successfully');
      }
      
      // Print all hashes and file contents (always run, even if cached)
      console.log('\n📊 Build Artifacts Summary:');
      
      // Print SHA256 of vc.squashfs
      try {
        const vcSquashfsPath = cacheDir ? join(cacheDir, 'vc.squashfs') : join(currentDir, 'vc.squashfs');
        if (existsSync(vcSquashfsPath)) {
          const vcSquashfsHash = execSync(`sha256sum "${vcSquashfsPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc.squashfs SHA256: ${vcSquashfsHash}`);
        } else {
          console.log('⚠️  vc.squashfs not found');
        }
      } catch (err) {
        console.log('⚠️  Could not calculate vc.squashfs SHA256:', err);
      }
      
      // Print SHA256 of vc-cm-snapshot.squashfs
      try {
        const cmSquashfsPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs') : join(currentDir, 'vc-cm-snapshot.squashfs');
        if (existsSync(cmSquashfsPath)) {
          const cmSquashfsHash = execSync(`sha256sum "${cmSquashfsPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc-cm-snapshot.squashfs SHA256: ${cmSquashfsHash}`);
        } else {
          console.log('⚠️  vc-cm-snapshot.squashfs not found');
        }
      } catch (err) {
        console.log('⚠️  Could not calculate vc-cm-snapshot.squashfs SHA256:', err);
      }
      
      // Print Cartesi machine hash
      try {
        const hashPath = join(cmSnapshotPath, 'hash');
        if (existsSync(hashPath)) {
          const hashBuffer = readFileSync(hashPath);
          const hash = hashBuffer.toString('hex');
          console.log(`🔐 Cartesi machine hash: ${hash}`);
        } else {
          console.log('⚠️  Cartesi machine hash file not found');
        }
      } catch (err) {
        console.log('⚠️  Could not read Cartesi machine hash:', err);
      }
      
      // Print root-hash content
      try {
        const rootHashPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs.root-hash') : join(currentDir, 'vc-cm-snapshot.squashfs.root-hash');
        if (existsSync(rootHashPath)) {
          const rootHash = execSync(`cat "${rootHashPath}"`, { encoding: 'utf8' }).trim();
          console.log(`🔑 Root hash: ${rootHash}`);
        } else {
          console.log('⚠️  Root hash file not found');
        }
      } catch (err) {
        console.log('⚠️  Could not read root hash:', err);
      }
      
      // Print SHA256 of verity file
      try {
        const verityPath = cacheDir ? join(cacheDir, 'vc-cm-snapshot.squashfs.verity') : join(currentDir, 'vc-cm-snapshot.squashfs.verity');
        if (existsSync(verityPath)) {
          const verityHash = execSync(`sha256sum "${verityPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`🔒 Verity file SHA256: ${verityHash}`);
        } else {
          console.log('⚠️  Verity file not found');
        }
      } catch (err) {
        console.log('⚠️  Could not calculate verity file SHA256:', err);
      }
    }
    
  } catch (err) {
    console.error('Error building LinuxKit image:', err);
    process.exit(1);
  }
}

function pruneVcrLocal() {
  console.log('🧹 Pruning local VCR environment...');
  
  try {
    // Stop development environment first
    console.log('Stopping development environment...');
    try {
      const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
      if (existsSync(composePath)) {
        execSync(`docker compose -f ${composePath} down`, { stdio: 'ignore' });
        console.log('✅ Development environment stopped');
      } else {
        console.log('ℹ️  No development environment to stop');
      }
    } catch (err) {
      console.log('ℹ️  Could not stop development environment');
    }
    
    // Wipe only the current project's cache directory
    console.log('Wiping local cache directory...');
    const localCacheDir = getComposeCacheDirectory();
    if (existsSync(localCacheDir)) {
      try {
        execSync(`rm -rf "${localCacheDir}"`, { stdio: 'ignore' });
        console.log('✅ Local cache directory wiped');
      } catch (err) {
        console.error('⚠️  Could not wipe local cache directory:', err);
      }
    } else {
      console.log('ℹ️  Local cache directory does not exist');
    }
    
    console.log('✅ Local VCR environment pruned successfully');
    
  } catch (err) {
    console.error('Error pruning local VCR environment:', err);
    process.exit(1);
  }
}

function pruneVcr() {
  console.log('🧹 Pruning VCR environment...');
  
  try {
    // Stop development environment first
    console.log('Stopping development environment...');
    try {
      const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
      if (existsSync(composePath)) {
        execSync(`docker compose -f ${composePath} down`, { stdio: 'ignore' });
        console.log('✅ Development environment stopped');
      } else {
        console.log('ℹ️  No development environment to stop');
      }
    } catch (err) {
      console.log('ℹ️  Could not stop development environment');
    }
    
    // Stop and remove vcr-registry
    console.log('Stopping vcr-registry...');
    try {
      execSync('docker stop vcr-registry', { stdio: 'ignore' });
      execSync('docker rm vcr-registry', { stdio: 'ignore' });
      console.log('✅ vcr-registry stopped and removed');
    } catch (err) {
      console.log('ℹ️  vcr-registry not running or already removed');
    }
    
    // Remove vcr-builder
    console.log('Removing vcr-builder...');
    try {
      execSync('docker buildx rm vcr-builder', { stdio: 'ignore' });
      console.log('✅ vcr-builder removed');
    } catch (err) {
      console.log('ℹ️  vcr-builder not found or already removed');
    }
    
    // Remove vcr-network
    console.log('Removing vcr-network...');
    try {
      execSync('docker network rm vcr-network', { stdio: 'ignore' });
      console.log('✅ vcr-network removed');
    } catch (err) {
      console.log('ℹ️  vcr-network not found or already removed');
    }
    
    // Wipe cache directory
    console.log('Wiping cache directory...');
    const cacheDir = join(homedir(), '.cache', 'vcr');
    if (existsSync(cacheDir)) {
      try {
        execSync(`rm -rf "${cacheDir}"`, { stdio: 'ignore' });
        console.log('✅ Cache directory wiped');
      } catch (err) {
        console.error('⚠️  Could not wipe cache directory:', err);
      }
    } else {
      console.log('ℹ️  Cache directory does not exist');
    }
    
    console.log('✅ VCR environment pruned successfully');
    
  } catch (err) {
    console.error('Error pruning VCR environment:', err);
    process.exit(1);
  }
}

function createProject(targetDir: string, template: string) {
  console.log(`Creating new VCR project: ${targetDir}`);
  console.log(`Using template: ${template}`);
  
  // Check if target directory already exists
  if (existsSync(targetDir)) {
    console.error(`Error: Directory '${targetDir}' already exists`);
    console.log('Please choose a different directory name or remove the existing directory');
    process.exit(1);
  }
  
  // Create target directory
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    console.error(`Error creating directory '${targetDir}':`, err);
    process.exit(1);
  }
  
  // Clone the template repository
  const templateUrl = `https://github.com/zippiehq/vcr`;
  const tempDir = join(targetDir, '.temp-clone');
  
  try {
    console.log(`Cloning VCR repository to get template...`);
    execSync(`git clone ${templateUrl} ${tempDir}`, { stdio: 'inherit' });
    
    // Check if the template directory exists
    const templateDir = join(tempDir, 'packages', `sample-${template}`);
    if (!existsSync(templateDir)) {
      console.error(`Error: Template '${template}' not found`);
      console.log('Available templates:');
      try {
        const packagesDir = join(tempDir, 'packages');
        if (existsSync(packagesDir)) {
          const packages = execSync(`ls -d ${packagesDir}/sample-* 2>/dev/null | sed 's|.*/sample-||'`, { encoding: 'utf8' }).trim().split('\n');
          packages.forEach(pkg => {
            if (pkg) console.log(`  - ${pkg}`);
          });
        }
      } catch (listErr) {
        console.log('  (Could not list available templates)');
      }
      process.exit(1);
    }
    
    // Remove .git directory from the cloned repo
    const gitDir = join(tempDir, '.git');
    if (existsSync(gitDir)) {
      execSync(`rm -rf "${gitDir}"`, { stdio: 'ignore' });
    }
    
    // Move all files from template directory to target directory
    const files = execSync(`ls -A "${templateDir}"`, { encoding: 'utf8' }).trim().split('\n');
    for (const file of files) {
      if (file) {
        const sourcePath = join(templateDir, file);
        const targetPath = join(targetDir, file);
        execSync(`mv "${sourcePath}" "${targetPath}"`, { stdio: 'ignore' });
      }
    }
    
    // Remove temp directory
    execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
    
    console.log('✅ Project created successfully!');
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${targetDir}`);
    console.log('  vcr up');
    console.log('');
    console.log('Available commands:');
    console.log('  vcr build    # Build the container');
    console.log('  vcr up       # Build and run the development environment');
    console.log('  vcr down     # Stop the development environment');
    console.log('  vcr logs     # View container logs');
    console.log('  vcr shell    # Open shell in the container');
    
  } catch (err) {
    console.error('Error creating project:', err);
    
    // Cleanup on error
    try {
      if (existsSync(tempDir)) {
        execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
      }
      if (existsSync(targetDir)) {
        execSync(`rm -rf "${targetDir}"`, { stdio: 'ignore' });
      }
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr);
    }
    
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
      handleBuildCommand(args);
      break;
      
    case 'up':
      handleUpCommand(args);
      break;
      
    case 'down':
      console.log('Stopping development environment...');
      try {
        const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
        if (existsSync(composePath)) {
          execSync(`docker compose -f ${composePath} down`, { stdio: 'inherit' });
          console.log('✅ Development environment stopped');
        } else {
          console.log('ℹ️  No docker-compose.dev.json found for current directory');
        }
      } catch (err) {
        console.error('Error stopping development environment:', err);
        process.exit(1);
      }
      break;
      
    case 'logs':
      handleLogsCommand(args);
      break;
      
    case 'exec':
      handleExecCommand(args);
      break;
      
    case 'shell':
      handleShellCommand(args);
      break;
      

      
    case 'cat':
      handleCatCommand(args);
      break;
      
    case 'prune':
      let pruneLocal = false;
      
      // Parse prune arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--local') {
          pruneLocal = true;
        }
      }
      
      if (pruneLocal) {
        pruneVcrLocal();
      } else {
        pruneVcr();
      }
      break;
      
    case 'create':
      let projectName: string | undefined;
      let template: string | undefined;
      
      // Parse create arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        if (arg === '--template') {
          if (nextArg) {
            template = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --template requires a value');
            process.exit(1);
          }
        } else if (!projectName) {
          // First non-flag argument is the project name
          projectName = arg;
        }
      }
      
      if (!projectName) {
        console.error('Error: vcr create requires a project name');
        console.log('Usage: vcr create <project-name> --template <lang>');
        console.log('Examples:');
        console.log('  vcr create myapp --template python');
        console.log('  vcr create webapp --template node');
        process.exit(1);
      }
      
      if (!template) {
        console.error('Error: vcr create requires a template');
        console.log('Usage: vcr create <project-name> --template <lang>');
        console.log('Available templates: python, node, go, rust');
        process.exit(1);
      }
      
      createProject(projectName, template);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} 

main(); 