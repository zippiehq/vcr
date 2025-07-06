import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

// Import functions from the main CLI file
import { 
  checkBuildxAvailable, 
  checkVcrBuilder, 
  checkLocalRegistry, 
  checkRiscv64Support, 
  getPathHash, 
  buildImage, 
  runDevEnvironment, 
  getComposeCacheDirectory 
} from '../cli';

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