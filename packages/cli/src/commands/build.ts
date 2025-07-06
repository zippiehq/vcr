import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { cwd } from 'process';
import { homedir } from 'os';
import { createHash } from 'crypto';

// Import functions from the main CLI file
import { 
  getPathHash, 
  getComposeCacheDirectory 
} from '../cli';

// Import check functions
import { 
  checkBuildxAvailable, 
  checkVcrBuilder, 
  checkLocalRegistry, 
  checkRiscv64Support 
} from '../checks';

// Import checkVsockSupport function
import { checkVsockSupport } from '../checks';
import { generateLinuxKitYaml, generateDockerCompose } from '../generate';

export function handleBuildCommand(args: string[]): void {
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
}

export function handleUpCommand(args: string[]): void {
  checkBuildxAvailable();
  checkVcrBuilder();
  checkLocalRegistry();
  
  let runImageTag: string | undefined;
  let runProfile = 'dev';
  let runCacheDir: string | undefined;
  let runForceRebuild = false;
  let runForceRestart = false;
  
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
    } else if (arg === '--restart') {
      runForceRestart = true;
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
  
  runDevEnvironment(runImageTag, runProfile, runCacheDir, runForceRebuild, runForceRestart);
}

// Helper functions that need to be copied from cli.ts
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

function getNativePlatform(): string {
  const platform = process.platform;
  const arch = process.arch;
  
  switch (platform) {
    case 'darwin':
      return arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';
    case 'linux':
      return arch === 'arm64' ? 'linux/arm64' : 'linux/amd64';
    case 'win32':
      return 'linux/amd64';
    default:
      return 'linux/amd64';
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
        const { unlinkSync } = require('fs');
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
      const { spawnSync } = require('child_process');
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
      console.log('🔄 Prod profile: Creating Cartesi machine...');
      const cartesiCommand = [
        'docker', 'run', '--rm',
        '--user', `${uid}:${gid}`,
        '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-w', '/cache',
        'ghcr.io/zippiehq/vcr-snapshot-builder',
        'cartesi-machine',
        '--flash-drive=label:root,filename:/cache/vc.squashfs',
        '--append-bootargs=loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro',
        '--skip-root-hash-check',
        '--dump-machine-config',
        '--output-path=/cache/vc.cartesi'
      ];
      
      console.log(`Executing: ${cartesiCommand.join(' ')}`);
      execSync(cartesiCommand.join(' '), { stdio: 'inherit', cwd: currentDir });
      console.log('✅ Cartesi machine created successfully');
    }
    
  } catch (err) {
    console.error('Error building LinuxKit image:', err);
    process.exit(1);
  }
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