#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';

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

function buildImage(imageTag: string, profile: string, cacheDir?: string, forceRebuild = false): string | undefined {
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
    console.log(`Image pushed to: localhost:5001/${imageTag}`);
    
    // Capture the image digest after successful build
    let imageDigest: string | undefined;
    try {
      const localImageName = `localhost:5001/${imageTag}`;
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
      const yamlPath = generateLinuxKitYaml(imageTag, cacheDir, imageDigest);
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

function getPathHash(): string {
  const currentPath = cwd();
  return createHash('sha256').update(currentPath).digest('hex').substring(0, 8);
}

function getComposeCacheDirectory(): string {
  const pathHash = getPathHash();
  const composeCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  // Create compose cache directory if it doesn't exist
  if (!existsSync(composeCacheDir)) {
    mkdirSync(composeCacheDir, { recursive: true });
  }
  
  return composeCacheDir;
}

function generateDockerCompose(imageTag: string, imageDigest?: string) {
  // Use tag + SHA256 format if digest is available, otherwise just the tag
  const imageReference = imageDigest ? `localhost:5001/${imageTag}@${imageDigest}` : `localhost:5001/${imageTag}`;
  
  const composeConfig = {
    version: '3.8',
    services: {
      traefik: {
        image: 'traefik:v2.10',
        container_name: 'vcr-traefik',
        command: [
          '--api.insecure=true',
          '--api.dashboard=false',
          '--api.debug=true',
          '--providers.docker=true',
          '--providers.docker.exposedbydefault=false',
          '--entrypoints.web.address=:8080',
          '--entrypoints.traefik.address=:9000'
        ],
        ports: ['8080:8080'],
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        networks: ['internal_net', 'external_net'],
        labels: [
          'traefik.enable=true',
          'traefik.http.routers.traefik.rule=PathPrefix(`/api`) || PathPrefix(`/dashboard`)',
          'traefik.http.routers.traefik.service=api@internal',
          'traefik.http.routers.traefik.entrypoints=traefik'
        ]
      },
      isolated_service: {
        image: imageReference,
        container_name: 'vcr-isolated-service',
        networks: ['internal_net'],
        volumes: ['vcr_shared_data:/media/vcr'],
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
          'traefik.http.services.isolated.loadbalancer.server.scheme=http',
          'traefik.http.middlewares.strip-function.stripprefix.prefixes=/function',
          'traefik.http.routers.isolated.middlewares=strip-function'
        ]
      },
      internet_service: {
        image: 'alpine',
        container_name: 'vcr-guest-agent',
        command: 'sh -c "mkdir -p /media/vcr/transient && sleep infinity"',
        networks: ['internal_net', 'external_net'],
        volumes: ['vcr_shared_data:/media/vcr']
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
    },
    volumes: {
      vcr_shared_data: {
        driver: 'local'
      }
    }
  };
  
  const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
  writeFileSync(composePath, JSON.stringify(composeConfig, null, 2));
  return composePath;
}

function runDevEnvironment(imageTag: string, profile: string, cacheDir?: string, forceRebuild = false) {
  console.log('Starting development environment...');
  
  try {
    // Clean up any existing VCR containers to prevent port conflicts
    console.log('Cleaning up any existing VCR containers...');
    try {
      execSync('docker stop vcr-traefik vcr-isolated-service vcr-guest-agent', { stdio: 'ignore' });
      execSync('docker rm vcr-traefik vcr-isolated-service vcr-guest-agent', { stdio: 'ignore' });
      console.log('✅ Existing VCR containers cleaned up');
    } catch (err) {
      console.log('ℹ️  No existing VCR containers to clean up');
    }
    
    // Build the container
    const imageDigest = buildImage(imageTag, profile, cacheDir, forceRebuild);
    
    // Generate Docker Compose configuration
    const composePath = generateDockerCompose(imageTag, imageDigest);
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
    console.log('- Function endpoint: http://localhost:8080/function');
    console.log('- Health check: http://localhost:8080/function/health');
    console.log('- To stop: vcr down');
    console.log('- To view logs: vcr logs');
    console.log('- To follow logs: vcr logs -f');
    
  } catch (err) {
    console.error('Error starting development environment:', err);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
vcr CLI - Verifiable Container Runner

Usage:
  vcr build [-t <name:tag>] [options]  Build and push container images
  vcr up [-t <name:tag>] [options]    Build and run development environment with isolated networking
  vcr down                           Stop development environment
  vcr logs [-f|--follow]             View development environment logs
  vcr prune                          Clean up VCR environment (cache, registry, builder)
  vcr --help                         Show this help message

Build Options:
  -t, --tag <name:tag>              Image name:tag (optional, defaults to vcr-build-<path-hash>:latest)
  --profile <dev|test|prod|prod-debug>  Build profile (default: dev)
  --cache-dir <dir>                 Optional path to store exported build metadata
  --force-rebuild                   Force rebuild of cached artifacts (LinuxKit, Cartesi machine, etc.)

Build Profiles:
  dev        Native platform only, no dev tools, no attestation
  test       RISC-V 64-bit, with dev tools, no attestation
  prod       RISC-V 64-bit, no dev tools, with attestation
  prod-debug RISC-V 64-bit, with dev tools, with attestation

Examples:
  vcr build                          # Build with default tag (vcr-build-<path-hash>:latest)
  vcr build -t web3link/myapp:1.2.3                    # Fast dev loop (native)
  vcr build -t web3link/myapp:1.2.3 --profile test     # RISC-V with dev tools
  vcr build -t web3link/myapp:1.2.3 --profile prod     # Production RISC-V
  vcr build -t web3link/myapp:1.2.3 --force-rebuild    # Force rebuild all artifacts
  vcr up                            # Build and run with default tag
  vcr up -t web3link/myapp:1.2.3                      # Build and run dev environment
  vcr up -t web3link/myapp:1.2.3 --profile test       # Build and run with RISC-V
  vcr up -t web3link/myapp:1.2.3 --force-rebuild      # Force rebuild before running
  vcr down                                             # Stop development environment
  vcr logs                                             # View logs
  vcr logs -f                                          # Follow logs in real-time
  vcr prune                                            # Clean up VCR environment

Notes:
  - Docker Compose files are stored in ~/.cache/vcr/<path-hash>/ for each project directory
  - Use 'vcr down' to stop the environment (no need to specify compose file path)
  - Use 'vcr logs' to view logs (no need to specify compose file path)
  - Default image tags are based on the current directory path hash

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

function generateLinuxKitYaml(imageTag: string, cacheDir?: string, imageDigest?: string) {
  const imageReference = imageDigest ? `${imageTag}@${imageDigest}` : imageTag;
  const yamlConfig = `init:
  - ghcr.io/zippiehq/vcr-init@sha256:fd6878920ee9dd846689fc79839a82dc40f3cf568f16621f0e97a8b7b501df62
  - ghcr.io/zippiehq/vcr-runc@sha256:3f0a1027ab7507f657cafd28abff329366c0e774714eac48c4d4c10f46778596
  - ghcr.io/zippiehq/vcr-containerd@sha256:97a307ea9e3eaa21d378f903f067d742bd66abd49e5ff483ae85528bed6d4e8a
onboot:
  - name: dhcpcd
    image: ghcr.io/zippiehq/vcr-dhcpcd@sha256:3ad775c7f5402fc960d3812bec6650ffa48747fbd9bd73b62ff71b8d0bb72c5a
    command: ["/sbin/dhcpcd", "--nobackground", "-f", "/dhcpcd.conf", "-1"]
services:
  - name: getty
    image: ghcr.io/zippiehq/vcr-getty@sha256:f1e8a4fbdbc7bf52eaad06bd59aa1268c91eb11bd615d3c27e93d8a35c0d8b7a
    env:
     - INSECURE=true
  - name: app
    image: localhost:5001/${imageReference}
`;
  
  const yamlPath = cacheDir ? join(cacheDir, 'vc.yml') : join(cwd(), 'vc.yml');
  writeFileSync(yamlPath, yamlConfig);
  console.log(`Generated LinuxKit YAML: ${yamlPath}`);
  return yamlPath;
}

function buildLinuxKitImage(yamlPath: string, profile: string, imageDigest?: string, cacheDir?: string, forceRebuild = false) {
  console.log('Building LinuxKit image...');
  
  if (imageDigest) {
    console.log(`Using image digest: ${imageDigest}`);
  }
  
  const currentDir = cwd();
  const imageName = process.env.LINUXKIT_IMAGE || 'ghcr.io/zippiehq/vcr-linuxkit-builder:latest';
  
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
      
    const command = [
      'docker', 'run', '--rm',
      '--network', 'host',
      '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-v', `${join(homedir(), '.cache', 'vcr', 'linuxkit-cache')}:/root/.linuxkit/cache`,
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
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          'rm -rf /cache/vc-cm-snapshot && cartesi-machine --flash-drive="label:root,filename:/cache/vc.squashfs" --append-bootargs="loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro" --max-mcycle=0 --store=/cache/vc-cm-snapshot'
        ];
        
        console.log(`Executing: ${cartesiCommand.join(' ')}`);
        const cartesiResult = spawnSync(cartesiCommand[0], cartesiCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (cartesiResult.status !== 0) {
          console.error('Cartesi machine command failed with output:');
          if (cartesiResult.stdout) console.error('stdout:', cartesiResult.stdout.toString());
          if (cartesiResult.stderr) console.error('stderr:', cartesiResult.stderr.toString());
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
            console.log('⚠️  Hash file not found at vc-cm-snapshot/hash');
          }
        } catch (hashErr) {
          console.log('⚠️  Could not read Cartesi machine hash:', hashErr);
        }
      }
      
      // Check if we need to compress Cartesi machine snapshot
      if (!forceRebuild && existsSync(cmSquashfsPath)) {
        console.log('✅ vc-cm-snapshot.squashfs already exists, skipping compression');
      } else {
        console.log('Creating compressed Cartesi machine snapshot...');
        const compressCommand = [
          'docker', 'run', '--rm',
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
      let forceRebuild = false;
      
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
        } else if (arg === '--force-rebuild') {
          forceRebuild = true;
        }
      }
      
      if (!imageTag) {
        const pathHash = getPathHash();
        imageTag = `vcr-build-${pathHash}:latest`;
        console.log(`No tag provided, using default: ${imageTag}`);
      }
      
      // Check RISC-V support if needed
      if (profile !== 'dev') {
        checkRiscv64Support();
      }
      
      buildImage(imageTag, profile, cacheDir, forceRebuild);
      break;
      
    case 'up':
      checkBuildxAvailable();
      checkVcrBuilder();
      checkLocalRegistry();
      
      let runImageTag: string | undefined;
      let runProfile = 'dev';
      let runCacheDir: string | undefined;
      let runForceRebuild = false;
      
      // Parse run arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        if (arg === '-t' || arg === '--tag') {
          if (nextArg) {
            runImageTag = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: -t/--tag requires a value');
            process.exit(1);
          }
        } else if (arg === '--profile') {
          if (nextArg) {
            runProfile = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --profile requires a value');
            process.exit(1);
          }
        } else if (arg === '--cache-dir') {
          if (nextArg) {
            runCacheDir = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --cache-dir requires a value');
            process.exit(1);
          }
        } else if (arg === '--force-rebuild') {
          runForceRebuild = true;
        }
      }
      
      if (!runImageTag) {
        const pathHash = getPathHash();
        runImageTag = `vcr-build-${pathHash}:latest`;
        console.log(`No tag provided, using default: ${runImageTag}`);
      }
      
      // Check RISC-V support if needed
      if (runProfile !== 'dev') {
        checkRiscv64Support();
      }
      
      runDevEnvironment(runImageTag, runProfile, runCacheDir, runForceRebuild);
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
      try {
        const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
        if (existsSync(composePath)) {
          // Check if -f flag is provided for follow mode
          const followMode = args.includes('-f') || args.includes('--follow');
          const followFlag = followMode ? ' -f' : '';
          execSync(`docker compose -f ${composePath} logs${followFlag}`, { stdio: 'inherit' });
        } else {
          console.log('ℹ️  No docker-compose.dev.json found for current directory');
          console.log('Run "vcr up" first to start the development environment');
        }
      } catch (err) {
        console.error('Error viewing logs:', err);
        process.exit(1);
      }
      break;
      
    case 'prune':
      pruneVcr();
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} 

main(); 