import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync, watch } from 'fs';
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
  checkRiscv64Support,
  requireOciExportSupport
} from '../checks';

// Import checkVsockSupport function
import { checkVsockSupport } from '../checks';
import { generateLinuxKitYaml, generateDockerCompose } from '../generate';

// Import tar context builder
import { TarContextBuilder } from '../tar-context';

// Import help function
import { showCommandHelp } from './help';
import { VCR_SNAPSHOT_BUILDER_IMAGE } from '../constants';

// Function to detect current profile from running containers
function detectCurrentProfile(): string | null {
  const pathHash = getPathHash();
  const containerName = `${pathHash}-vcr-isolated-service`;
  
  try {
    // Check if container exists and is running
    const containerStatus = execSync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`, { encoding: 'utf8' }).trim();
    if (!containerStatus) {
      return null; // No container running
    }
    
    // Get the profile label from the container
    const profileLabel = execSync(`docker inspect ${containerName} --format '{{ index .Config.Labels "vcr.profile" }}'`, { encoding: 'utf8' }).trim();
    return profileLabel || null;
  } catch (err) {
    return null; // Could not detect profile
  }
}

// Function to check if profile change is needed
function needsProfileChange(currentProfile: string | null, requestedProfile: string): boolean {
  if (!currentProfile) {
    return true; // No current profile, need to start
  }
  return currentProfile !== requestedProfile;
}

// Check if Docker image has hot reload support
function hasHotReloadSupport(imageTag: string): boolean {
  try {
    const label = execSync(`docker inspect ${imageTag} --format '{{index .Config.Labels "vcr.hot-reload"}}'`, { 
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
    }).trim();
    return label === 'true';
  } catch (err) {
    // If we can't inspect the image or label doesn't exist, assume no hot reload
    return false;
  }
}

export function handleBuildCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('build');
    return;
  }
  
  checkBuildxAvailable();
  checkVcrBuilder();
  // Removed: checkLocalRegistry();
  
  let imageTag: string | undefined;
  let profile = 'dev';
  let cacheDir: string | undefined;
  let forceRebuild = false;
  let useDepot = false;
  let noDepot = false;
  let forceDockerTar = false; // Force using Docker for tar creation
  let useTarContext: boolean | undefined = undefined; // Will set default after parsing profile
  let turbo = false; // Enable multi-core QEMU for stage profiles
  let guestAgentImage: string | undefined; // Guest agent image for prod/prod-debug profiles
  let hot = false; // Enable hot reloading for dev profile
  let useExistingImage: string | undefined; // Use existing Docker image instead of building

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
    } else if (arg === '--depot') {
      useDepot = true;
    } else if (arg === '--no-depot') {
      noDepot = true;
    } else if (arg === '--no-tar-context') {
      useTarContext = false;
    } else if (arg === '--force-docker-tar') {
      forceDockerTar = true;
    } else if (arg === '--turbo') {
      turbo = true;
    } else if (arg === '--guest-agent-image') {
      if (nextArg) {
        guestAgentImage = nextArg;
        i++; // Skip next argument
      } else {
        console.error('Error: --guest-agent-image requires a value');
        process.exit(1);
      }
    } else if (arg === '--hot') {
      hot = true;
    } else if (arg === '--image') {
      if (nextArg) {
        useExistingImage = nextArg;
        i++; // Skip next argument
      } else {
        console.error('Error: --image requires a value');
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is the profile
      profile = arg;
    }
  }

  // Set useTarContext default based on profile if not overridden
  if (useTarContext === undefined) {
    if (["stage", "stage-release", "prod", "prod-debug"].includes(profile)) {
      useTarContext = true;
    } else {
      useTarContext = false;
    }
  }

  // Validate --image and --hot are not used together
  if (useExistingImage && hot) {
    console.error('Error: --image and --hot are incompatible options');
    process.exit(1);
  }

  // If using existing image, set imageTag to the provided image
  if (useExistingImage) {
    imageTag = useExistingImage;
    console.log(`Using existing image: ${imageTag}`);
  }

  // Auto-detect depot.json if neither --depot nor --no-depot was specified
  if (!useDepot && !noDepot) {
    const depotJsonPath = join(cwd(), 'depot.json');
    if (existsSync(depotJsonPath)) {
      useDepot = true;
      console.log('📦 depot.json detected, using depot build');
    }
  }

  if (!imageTag) {
    const pathHash = getPathHash();
    const baseTag = `vcr-build-${pathHash}:latest`;
    // Add -hot suffix for hot reload builds
    imageTag = (profile === 'dev' && hot) ? baseTag.replace(':latest', '-hot:latest') : baseTag;
    console.log(`No tag provided, using default: ${imageTag}`);
  }

  // Check RISC-V support if needed
  if (profile !== 'dev') {
    checkRiscv64Support();
  }

  // Check OCI export support for non-dev profiles
  if (profile !== 'dev') {
    requireOciExportSupport();
  }

  buildImage(imageTag, profile, cacheDir, forceRebuild, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, hot, useExistingImage);
}

export function handleUpCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('up');
    return;
  }
  
  checkBuildxAvailable();
  checkVcrBuilder();
  // Removed: checkLocalRegistry();
  
  let imageTag: string | undefined;
  let profile = 'dev';
  let cacheDir: string | undefined;
  let forceRebuild = false;
  let forceRestart = false;
  let useDepot = false;
  let noDepot = false;
  let forceDockerTar = false; // Force using Docker for tar creation
  let useTarContext: boolean | undefined = undefined; // Will set default after parsing profile
  let turbo = false; // Enable multi-core QEMU for stage profiles
  let guestAgentImage: string | undefined; // Guest agent image for prod/prod-debug profiles
  let hot = false; // Enable hot reloading for dev profile
  let useExistingImage: string | undefined; // Use existing Docker image instead of building

  // Parse up arguments
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
    } else if (arg === '--restart') {
      forceRestart = true;
    } else if (arg === '--depot') {
      useDepot = true;
    } else if (arg === '--no-depot') {
      noDepot = true;
    } else if (arg === '--no-tar-context') {
      useTarContext = false;
    } else if (arg === '--force-docker-tar') {
      forceDockerTar = true;
    } else if (arg === '--turbo') {
      turbo = true;
    } else if (arg === '--guest-agent-image') {
      if (nextArg) {
        guestAgentImage = nextArg;
        i++; // Skip next argument
      } else {
        console.error('Error: --guest-agent-image requires a value');
        process.exit(1);
      }
    } else if (arg === '--hot') {
      hot = true;
    } else if (arg === '--image') {
      if (nextArg) {
        useExistingImage = nextArg;
        i++; // Skip next argument
      } else {
        console.error('Error: --image requires a value');
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is the profile
      profile = arg;
    }
  }

  // Validate --image and --hot are not used together
  if (useExistingImage && hot) {
    console.error('Error: --image and --hot are incompatible options');
    process.exit(1);
  }

  // If using existing image, set imageTag to the provided image
  if (useExistingImage) {
    imageTag = useExistingImage;
    console.log(`Using existing image: ${imageTag}`);
  }

  // Set useTarContext default based on profile if not overridden
  if (useTarContext === undefined) {
    if (["stage", "stage-release", "prod", "prod-debug"].includes(profile)) {
      useTarContext = true;
    } else {
      useTarContext = false;
    }
  }

  // Auto-detect depot.json if neither --depot nor --no-depot was specified
  if (!useDepot && !noDepot) {
    const depotJsonPath = join(cwd(), 'depot.json');
    if (existsSync(depotJsonPath)) {
      useDepot = true;
      console.log('📦 depot.json detected, using depot build');
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

  // Check OCI export support for non-dev profiles
  if (profile !== 'dev') {
    requireOciExportSupport();
  }

  runDevEnvironment(imageTag, profile, cacheDir, forceRebuild, forceRestart, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, hot, useExistingImage);
}

// Helper functions that need to be copied from cli.ts
function getCacheDirectory(imageTag?: string, profile?: string, guestAgentImage?: string): string {
  const pathHash = getPathHash();
  const baseCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  if (imageTag) {
    // Create a hash of the image tag for cache directory
    let hashInput = imageTag;
    
    // For prod/prod-debug profiles, include guest-agent image in the hash
    if (profile && (profile === 'prod' || profile === 'prod-debug') && guestAgentImage) {
      hashInput += `:${guestAgentImage}`;
    }
    
    const imageHash = createHash('sha256').update(hashInput).digest('hex').substring(0, 8);
    return join(baseCacheDir, imageHash);
  }
  
  return baseCacheDir;
}

function resolvePlatforms(profile: string): string[] {
  switch (profile) {
    case 'dev':
      return [getNativePlatform()];
    case 'stage':
    case 'stage-release':
    case 'prod':
    case 'prod-debug':
      return ['linux/riscv64'];
    default:
      console.error(`Error: Unknown profile '${profile}'. Valid profiles: dev, stage, stage-release, prod, prod-debug`);
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

function buildLinuxKitImage(yamlPath: string, profile: string, ociTarPath?: string, cacheDir?: string, forceRebuild = false) {
  console.log('Building LinuxKit image...');
  
  if (ociTarPath) {
    console.log(`Using OCI image: ${ociTarPath}`);
  }
  
  const currentDir = cwd();
  const imageName = process.env.LINUXKIT_IMAGE || VCR_SNAPSHOT_BUILDER_IMAGE;
  
  // Get current user UID/GID for Docker commands
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  
  // Check if Docker config exists for authentication
  const dockerConfigPath = join(homedir(), '.docker', 'config.json');
  let dockerConfigMount: string[] = [];
  
  if (existsSync(dockerConfigPath)) {
    try {
      const configContent = readFileSync(dockerConfigPath, 'utf8');
      const config = JSON.parse(configContent);
      
      // Skip mounting if using Docker Desktop credential store
      if (config.credsStore === 'desktop') {
        console.log(`Docker config found but using 'desktop' credential store - skipping config mount (credentials in macOS keychain)`);
      } else {
        dockerConfigMount = ['-v', `${dockerConfigPath}:/cache/.docker/config.json:ro`];
        console.log(`Docker config found: ${dockerConfigPath}`);
      }
    } catch (err) {
      console.log(`⚠️  Could not parse Docker config: ${err}`);
      // Fall back to mounting if we can't parse the config
      dockerConfigMount = ['-v', `${dockerConfigPath}:/cache/.docker/config.json:ro`];
      console.log(`Docker config found: ${dockerConfigPath}`);
    }
  } else {
    console.log(`No Docker config found at ${dockerConfigPath} - authentication may not work for private registries`);
  }
  
  console.log(`Using snapshot-builder image: ${imageName}`);
  console.log(`Working directory: ${currentDir}`);
  console.log(`Cache directory: ${cacheDir}`);
  if (existsSync(dockerConfigPath)) {
    console.log(`Docker config found: ${dockerConfigPath}`);
  } else {
    console.log(`No Docker config found at ${dockerConfigPath} - authentication may not work for private registries`);
  }
  
  // Determine if debug tools should be included for this profile
  const includeDebugTools = profile === 'dev' || profile === 'stage' || profile === 'prod-debug';
  const debugSuffix = includeDebugTools ? '-debug' : '-release';
  
  try {
    // Check if we need to rebuild LinuxKit image
    const vcTarPath = cacheDir ? join(cacheDir, `vc${debugSuffix}.tar`) : join(currentDir, `vc${debugSuffix}.tar`);
    const vcSquashfsPath = cacheDir ? join(cacheDir, `vc${debugSuffix}.squashfs`) : join(currentDir, `vc${debugSuffix}.squashfs`);
    
          if (!forceRebuild && existsSync(vcSquashfsPath)) {
        console.log(`✅ vc${debugSuffix}.squashfs already exists, skipping LinuxKit build and squashfs creation`);
      } else {
        if (forceRebuild && existsSync(vcTarPath)) {
          console.log(`🔄 Force rebuild: removing existing vc${debugSuffix}.tar`);
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
      
      // Import OCI image into LinuxKit cache if provided
      if (ociTarPath && existsSync(ociTarPath)) {
        console.log('Importing OCI image into LinuxKit cache...');
        
        // Convert host path to container path
        const ociTarFileName = ociTarPath.split('/').pop();
        const containerOciTarPath = `/cache/${ociTarFileName}`;
        
        const importCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-e', 'HOME=/cache',
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-v', `${linuxkitCacheDir}:/home/user/.linuxkit/cache`,
          ...dockerConfigMount,
          '-w', '/cache',
          imageName,
          '/usr/local/bin/linuxkit', 'cache', 'import', containerOciTarPath
        ];
        
        console.log(`Executing: ${importCommand.join(' ')}`);
        execSync(importCommand.join(' '), { stdio: 'inherit', cwd: currentDir });
        console.log('✅ OCI image imported into LinuxKit cache');
      } else if (!ociTarPath) {
        console.log('ℹ️  No OCI tar provided - using image reference directly in LinuxKit YAML');
      }
      
          const command = [
        'docker', 'run', '--rm',
        '--user', `${uid}:${gid}`,
        '--network', 'host',
        '-e', 'HOME=/cache',
        '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-v', `${linuxkitCacheDir}:/home/user/.linuxkit/cache`,
        ...dockerConfigMount,
        ...(cacheDir ? ['-v', `${cacheDir}/.moby:/.moby`] : []),
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        '-w', '/cache',
        imageName,
        '/usr/local/bin/linuxkit', 'build', '--format', 'tar', '--arch', 'riscv64', '--decompress-kernel', '--no-sbom', `vc${debugSuffix}.yml`
      ];
    
    
      console.log(`Executing: ${command.join(' ')}`);
      execSync(command.join(' '), { stdio: 'inherit', cwd: currentDir });
    
    console.log('✅ LinuxKit image built successfully');
      
      // Print SHA256 of vc.tar before it gets consumed
      try {
        if (existsSync(vcTarPath)) {
          const vcTarHash = execSync(`sha256sum "${vcTarPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc${debugSuffix}.tar SHA256: ${vcTarHash}`);
        } else {
          console.log(`⚠️  vc${debugSuffix}.tar not found after LinuxKit build`);
        }
      } catch (err) {
        console.log(`⚠️  Could not calculate vc${debugSuffix}.tar SHA256:`, err);
      }
      
      // Start snapshot builder to create squashfs
      console.log(`Creating squashfs from vc${debugSuffix}.tar...`);
      const snapshotCommand = [
        'docker', 'run', '--rm',
        '--user', `${uid}:${gid}`,
        '-v', `${currentDir}:/work`,
        '-v', `${cacheDir}:/cache`,
        '-w', '/cache',
        VCR_SNAPSHOT_BUILDER_IMAGE,
        'bash', '-c',
        `rm -f /cache/vc${debugSuffix}.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs - /cache/vc${debugSuffix}.squashfs -tar -noI -noId -noD -noF -noX -reproducible < /cache/vc${debugSuffix}.tar > /dev/null 2>&1 && cp /usr/share/qemu/images/linux-riscv64-Image /cache/vc${debugSuffix}.qemu-kernel && rm /cache/vc${debugSuffix}.tar`
      ];
      
      console.log(`Executing: ${snapshotCommand.join(' ')}`);
      const result = spawnSync(snapshotCommand[0], snapshotCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
      
      if (result.status !== 0) {
        console.error('Command failed with output:');
        if (result.stdout) console.error('stdout:', result.stdout.toString());
        if (result.stderr) console.error('stderr:', result.stderr.toString());
        throw new Error(`Command failed with status ${result.status || 'null (process killed)'}`);
      }
      
      console.log('✅ Squashfs created successfully');
    }
    
    // Additional steps for prod profiles (prod and prod-debug)
    if (profile === 'prod' || profile === 'prod-debug') {
      const cmSnapshotPath = cacheDir ? join(cacheDir, `vc-cm-snapshot${debugSuffix}`) : join(currentDir, `vc-cm-snapshot${debugSuffix}`);
      const cmSquashfsPath = cacheDir ? join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs`) : join(currentDir, `vc-cm-snapshot${debugSuffix}.squashfs`);
      const verityPath = cacheDir ? join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs.verity`) : join(currentDir, `vc-cm-snapshot${debugSuffix}.squashfs.verity`);
      const rootHashPath = cacheDir ? join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs.root-hash`) : join(currentDir, `vc-cm-snapshot${debugSuffix}.squashfs.root-hash`);
      
              // Check if we need to create Cartesi machine snapshot
        if (!forceRebuild && existsSync(cmSnapshotPath)) {
          console.log(`✅ vc-cm-snapshot${debugSuffix} already exists, skipping Cartesi machine creation`);
        } else {
          if (forceRebuild && existsSync(cmSnapshotPath)) {
            console.log(`🔄 Force rebuild: removing existing vc-cm-snapshot${debugSuffix}`);
            execSync(`rm -rf "${cmSnapshotPath}"`, { stdio: 'ignore' });
          }
        
                  console.log(`Creating Cartesi machine snapshot for ${profile} profile...`);
          const cartesiCommand = [
            'docker', 'run', '--rm',
            '--user', `${uid}:${gid}`,
            '-v', `${currentDir}:/work`,
            '-v', `${cacheDir}:/cache`,
            '-w', '/cache',
            VCR_SNAPSHOT_BUILDER_IMAGE,
            'bash', '-c',
            `rm -rf /cache/vc-cm-snapshot${debugSuffix} && cartesi-machine --ram-length=1024Mi --flash-drive="label:root,filename:/cache/vc${debugSuffix}.squashfs" --append-bootargs="loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro" --max-mcycle=0 --store=/cache/vc-cm-snapshot${debugSuffix}`
          ];
        
        console.log(`Executing: ${cartesiCommand.join(' ')}`);
        const cartesiResult = spawnSync(cartesiCommand[0], cartesiCommand.slice(1), { stdio: 'inherit', cwd: currentDir });
        
        if (cartesiResult.status !== 0) {
          console.error('Cartesi machine command failed with status:', cartesiResult.status);
          throw new Error(`Cartesi machine command failed with status ${cartesiResult.status}`);
        }
        
        console.log(`✅ Cartesi machine snapshot created successfully for ${profile} profile`);
        
        // Print the hash from vc-cm-snapshot/hash
        try {
          const hashPath = join(cmSnapshotPath, 'hash');
          if (existsSync(hashPath)) {
            const hashBuffer = readFileSync(hashPath);
            const hash = hashBuffer.toString('hex');
            console.log(`🔐 Cartesi machine hash: ${hash}`);
          } else {
            console.error(`❌ Error: Cartesi machine hash file not found at vc-cm-snapshot${debugSuffix}/hash`);
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
        console.log(`✅ vc-cm-snapshot${debugSuffix}.squashfs already exists, skipping compression`);
      } else {
        console.log(`Creating compressed Cartesi machine snapshot for ${profile} profile...`);
        const compressCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          VCR_SNAPSHOT_BUILDER_IMAGE,
          'bash', '-c',
          `rm -f /cache/vc-cm-snapshot${debugSuffix}.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs /cache/vc-cm-snapshot${debugSuffix} /cache/vc-cm-snapshot${debugSuffix}.squashfs -comp zstd -reproducible > /dev/null 2>&1`
        ];
        
        console.log(`Executing: ${compressCommand.join(' ')}`);
        const compressResult = spawnSync(compressCommand[0], compressCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (compressResult.status !== 0) {
          console.error('Compression command failed with output:');
          if (compressResult.stdout) console.error('stdout:', compressResult.stdout.toString());
          if (compressResult.stderr) console.error('stderr:', compressResult.stderr.toString());
          throw new Error(`Compression command failed with status ${compressResult.status || 'null (process killed)'}`);
        }
        
        console.log(`✅ Compressed Cartesi machine snapshot created successfully for ${profile} profile`);
      }
      
      // Verify file size is divisible by 512 (required for block devices)
      let fileSize: number;
      try {
        const stats = statSync(cmSquashfsPath);
        fileSize = stats.size;
        if (fileSize % 512 !== 0) {
          console.error(`❌ Error: vc-cm-snapshot${debugSuffix}.squashfs size (${fileSize} bytes) is not divisible by 512`);
          console.error(`   Remainder: ${fileSize % 512} bytes`);
          console.error(`   Required for proper block device alignment`);
          process.exit(1);
        }
      } catch (err) {
        console.error(`❌ Error: Could not verify vc-cm-snapshot${debugSuffix}.squashfs file size:`, err);
        process.exit(1);
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
          VCR_SNAPSHOT_BUILDER_IMAGE,
          'bash', '-c',
          `rm -f /cache/vc-cm-snapshot${debugSuffix}.squashfs.verity && veritysetup --root-hash-file /cache/vc-cm-snapshot${debugSuffix}.squashfs.root-hash --hash-offset=${fileSize} --salt=${salt} --uuid=${deterministicUuid} format /cache/vc-cm-snapshot${debugSuffix}.squashfs /cache/vc-cm-snapshot${debugSuffix}.squashfs`
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
        
        // Verify the verity setup was correct
        console.log('Verifying verity setup...');
        const verifyCommand = [
          'docker', 'run', '--rm',
          '--user', `${uid}:${gid}`,
          '-v', `${currentDir}:/work`,
          '-v', `${cacheDir}:/cache`,
          '-w', '/cache',
          VCR_SNAPSHOT_BUILDER_IMAGE,
          'bash', '-c',
          `veritysetup verify --root-hash-file=/cache/vc-cm-snapshot${debugSuffix}.squashfs.root-hash --hash-offset=${fileSize} /cache/vc-cm-snapshot${debugSuffix}.squashfs /cache/vc-cm-snapshot${debugSuffix}.squashfs`
        ];
        
        console.log(`Executing verification: ${verifyCommand.join(' ')}`);
        const verifyResult = spawnSync(verifyCommand[0], verifyCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (verifyResult.status !== 0) {
          console.error('Verity verification failed with output:');
          if (verifyResult.stdout) console.error('stdout:', verifyResult.stdout.toString());
          if (verifyResult.stderr) console.error('stderr:', verifyResult.stderr.toString());
          throw new Error(`Verity verification failed with status ${verifyResult.status}`);
        }
        
        console.log('✅ Verity setup verified successfully');
      }
      
      // Print all hashes and file contents (always run, even if cached)
      console.log('\n📊 Build Artifacts Summary:');
      
      // Print SHA256 of vc.squashfs
      try {
        const vcSquashfsPath = cacheDir ? join(cacheDir, `vc${debugSuffix}.squashfs`) : join(currentDir, `vc${debugSuffix}.squashfs`);
        if (existsSync(vcSquashfsPath)) {
          const vcSquashfsHash = execSync(`sha256sum "${vcSquashfsPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc${debugSuffix}.squashfs SHA256: ${vcSquashfsHash}`);
        } else {
          console.log(`⚠️  vc${debugSuffix}.squashfs not found`);
        }
      } catch (err) {
        console.log(`⚠️  Could not calculate vc${debugSuffix}.squashfs SHA256:`, err);
      }
      
      // Print SHA256 of vc-cm-snapshot.squashfs
      try {
        const cmSquashfsPath = cacheDir ? join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs`) : join(currentDir, `vc-cm-snapshot${debugSuffix}.squashfs`);
        if (existsSync(cmSquashfsPath)) {
          const cmSquashfsHash = execSync(`sha256sum "${cmSquashfsPath}"`, { encoding: 'utf8' }).trim().split(' ')[0];
          console.log(`📦 vc-cm-snapshot${debugSuffix}.squashfs SHA256: ${cmSquashfsHash}`);
        } else {
          console.log(`⚠️  vc-cm-snapshot${debugSuffix}.squashfs not found`);
        }
      } catch (err) {
        console.log(`⚠️  Could not calculate vc-cm-snapshot${debugSuffix}.squashfs SHA256:`, err);
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
        if (existsSync(rootHashPath)) {
          const rootHash = execSync(`cat "${rootHashPath}"`, { encoding: 'utf8' }).trim();
          console.log(`🔑 Root hash: ${rootHash}`);
        } else {
          console.log('⚠️  Root hash file not found');
        }
      } catch (err) {
        console.log('⚠️  Could not read root hash:', err);
      }
      
      // Print hash offset
      console.log(`📍 Hash offset: ${fileSize} bytes`);
      

    }
    
  } catch (err) {
    console.error('Error building LinuxKit image:', err);
    process.exit(1);
  }
}

export function buildImage(imageTag: string, profile: string, userCacheDir?: string, forceRebuild = false, useDepot = false, useTarContext = true, forceDockerTar = false, turbo = false, guestAgentImage?: string, hot = false, useExistingImage?: string): string | undefined {
  const currentDir = cwd();
  
  // If using existing image, skip build process
  if (useExistingImage) {
    console.log(`Using existing image: ${imageTag}`);
    console.log(`Profile: ${profile}`);
    
    // For stage/prod profiles, we'll use the image reference directly in LinuxKit YAML
    if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
      console.log('✅ Using existing image for stage/prod profile - will reference directly in LinuxKit YAML');
      
      // Get cache directory based on image tag, profile, and guest-agent image
      const cacheDir = getCacheDirectory(imageTag, profile, guestAgentImage);
      
      // Create cache directory if it doesn't exist
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }
      
      // Build LinuxKit image with direct image reference
      console.log(`\n🔄 Building LinuxKit image for ${profile} profile...`);
      const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, undefined, guestAgentImage);
      buildLinuxKitImage(yamlPath, profile, undefined, cacheDir, forceRebuild);
      
      return undefined; // No OCI tar needed
    }
    
    return undefined; // No build needed
  }
  
  console.log(`Building image: ${imageTag}`);
  console.log(`Profile: ${profile}`);
  if (useDepot) {
    console.log(`Using Depot build`);
  } else {
    // Check if depot binary is available and suggest using it
    try {
      execSync('depot --version', { stdio: 'ignore' });
      console.log('💡 Tip: depot binary found in PATH. Use --depot for faster builds!');
    } catch (err) {
      // depot not available, ignore
    }
  }
  
  // Check if Dockerfile exists
  if (!existsSync(join(currentDir, 'Dockerfile'))) {
    console.error('Error: No Dockerfile found in current directory');
    process.exit(1);
  }
  
  // Resolve platforms
  const platforms = resolvePlatforms(profile);
  
  // Get cache directory based on image tag, profile, and guest-agent image
  const cacheDir = getCacheDirectory(imageTag, profile, guestAgentImage);
  
  // Create cache directory if it doesn't exist
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Check for guest-agent image changes for prod/prod-debug profiles
  if ((profile === 'prod' || profile === 'prod-debug') && guestAgentImage) {
    const guestAgentCacheFile = join(cacheDir, 'guest-agent-image.txt');
    let needsGuestAgentRebuild = false;
    
    if (existsSync(guestAgentCacheFile)) {
      const cachedImage = readFileSync(guestAgentCacheFile, 'utf8').trim();
      if (cachedImage !== guestAgentImage) {
        console.log(`🔄 Guest agent image changed: ${cachedImage} → ${guestAgentImage}`);
        console.log('Forcing rebuild due to guest agent image change...');
        needsGuestAgentRebuild = true;
        forceRebuild = true;
      } else {
        console.log(`✅ Guest agent image unchanged: ${guestAgentImage}`);
      }
    } else {
      console.log(`📝 Caching guest agent image: ${guestAgentImage}`);
      needsGuestAgentRebuild = true;
    }
    
    // Update the cache file
    writeFileSync(guestAgentCacheFile, guestAgentImage);
  }
  
  // Create OCI tar file path - always use cache directory
  const safeImageName = imageTag.replace(/[:/]/g, '-');
  const ociTarPath = join(cacheDir, `${safeImageName}.tar`);
  
  let contextBuilder: TarContextBuilder | undefined;
  let contextTarPath: string | undefined;
  
  if (useTarContext) {
    // Create deterministic tar context
    contextBuilder = new TarContextBuilder({
      contextPath: currentDir,
      outputPath: join(cacheDir, 'build-context.tar'),
      deterministic: true,
      forceDocker: forceDockerTar
    });
    
    // Get context hash for caching
    const contextHash = contextBuilder.getContextHash();
    console.log(`📦 Build context hash: ${contextHash}`);
    
    // Create the deterministic tar context
    contextTarPath = contextBuilder.createTar();
  }
  
  let buildCommand: string;
  let useStdin = false;
  
  if (useDepot) {
    // Use depot build
    const buildArgs = [
      'build',
      '--platform', platforms.join(','),
      '--provenance=false',
      '--sbom=false',
    ];
    
    // Add SOURCE_DATE_EPOCH build arg for deterministic builds
    if (["stage", "stage-release", "prod", "prod-debug"].includes(profile)) {
      buildArgs.push('--build-arg', 'SOURCE_DATE_EPOCH=1752444000');
    }
    // Add hot reload build arg for dev+hot
    if (profile === 'dev' && hot) {
      buildArgs.push('--build-arg', 'HOT_RELOAD=true');
    }
    
    if (profile === 'dev') {
      // For dev profile, only output to Docker
      buildArgs.push('--output', `type=docker,name=${imageTag}`);
    } else {
      // For test/prod profiles, output to OCI tar for LinuxKit
      buildArgs.push('--output', `type=oci,dest=${ociTarPath},name=${imageTag},rewrite-timestamp=true`);
    }
    
    // Use tar file via stdin if available, otherwise use directory
    if (contextTarPath) {
      buildArgs.push('-'); // Use stdin for tar context
      useStdin = true;
    } else {
      buildArgs.push('.');
    }
    
    buildCommand = `depot ${buildArgs.join(' ')}`;
  } else {
    // Use docker buildx build
    const buildArgs = [
      'buildx',
      'build',
      '--platform', platforms.join(','),
      '--provenance=false',
      '--sbom=false',
    ];
    
    // Add SOURCE_DATE_EPOCH build arg for deterministic builds
    if (["stage", "stage-release", "prod", "prod-debug"].includes(profile)) {
      buildArgs.push('--build-arg', 'SOURCE_DATE_EPOCH=1752444000');
    }
    // Add hot reload build arg for dev+hot
    if (profile === 'dev' && hot) {
      buildArgs.push('--build-arg', 'HOT_RELOAD=true');
    }
    // Set output based on profile
    if (profile === 'dev') {
      // For dev profile, load into Docker
      buildArgs.push('--output', `type=docker,name=${imageTag}`);
    } else {
      // For non-dev profiles, output to OCI tar with rewrite-timestamp
      buildArgs.push('--output', `type=oci,dest=${ociTarPath},name=${imageTag},rewrite-timestamp=true`);
    }
    
    // Use tar file via stdin if available, otherwise use directory
    if (contextTarPath) {
      buildArgs.push('-'); // Use stdin for tar context
      useStdin = true;
    } else {
      buildArgs.push('.');
    }
    
    buildCommand = `docker ${buildArgs.join(' ')}`;
  }
    
  console.log(`\n🔧 Executing build command:`);
  console.log(`${buildCommand}\n`);
  
  try {
    // Set SOURCE_DATE_EPOCH for deterministic builds on non-dev profiles
    const sourceDateEpoch = ["stage", "stage-release", "prod", "prod-debug"].includes(profile) ? '1752444000' : '0';
    
    if (useStdin && contextTarPath) {
      // Pipe tar file via stdin
      const tarContent = readFileSync(contextTarPath);
      execSync(buildCommand, { 
        input: tarContent,
        stdio: ['pipe', 'inherit', 'inherit'], 
        cwd: currentDir,
        env: { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch }
      });
    } else {
      execSync(buildCommand, { 
        stdio: 'inherit', 
        cwd: currentDir,
        env: { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch }
      });
    }
    console.log(`\n✅ Build completed successfully!`);
    if (useDepot && profile === 'dev') {
      console.log(`Docker image loaded with tag: ${imageTag}`);
    } else {
      console.log(`Docker image saved to: ${ociTarPath}`);
      if (profile === 'dev') {
        console.log(`Docker image loaded with tag: ${imageTag}`);
      } else {
        console.log(`Docker image not loaded (${profile} profile uses OCI import)`);
      }
    }
    console.log(`Cache directory: ${cacheDir}`);
    
    // For stage and prod profiles, also build LinuxKit image
    if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
      console.log(`\n🔄 Building LinuxKit image for ${profile} profile...`);
      const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, ociTarPath, guestAgentImage);
      buildLinuxKitImage(yamlPath, profile, ociTarPath, cacheDir, forceRebuild);
    }
    
    // Warn about turbo flag performance characteristics
    if (turbo && (profile === 'stage' || profile === 'stage-release')) {
      console.log('\n⚠️  Performance Note: --turbo flag enabled multi-core QEMU emulation');
      console.log('   This provides faster development experience but performance will NOT');
      console.log('   be representative of production (Cartesi Machine)');
    }

    // Performance note for stage profiles without turbo
    if (!turbo && (profile === 'stage' || profile === 'stage-release')) {
      console.log('\n💡 Performance Note: Using QEMU emulation (faster than Cartesi Machine)');
      console.log('   This provides good RISC-V testing but is NOT reproducible');
      console.log('   For production performance and reproducibility, use the prod profile');
      console.log('   If you need even faster emulation, try the --turbo flag for multi-core QEMU.');
    }

    // Performance note for dev profile
    if (profile === 'dev') {
      console.log('\n💡 Performance Note: Using native platform (fastest development)');
      console.log('   This provides maximum performance but runs on your native architecture');
      console.log('   For RISC-V testing, use stage/prod profiles');
    }
    
    return ociTarPath;
  } catch (err) {
    console.error('Error building image:', err);
    process.exit(1);
  } finally {
    // Clean up the context tar file
    if (contextBuilder) {
      try {
        contextBuilder.cleanup();
      } catch (cleanupErr) {
        console.warn('Warning: Could not clean up context tar file:', cleanupErr);
      }
    }
  }
}

export function runDevEnvironment(imageTag: string, profile: string, cacheDir?: string, forceRebuild = false, forceRestart = false, useDepot = false, useTarContext = true, forceDockerTar = false, turbo = false, guestAgentImage?: string, hot = false, useExistingImage?: string) {
  console.log('Starting development environment...');
  
  // If using existing image, skip build process
  if (useExistingImage) {
    console.log(`Using existing image: ${imageTag}`);
    console.log(`Profile: ${profile}`);
    
    // For stage/prod profiles, we'll use the image reference directly in LinuxKit YAML
    if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
      console.log('✅ Using existing image for stage/prod profile - will reference directly in LinuxKit YAML');
      // Generate LinuxKit YAML with direct image reference
      const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, undefined, guestAgentImage);
      buildLinuxKitImage(yamlPath, profile, undefined, cacheDir, forceRebuild);
      return;
    }
    
    // For dev profile, just start the container with the existing image
    console.log('✅ Using existing image for dev profile');
    startFileWatcher(imageTag, profile, cacheDir, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, false, hot, useExistingImage);
    return;
  }
  
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
    
    // Build the container (or use existing image)
    const ociTarPath = buildImage(imageTag, profile, cacheDir, forceRebuild, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, hot, useExistingImage);
    
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    let needsUpdate = false;
    
    // Detect current profile and check if profile change is needed
    const currentProfile = detectCurrentProfile();
    const profileChangeNeeded = needsProfileChange(currentProfile, profile);
    
    if (profileChangeNeeded && currentProfile) {
      console.log(`🔄 Profile change detected: ${currentProfile} → ${profile}`);
      console.log('Bringing down current environment...');
      try {
        execSync(`docker compose -f ${composePath} down`, { stdio: 'inherit' });
        console.log('✅ Current environment stopped');
      } catch (err) {
        console.log('⚠️  Could not stop current environment, continuing...');
      }
      needsUpdate = true;
    } else if (currentProfile) {
      console.log(`✅ Current profile (${currentProfile}) matches requested profile (${profile})`);
    } else {
      console.log(`🚀 Starting new environment with profile: ${profile}`);
    }
    
    // Check if compose file exists and if tag matches
    if (!forceRestart && existsSync(composePath) && !profileChangeNeeded) {
      try {
        const composeContent = readFileSync(composePath, 'utf8');
        const composeConfig = JSON.parse(composeContent);
        const currentImage = composeConfig.services?.isolated_service?.image;
        
        if (currentImage) {
          const expectedImage = imageTag; // Use the image tag directly since it's loaded in Docker
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
      // Get the cache directory that was used during the build
      const buildCacheDir = getCacheDirectory(imageTag, profile, guestAgentImage);
      generateDockerCompose(imageTag, profile, ociTarPath, buildCacheDir, turbo, guestAgentImage, profile === 'dev' && hot);
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
        execSync(`docker compose -f ${composePath} up -d --force-recreate --wait isolated_service`, { stdio: 'inherit' });
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
    if (profile === 'dev') {
      console.log(`- Function endpoint: http://localhost:8080 (IPv4) or http://[::1]:8081 (IPv6)`);
    } else {
      console.log(`- Function endpoint: http://localhost:8080`);
    }
    console.log('- Health check: http://localhost:8080/health');
    console.log('- To stop: vcr down');
    console.log('- To view container logs: vcr logs');
    console.log('- To follow container logs: vcr logs -f');
    console.log('- To view system logs: vcr logs --system');
    
    // Warn about turbo flag performance characteristics
    if (turbo && (profile === 'stage' || profile === 'stage-release')) {
      console.log('\n⚠️  Performance Note: --turbo flag enabled multi-core QEMU emulation');
      console.log('   This provides faster development experience but performance will NOT');
      console.log('   be representative of production (Cartesi Machine)');
    }

    // Performance note for stage profiles without turbo
    if (!turbo && (profile === 'stage' || profile === 'stage-release')) {
      console.log('\n💡 Performance Note: Using QEMU emulation (faster than Cartesi Machine)');
      console.log('   This provides good RISC-V testing but is NOT reproducible');
      console.log('   For production performance and reproducibility, use the prod profile');
      console.log('   If you need even faster emulation, try the --turbo flag for multi-core QEMU.');
    }
    
    // Performance note for dev profile
    if (profile === 'dev') {
      console.log('\n💡 Performance Note: Using native platform (fastest development)');
      console.log('   This provides maximum performance but runs on your native architecture');
      console.log('   For RISC-V testing, use stage/prod profiles');
    }
    
    // Start file watcher for stage/prod profiles with hot reload
    if (hot && (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug' || profile === 'dev')) {
      startFileWatcher(imageTag, profile, cacheDir, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, false, hot, useExistingImage);
    }
    
    // For dev profile with hot reload, check if image supports in-container file watching
    if (hot && profile === 'dev') {
      if (hasHotReloadSupport(imageTag)) {
        console.log(`\n🔥 Hot reload enabled for dev profile (in-container file watching)`);
        console.log(`📁 Source code mounted to /app - changes will trigger instant restarts\n`);
      } else {
        console.log(`\n🔥 Hot reload enabled for dev profile (rebuild on changes)`);
        console.log(`📁 Watching for changes in: ${cwd()}`);
        console.log(`🔄 Will rebuild and restart on file changes`);
        console.log(`⏹️  Press Ctrl+C to stop watching and exit\n`);
        
        // Start file watcher for dev profile when image doesn't support in-container watching
        startFileWatcher(imageTag, profile, cacheDir, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, true, hot, useExistingImage);
      }
    }
    
  } catch (err) {
    console.error('Error starting development environment:', err);
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

// File watcher for stage/prod hot reload
function startFileWatcher(imageTag: string, profile: string, cacheDir?: string, useDepot = false, useTarContext = true, forceDockerTar = false, turbo = false, guestAgentImage?: string, skipMessage = false, hot = false, useExistingImage?: string) {
  const currentDir = cwd();
  if (!skipMessage) {
    console.log(`\n🔥 Hot reload enabled for ${profile} profile`);
    console.log(`📁 Watching for changes in: ${currentDir}`);
    console.log(`🔄 Will rebuild and restart on file changes`);
    console.log(`⏹️  Press Ctrl+C to stop watching and exit\n`);
  }

  let isRebuilding = false;
  let rebuildTimeout: NodeJS.Timeout | null = null;

  const triggerRebuild = () => {
    if (isRebuilding) {
      console.log(`⏳ Rebuild already in progress, skipping...`);
      return;
    }

    isRebuilding = true;
    console.log(`\n🔄 File change detected! Rebuilding and restarting...`);

    try {
      // If using existing image, skip build process
      if (useExistingImage) {
        console.log('ℹ️  Using existing image - skipping build process');
        
        if (profile === 'dev') {
          // For dev profile, just restart the container
          const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
          console.log('Restarting isolated_service container...');
          execSync(`docker compose -f ${composePath} up -d --force-recreate --wait isolated_service`, { stdio: 'inherit' });
          console.log(`✅ Dev environment restarted successfully!`);
        } else {
          // For stage/prod profiles, regenerate LinuxKit YAML and rebuild
          const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, undefined, guestAgentImage);
          buildLinuxKitImage(yamlPath, profile, undefined, cacheDir, true);
          console.log(`✅ Environment rebuilt and restarted successfully!`);
        }
      } else {
        if (profile === 'dev') {
          // For dev profile, just rebuild the image and swap the container
          console.log('Building new image...');
          buildImage(imageTag, profile, cacheDir, false, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, hot);
          
          // Swap out just the isolated_service container
          const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
          console.log('Swapping isolated_service container...');
          execSync(`docker compose -f ${composePath} up -d --force-recreate --wait isolated_service`, { stdio: 'inherit' });
          
          console.log(`✅ Dev environment rebuilt and restarted successfully!`);
        } else {
          // For stage/prod profiles, use the full rebuild approach
          runDevEnvironment(imageTag, profile, cacheDir, true, false, useDepot, useTarContext, forceDockerTar, turbo, guestAgentImage, false); // hot=false to avoid infinite recursion
          console.log(`✅ Environment rebuilt and restarted successfully!`);
        }
      }
      
    } catch (err) {
      console.error(`❌ Error during rebuild:`, err);
    } finally {
      isRebuilding = false;
    }
  };

  const debouncedRebuild = () => {
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    rebuildTimeout = setTimeout(triggerRebuild, 1000); // Debounce for 1 second
  };

  // Watch the current directory recursively
  const watcher = watch(currentDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    // Skip certain files/directories
    const skipPatterns = [
      '.git', '.vscode', 'node_modules', '__pycache__', '.pytest_cache',
      '.cache', 'target', 'dist', 'build', '.mypy_cache', '.coverage',
      '*.pyc', '*.pyo', '*.log', '*.tmp', '*.swp', '*.swo'
    ];
    
    const shouldSkip = skipPatterns.some(pattern => {
      if (pattern.includes('*')) {
        return filename.endsWith(pattern.replace('*', ''));
      }
      return filename.includes(pattern);
    });
    
    if (shouldSkip) return;
    
    console.log(`📝 File change detected: ${filename}`);
    debouncedRebuild();
  });

  // Handle process termination
  process.on('SIGINT', () => {
    console.log(`\n🛑 Stopping file watcher...`);
    watcher.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`\n🛑 Stopping file watcher...`);
    watcher.close();
    process.exit(0);
  });

  return watcher;
} 