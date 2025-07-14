import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

// Import functions from the main CLI file
import { getComposeCacheDirectory } from '../cli';

export function pruneVcrLocal() {
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

export function pruneVcr() {
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
    
    // vcr-builder no longer used - using default buildx builder
    
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