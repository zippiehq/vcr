import { execSync, spawnSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
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
  checkRiscv64Support 
} from '../checks';

// Import checkVsockSupport function
import { checkVsockSupport } from '../checks';
import { generateLinuxKitYaml, generateDockerCompose } from '../generate';

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

export function handleBuildCommand(args: string[]): void {
  checkBuildxAvailable();
  checkVcrBuilder();
  // Removed: checkLocalRegistry();
  
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
  // Removed: checkLocalRegistry();
  
  let imageTag: string | undefined;
  let profile = 'dev';
  let cacheDir: string | undefined;
  let forceRebuild = false;
  let forceRestart = false;
  
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
    } else if (arg === '--restart') {
      forceRestart = true;
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
  
  runDevEnvironment(imageTag, profile, cacheDir, forceRebuild, forceRestart);
}

// Helper functions that need to be copied from cli.ts
function getCacheDirectory(imageTag?: string): string {
  const pathHash = getPathHash();
  const baseCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  if (imageTag) {
    // Create a hash of the image tag for cache directory
    const imageHash = createHash('sha256').update(imageTag).digest('hex').substring(0, 8);
    return join(baseCacheDir, imageHash);
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

function buildLinuxKitImage(yamlPath: string, profile: string, ociTarPath?: string, cacheDir?: string, forceRebuild = false) {
  console.log('Building LinuxKit image...');
  
  if (ociTarPath) {
    console.log(`Using OCI image: ${ociTarPath}`);
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
          '-w', '/cache',
          imageName,
          'cache', 'import', containerOciTarPath
        ];
        
        console.log(`Executing: ${importCommand.join(' ')}`);
        execSync(importCommand.join(' '), { stdio: 'inherit', cwd: currentDir });
        console.log('✅ OCI image imported into LinuxKit cache');
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
        'rm -f /cache/vc.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs - /cache/vc.squashfs -tar -noI -noId -noD -noF -noX -reproducible < /cache/vc.tar > /dev/null 2>&1 && cp /usr/share/qemu/images/linux-riscv64-Image /cache/vc.qemu-kernel && rm /cache/vc.tar'
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
          'rm -rf /cache/vc-cm-snapshot && cartesi-machine --ram-length=1024Mi --flash-drive="label:root,filename:/cache/vc.squashfs" --append-bootargs="loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro" --max-mcycle=0 --store=/cache/vc-cm-snapshot'
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
          'rm -f /cache/vc-cm-snapshot.squashfs && SOURCE_DATE_EPOCH=0 mksquashfs /cache/vc-cm-snapshot /cache/vc-cm-snapshot.squashfs -comp zstd -reproducible > /dev/null 2>&1'
        ];
        
        console.log(`Executing: ${compressCommand.join(' ')}`);
        const compressResult = spawnSync(compressCommand[0], compressCommand.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], cwd: currentDir });
        
        if (compressResult.status !== 0) {
          console.error('Compression command failed with output:');
          if (compressResult.stdout) console.error('stdout:', compressResult.stdout.toString());
          if (compressResult.stderr) console.error('stderr:', compressResult.stderr.toString());
          throw new Error(`Compression command failed with status ${compressResult.status || 'null (process killed)'}`);
        }
        
        console.log('✅ Compressed Cartesi machine snapshot created successfully');
      }
      
      // Verify file size is divisible by 512 (required for block devices)
      let fileSize: number;
      try {
        const stats = statSync(cmSquashfsPath);
        fileSize = stats.size;
        if (fileSize % 512 !== 0) {
          console.error(`❌ Error: vc-cm-snapshot.squashfs size (${fileSize} bytes) is not divisible by 512`);
          console.error(`   Remainder: ${fileSize % 512} bytes`);
          console.error(`   Required for proper block device alignment`);
          process.exit(1);
        }
      } catch (err) {
        console.error('❌ Error: Could not verify vc-cm-snapshot.squashfs file size:', err);
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
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          `rm -f /cache/vc-cm-snapshot.squashfs.verity && veritysetup --root-hash-file /cache/vc-cm-snapshot.squashfs.root-hash --hash-offset=${fileSize} --salt=${salt} --uuid=${deterministicUuid} format /cache/vc-cm-snapshot.squashfs /cache/vc-cm-snapshot.squashfs`
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
          'ghcr.io/zippiehq/vcr-snapshot-builder',
          'bash', '-c',
          `veritysetup verify --root-hash-file=/cache/vc-cm-snapshot.squashfs.root-hash --hash-offset=${fileSize} /cache/vc-cm-snapshot.squashfs /cache/vc-cm-snapshot.squashfs`
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

export function buildImage(imageTag: string, profile: string, userCacheDir?: string, forceRebuild = false): string | undefined {
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
  
  // Get cache directory based on image tag
  const cacheDir = getCacheDirectory(imageTag);
  
  // Create cache directory if it doesn't exist
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  
  // Create OCI tar file path - always use cache directory
  const safeImageName = imageTag.replace(/[:/]/g, '-');
  const ociTarPath = join(cacheDir, `${safeImageName}.tar`);
  
  // Build command - Export to OCI tar AND load into Docker simultaneously
  const buildArgs = [
    'buildx',
    'build',
    '--builder', 'vcr-builder',
    '--platform', platforms.join(','),
    '--output', `type=oci,dest=${ociTarPath},name=${imageTag}`,
    '--output', `type=docker,name=${imageTag}`,
    '--provenance=false',
    '--sbom=false',
  ];
  
  // Add context directory
  buildArgs.push('.');
  
  const buildCommand = `docker ${buildArgs.join(' ')}`;
    
  console.log(`\n🔧 Executing build command:`);
  console.log(`${buildCommand}\n`);
  
  try {
    execSync(buildCommand, { 
      stdio: 'inherit', 
      cwd: currentDir,
      env: { ...process.env, SOURCE_DATE_EPOCH: '0' }
    });
    console.log(`\n✅ Build completed successfully!`);
    console.log(`Docker image saved to: ${ociTarPath}`);
    console.log(`Docker image loaded with tag: ${imageTag}`);
    console.log(`Cache directory: ${cacheDir}`);
    
    // For test and prod profiles, also build LinuxKit image
    if (profile === 'test' || profile === 'prod') {
      console.log(`\n🔄 Building LinuxKit image for ${profile} profile...`);
      const yamlPath = generateLinuxKitYaml(imageTag, profile, cacheDir, ociTarPath);
      buildLinuxKitImage(yamlPath, profile, ociTarPath, cacheDir, forceRebuild);
    }
    
    return ociTarPath;
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
    const ociTarPath = buildImage(imageTag, profile, cacheDir, forceRebuild);
    
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
      generateDockerCompose(imageTag, profile, ociTarPath);
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