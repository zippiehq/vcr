import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { cwd } from 'process';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { getPathHash } from '../cli';
import { 
  checkBuildxAvailable, 
  checkRiscv64Support,
  requireOciExportSupport
} from '../checks';
import { TarContextBuilder } from '../tar-context';

// Import the getCacheDirectory function from build.ts
function getCacheDirectory(imageTag?: string, profile?: string): string {
  const pathHash = getPathHash();
  const baseCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  if (imageTag) {
    // Create a hash of the image tag for cache directory
    const imageHash = createHash('sha256').update(imageTag).digest('hex').substring(0, 8);
    return join(baseCacheDir, imageHash);
  }
  
  return baseCacheDir;
}

export function handlePushCommand(args: string[]): void {
  checkBuildxAvailable();
  checkRiscv64Support();
  requireOciExportSupport();
  
  let registryPath: string | undefined;
  let userCacheDir: string | undefined;
  let forceRebuild = false;
  let useDepot = false;
  let noDepot = false;
  let useTarContext = true; // Always use tar context for prod builds
  let forceDockerTar = false;

  // Parse push arguments
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    if (arg === '--cache-dir') {
      if (nextArg) {
        userCacheDir = nextArg;
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
    } else if (arg === '--force-docker-tar') {
      forceDockerTar = true;
    } else if (!arg.startsWith('-')) {
      // First non-flag argument is the registry path
      registryPath = arg;
    }
  }

  // Validate required arguments
  if (!registryPath) {
    console.error('Error: vcr push requires a registry path');
    console.log('Usage: vcr push <registry-path> [options]');
    console.log('Examples:');
    console.log('  vcr push my-registry.com/myapp:latest');
    console.log('  vcr push ghcr.io/myuser/myapp:v1.0.0');
    process.exit(1);
  }

  // Validate registry path format
  if (!registryPath.includes('/') || !registryPath.includes(':')) {
    console.error('Error: Registry path must be in format: registry.com/name:tag');
    console.error('Example: my-registry.com/myapp:latest');
    process.exit(1);
  }

  // Auto-detect depot.json if neither --depot nor --no-depot was specified
  if (!useDepot && !noDepot) {
    const depotJsonPath = join(cwd(), 'depot.json');
    if (existsSync(depotJsonPath)) {
      useDepot = true;
      console.log('📦 depot.json detected, using depot build');
    }
  }

  // Check if Dockerfile exists
  if (!existsSync(join(cwd(), 'Dockerfile'))) {
    console.error('Error: No Dockerfile found in current directory');
    process.exit(1);
  }

  console.log(`🚀 Building and pushing prod (RISC-V) container to: ${registryPath}`);

  // For pushing to registry, we need to build with docker output instead of OCI tar
  // We'll build with prod profile but override the output to use docker format
  const profile = 'prod';
  
  // Build the image with prod profile but docker output for registry push
  const currentDir = cwd();
  console.log(`Building image: ${registryPath}`);
  console.log(`Profile: ${profile}`);
  
  // Check if Dockerfile exists
  if (!existsSync(join(currentDir, 'Dockerfile'))) {
    console.error('Error: No Dockerfile found in current directory');
    process.exit(1);
  }
  
  // Resolve platforms for prod (RISC-V 64-bit)
  const platforms = ['linux/riscv64'];
  
  // Get cache directory based on image tag and profile
  const cacheDir = userCacheDir || getCacheDirectory(registryPath, profile);
  
  // Create cache directory if it doesn't exist
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  
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
    // Use depot build with registry output for direct push
    const buildArgs = [
      'build',
      '--platform', platforms.join(','),
      '--provenance=false',
      '--sbom=false',
      '--build-arg', 'SOURCE_DATE_EPOCH=1752444000',
      '--output', `type=registry,name=${registryPath}`,
    ];
    
    // Use tar file via stdin if available, otherwise use directory
    if (contextTarPath) {
      buildArgs.push('-'); // Use stdin for tar context
      useStdin = true;
    } else {
      buildArgs.push('.');
    }
    
    buildCommand = `depot ${buildArgs.join(' ')}`;
  } else {
    // Use docker buildx build with registry output for direct push
    const buildArgs = [
      'buildx',
      'build',
      '--platform', platforms.join(','),
      '--provenance=false',
      '--sbom=false',
      '--build-arg', 'SOURCE_DATE_EPOCH=1752444000',
      '--output', `type=registry,name=${registryPath}`,
    ];
    
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
    // Set SOURCE_DATE_EPOCH for deterministic builds
    const sourceDateEpoch = '1752444000';
    
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
    console.log(`\n✅ Build and push completed successfully!`);
    console.log(`📤 Successfully pushed to: ${registryPath}`);
    
  } catch (err) {
    console.error('❌ Build failed, cannot push:', err);
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

  console.log(`\n🎉 Successfully built and pushed RISC-V container to: ${registryPath}`);
  console.log(`📦 Build artifacts cached in: ${cacheDir || 'default cache directory'}`);
} 