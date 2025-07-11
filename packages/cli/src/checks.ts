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

function createBuildKitConfig() {
  console.log('Creating BuildKit configuration for insecure registry...');
  try {
    const buildkitConfig = `[registry."vcr-registry:5000"]
http = true
insecure = true
`;
    
    const vcrCacheDir = join(homedir(), '.cache', 'vcr');
    if (!existsSync(vcrCacheDir)) {
      mkdirSync(vcrCacheDir, { recursive: true });
    }
    
    const configPath = join(vcrCacheDir, 'buildkitd.toml');
    writeFileSync(configPath, buildkitConfig);
    console.log('✅ BuildKit configuration created');
    return configPath;
  } catch (err) {
    console.error('Error creating BuildKit config:', err);
    return null;
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
      
      // Set restart policy to no for the underlying container
      try {
        execSync('docker update --restart=no vcr-builder0', { stdio: 'ignore' });
        console.log('✅ vcr-builder restart policy set to no');
      } catch (updateErr) {
        console.log('ℹ️  Could not update vcr-builder restart policy');
      }
      
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
      
      // Write config to VCR cache directory (persistent across reboots)
      const vcrCacheDir = join(homedir(), '.cache', 'vcr');
      if (!existsSync(vcrCacheDir)) {
        mkdirSync(vcrCacheDir, { recursive: true });
      }
      
      const configPath = join(vcrCacheDir, 'registry-config.yml');
      
      // Ensure the file is created before Docker run
      writeFileSync(configPath, JSON.stringify(registryConfig, null, 2));
      console.log(`✅ Registry config created at: ${configPath}`);
      
      execSync(`docker run -d -p 5001:5000 --restart=no --name vcr-registry --network vcr-network -v ${configPath}:/etc/docker/registry/config.yml registry:3`, { stdio: 'inherit' });
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