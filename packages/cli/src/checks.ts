import { execSync } from 'child_process';
import { writeFileSync, existsSync, statSync, rmdirSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function checkDockerAvailable() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch (err) {
    console.error('Error: Docker is not available or not running. Please install/start Docker and try again.');
    process.exit(1);
  }
}

export function checkVsockSupport() {
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
  // Check if current builder supports OCI exports
  checkOciExportSupport();
}

export function checkOciExportSupport() {
  try {
    // Get all available builders
    const buildersList = execSync('docker buildx ls', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Get current builder info
    const currentBuilderInfo = execSync('docker buildx inspect --bootstrap', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Check if current builder is a docker driver (which doesn't support OCI exports)
    if (currentBuilderInfo.includes('Driver: docker')) {
      console.log('⚠️  Current buildx builder uses docker driver, which does not support OCI exports');
      console.log('   This will cause issues with stage/prod profile builds that use OCI output format.');
      console.log('');
      
      // Look for other builders that might support OCI exports
      const lines = buildersList.split('\n');
      const compatibleBuilders: string[] = [];
      
      for (const line of lines) {
        if (line.includes('docker-container') || line.includes('kubernetes') || line.includes('remote')) {
          const builderName = line.split(/\s+/)[0];
          if (builderName && !builderName.includes('*')) {
            compatibleBuilders.push(builderName);
          }
        }
      }
      
      if (compatibleBuilders.length > 0) {
        console.log('💡 Found compatible builders that support OCI exports:');
        compatibleBuilders.forEach(builder => {
          console.log(`   - ${builder}`);
        });
        console.log('');
        console.log('   To switch to a compatible builder, run:');
        console.log(`   docker buildx use ${compatibleBuilders[0]}`);
        console.log('');
      } else {
        console.log('💡 To fix this, create a new builder with docker-container driver:');
        console.log('   docker buildx create --name oci-builder --driver docker-container --use');
        console.log('');
        console.log('   Or update the default builder:');
        console.log('   docker buildx create --name default --driver docker-container --use');
        console.log('');
      }
      
      console.log('   Then try your build again.');
      console.log('');
      
      // Don't exit for dev profile builds, but warn
      // The actual check should be done in the build function based on profile
      return false;
    }
    
    console.log('✅ Current buildx builder supports OCI exports');
    return true;
  } catch (err) {
    console.error('❌ Error checking buildx builder OCI export support:', err);
    console.error('Please ensure you have a working buildx builder configured.');
    process.exit(1);
  }
}

export function requireOciExportSupport() {
  try {
    // Get all available builders
    const buildersList = execSync('docker buildx ls', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Get current builder info
    const currentBuilderInfo = execSync('docker buildx inspect --bootstrap', { 
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    // Check if current builder is a docker driver (which doesn't support OCI exports)
    if (currentBuilderInfo.includes('Driver: docker')) {
      console.error('❌ Error: Current buildx builder uses docker driver, which does not support OCI exports');
      console.error('   This is required for stage/prod profile builds that use OCI output format.');
      console.error('');
      
      // Look for other builders that might support OCI exports
      const lines = buildersList.split('\n');
      const compatibleBuilders: string[] = [];
      
      for (const line of lines) {
        if (line.includes('docker-container') || line.includes('kubernetes') || line.includes('remote')) {
          const builderName = line.split(/\s+/)[0];
          if (builderName && !builderName.includes('*')) {
            compatibleBuilders.push(builderName);
          }
        }
      }
      
      if (compatibleBuilders.length > 0) {
        console.error('💡 Found compatible builders that support OCI exports:');
        compatibleBuilders.forEach(builder => {
          console.error(`   - ${builder}`);
        });
        console.error('');
        console.error('   To switch to a compatible builder, run:');
        console.error(`   docker buildx use ${compatibleBuilders[0]}`);
        console.error('');
        console.error('   Then try your build again.');
      } else {
        console.error('💡 To fix this, create a new builder with docker-container driver:');
        console.error('   docker buildx create --name oci-builder --driver docker-container --use');
        console.error('');
        console.error('   Or update the default builder:');
        console.error('   docker buildx create --name default --driver docker-container --use');
        console.error('');
        console.error('   Then try your build again.');
      }
      
      process.exit(1);
    }
    
    return true;
  } catch (err) {
    console.error('❌ Error checking buildx builder OCI export support:', err);
    console.error('Please ensure you have a working buildx builder configured.');
    process.exit(1);
  }
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