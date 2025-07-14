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
  // No longer needed - using default buildx builder
  // This function is kept for backward compatibility but does nothing
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