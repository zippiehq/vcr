#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { handleBuildCommand, handleUpCommand } from './commands/build';
import { handleLogsCommand, handleExecCommand, handleShellCommand, handleCatCommand } from './commands/container';
import { generateLinuxKitYaml, generateDockerCompose } from './generate';
import { checkDockerAvailable, checkBuildxAvailable, checkVcrBuilder, checkLocalRegistry, checkRiscv64Support } from './checks';

function checkVsockSupport() {
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

export function getPathHash(): string {
  const currentPath = cwd();
  return createHash('sha256').update(currentPath).digest('hex').substring(0, 8);
}

export function getComposeCacheDirectory(): string {
  const pathHash = getPathHash();
  const composeCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  // Create compose cache directory if it doesn't exist
  if (!existsSync(composeCacheDir)) {
    mkdirSync(composeCacheDir, { recursive: true });
  }
  
  return composeCacheDir;
}

export function detectProfileAndSshKey(): { profile: 'dev' | 'test' | 'prod', sshKeyPath?: string } {
  const pathHash = getPathHash();
  const containerName = `${pathHash}-vcr-isolated-service`;
  
  try {
    const containerInfo = execSync(`docker inspect ${containerName} --format '{{.Config.Image}}'`, { encoding: 'utf8' }).trim();
    
    if (containerInfo === 'ghcr.io/zippiehq/vcr-snapshot-builder') {
      // This is a test or prod profile - find SSH key and determine which one
      const baseCacheDir = join(homedir(), '.cache', 'vcr');
      let sshKeyPath: string | undefined;
      
      if (existsSync(baseCacheDir)) {
        // First check base cache directory
        const baseKeyPath = join(baseCacheDir, 'ssh.debug-key');
        if (existsSync(baseKeyPath)) {
          sshKeyPath = baseKeyPath;
        } else {
          // Check digest-specific directories
          const cacheEntries = execSync(`ls -1 "${baseCacheDir}"`, { encoding: 'utf8' }).trim().split('\n');
          for (const entry of cacheEntries) {
            if (entry && entry !== 'linuxkit-cache') { // Skip non-digest directories
              const digestKeyPath = join(baseCacheDir, entry, 'ssh.debug-key');
              if (existsSync(digestKeyPath)) {
                sshKeyPath = digestKeyPath;
                break;
              }
            }
          }
        }
      }
      
      // Determine if it's test or prod by checking the command
      try {
        const containerCmd = execSync(`docker inspect ${containerName} --format '{{join .Config.Cmd " "}}'`, { encoding: 'utf8' }).trim();
        if (containerCmd.includes('cartesi-machine')) {
          return { profile: 'prod', sshKeyPath };
        } else {
          return { profile: 'test', sshKeyPath };
        }
      } catch (cmdErr) {
        // Fallback to test if we can't determine
        return { profile: 'test', sshKeyPath };
      }
    } else {
      return { profile: 'dev' };
    }
  } catch (inspectErr) {
    // Fallback to dev profile if we can't inspect the container
    return { profile: 'dev' };
  }
}

function showHelp() {
  console.log(`
vcr CLI - Verifiable Container Runner

Usage:
  vcr create <dir> --template <lang>  Create new project from template
  vcr build [-t <name:tag>] [options]  Build and push container images
  vcr up [-t <name:tag>] [options]    Build and run development environment with isolated networking
  vcr down                           Stop development environment
  vcr logs [-f|--follow] [--system]  View container or system logs
  vcr exec [--system] <command>      Execute command in container or system
  vcr shell [--system]               Open shell in container or system
  vcr cat <file-path>                View file contents in container
  vcr prune [--local]                Clean up VCR environment (cache, registry, builder)
  vcr --help                         Show this help message

Create Options:
  --template <lang>                  Template language (e.g., python, node, go, rust)

Build Options:
  -t, --tag <name:tag>              Image name:tag (optional, defaults to vcr-build-<path-hash>:latest)
  --profile <dev|test|prod|prod-debug>  Build profile (default: dev)
  --cache-dir <dir>                 Optional path to store exported build metadata
  --force-rebuild                   Force rebuild of cached artifacts (LinuxKit, Cartesi machine, etc.)
  --restart                         Force restart containers even if image tag matches (up command only)

Prune Options:
  --local                           Only clean current project's cache and stop its environment

Build Profiles:
  dev        Native platform only, no dev tools, no attestation
  test       RISC-V 64-bit, with dev tools, no attestation
  prod       RISC-V 64-bit, no dev tools, with attestation
  prod-debug RISC-V 64-bit, with dev tools, with attestation

Examples:
  vcr create myapp --template python    # Create new Python project
  vcr create webapp --template node     # Create new Node.js project
  vcr create api --template go          # Create new Go project
  vcr create service --template rust    # Create new Rust project
  vcr build                          # Build with default tag (vcr-build-<path-hash>:latest)
  vcr build -t web3link/myapp:1.2.3                    # Fast dev loop (native)
  vcr build -t web3link/myapp:1.2.3 --profile test     # RISC-V with dev tools
  vcr build -t web3link/myapp:1.2.3 --profile prod     # Production RISC-V
  vcr build -t web3link/myapp:1.2.3 --force-rebuild    # Force rebuild all artifacts
  vcr up                            # Build and run with default tag
  vcr up -t web3link/myapp:1.2.3                      # Build and run dev environment
  vcr up -t web3link/myapp:1.2.3 --profile test       # Build and run with RISC-V
  vcr up -t web3link/myapp:1.2.3 --force-rebuild      # Force rebuild before running
  vcr up --restart                                   # Force restart containers
  vcr down                                             # Stop development environment
  vcr logs                                             # View container logs
  vcr logs -f                                          # Follow container logs in real-time
  vcr logs --system                                    # View system logs (Docker container logs)
  vcr logs --system -f                                 # Follow system logs in real-time
  vcr exec ls -la                                      # Execute command in container
  vcr exec cat /app/config.json                        # View file in container
  vcr exec --system ps aux                             # Execute command in system (VM/container)
  vcr shell                                            # Open shell in container
  vcr shell --system                                   # Open shell in system (VM/container)
  vcr cat /app/config.json                             # View file in container
  vcr cat /app/logs/app.log                            # View log file
  vcr prune                                            # Clean up entire VCR environment
  vcr prune --local                                    # Clean up only current project

Notes:
  - Docker Compose files are stored in ~/.cache/vcr/<path-hash>/ for each project directory
  - Use 'vcr down' to stop the environment (no need to specify compose file path)
  - Use 'vcr logs' to view container logs (no need to specify compose file path)
  - Use 'vcr logs --system' to view system logs (Docker container logs)
  - Use 'vcr exec' to run commands in the container
  - Use 'vcr exec --system' to run commands in the system (VM/container)
  - Use 'vcr shell' to get an interactive shell in the container
  - Use 'vcr shell --system' to get an interactive shell in the system (VM/container)
  - Use 'vcr cat' to quickly view file contents in the application container
  - Container paths should start with /app/ to avoid ambiguity
  - Default image tags are based on the current directory path hash
  - vcr up automatically detects image changes and restarts containers when needed
  - Logs behavior varies by profile:
    * dev: vcr logs shows container logs, vcr logs --system shows all compose logs
    * test/prod: vcr logs shows /var/log/app.log via SSH, vcr logs --system shows container logs
  - Shell behavior varies by profile:
    * dev: vcr shell opens container shell, vcr shell --system opens container shell
    * test/prod: vcr shell opens container via containerd, vcr shell --system opens VM shell
  - Exec behavior varies by profile:
    * dev: vcr exec runs in container, vcr exec --system runs in container
    * test/prod: vcr exec runs in container via containerd, vcr exec --system runs in VM
  - Cat behavior varies by profile:
    * dev: vcr cat uses Docker exec to view files in container
    * test/prod: vcr cat uses SSH + containerd to view files in container

Prerequisites:
  - Docker and buildx installed
  - vcr-builder and vcr-registry will be created/started automatically if needed
`);
}

function createBuildKitConfig() {
  console.log('Creating BuildKit configuration for insecure registry...');
  try {
    const buildkitConfig = `[registry."vcr-registry:5000"]
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

function pruneVcrLocal() {
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

function createProject(targetDir: string, template: string) {
  console.log(`Creating new VCR project: ${targetDir}`);
  console.log(`Using template: ${template}`);
  
  // Check if target directory already exists
  if (existsSync(targetDir)) {
    console.error(`Error: Directory '${targetDir}' already exists`);
    console.log('Please choose a different directory name or remove the existing directory');
    process.exit(1);
  }
  
  // Create target directory
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    console.error(`Error creating directory '${targetDir}':`, err);
    process.exit(1);
  }
  
  // Clone the template repository
  const templateUrl = `https://github.com/zippiehq/vcr`;
  const tempDir = join(targetDir, '.temp-clone');
  
  try {
    console.log(`Cloning VCR repository to get template...`);
    execSync(`git clone ${templateUrl} ${tempDir}`, { stdio: 'inherit' });
    
    // Check if the template directory exists
    const templateDir = join(tempDir, 'packages', `sample-${template}`);
    if (!existsSync(templateDir)) {
      console.error(`Error: Template '${template}' not found`);
      console.log('Available templates:');
      try {
        const packagesDir = join(tempDir, 'packages');
        if (existsSync(packagesDir)) {
          const packages = execSync(`ls -d ${packagesDir}/sample-* 2>/dev/null | sed 's|.*/sample-||'`, { encoding: 'utf8' }).trim().split('\n');
          packages.forEach(pkg => {
            if (pkg) console.log(`  - ${pkg}`);
          });
        }
      } catch (listErr) {
        console.log('  (Could not list available templates)');
      }
      process.exit(1);
    }
    
    // Remove .git directory from the cloned repo
    const gitDir = join(tempDir, '.git');
    if (existsSync(gitDir)) {
      execSync(`rm -rf "${gitDir}"`, { stdio: 'ignore' });
    }
    
    // Move all files from template directory to target directory
    const files = execSync(`ls -A "${templateDir}"`, { encoding: 'utf8' }).trim().split('\n');
    for (const file of files) {
      if (file) {
        const sourcePath = join(templateDir, file);
        const targetPath = join(targetDir, file);
        execSync(`mv "${sourcePath}" "${targetPath}"`, { stdio: 'ignore' });
      }
    }
    
    // Remove temp directory
    execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
    
    console.log('✅ Project created successfully!');
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${targetDir}`);
    console.log('  vcr up');
    console.log('');
    console.log('Available commands:');
    console.log('  vcr build    # Build the container');
    console.log('  vcr up       # Build and run the development environment');
    console.log('  vcr down     # Stop the development environment');
    console.log('  vcr logs     # View container logs');
    console.log('  vcr shell    # Open shell in the container');
    
  } catch (err) {
    console.error('Error creating project:', err);
    
    // Cleanup on error
    try {
      if (existsSync(tempDir)) {
        execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
      }
      if (existsSync(targetDir)) {
        execSync(`rm -rf "${targetDir}"`, { stdio: 'ignore' });
      }
    } catch (cleanupErr) {
      console.error('Error during cleanup:', cleanupErr);
    }
    
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
      handleBuildCommand(args);
      break;
      
    case 'up':
      handleUpCommand(args);
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
      handleLogsCommand(args);
      break;
      
    case 'exec':
      handleExecCommand(args);
      break;
      
    case 'shell':
      handleShellCommand(args);
      break;
      
    case 'cat':
      handleCatCommand(args);
      break;
      
    case 'prune':
      let pruneLocal = false;
      
      // Parse prune arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--local') {
          pruneLocal = true;
        }
      }
      
      if (pruneLocal) {
        pruneVcrLocal();
      } else {
        pruneVcr();
      }
      break;
      
    case 'create':
      let projectName: string | undefined;
      let template: string | undefined;
      
      // Parse create arguments
      for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];
        
        if (arg === '--template') {
          if (nextArg) {
            template = nextArg;
            i++; // Skip next argument
          } else {
            console.error('Error: --template requires a value');
            process.exit(1);
          }
        } else if (!projectName) {
          // First non-flag argument is the project name
          projectName = arg;
        }
      }
      
      if (!projectName) {
        console.error('Error: vcr create requires a project name');
        console.log('Usage: vcr create <project-name> --template <lang>');
        console.log('Examples:');
        console.log('  vcr create myapp --template python');
        console.log('  vcr create webapp --template node');
        process.exit(1);
      }
      
      if (!template) {
        console.error('Error: vcr create requires a template');
        console.log('Usage: vcr create <project-name> --template <lang>');
        console.log('Available templates: python, node, go, rust');
        process.exit(1);
      }
      
      createProject(projectName, template);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} 

main(); 