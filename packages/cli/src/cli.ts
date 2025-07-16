#!/usr/bin/env node
import { execSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { handleBuildCommand, handleUpCommand } from './commands/build';
import { handleLogsCommand, handleExecCommand, handleShellCommand, handleCatCommand } from './commands/container';
import { pruneVcrLocal, pruneVcr } from './commands/prune';
import { handleCreateCommand } from './commands/create';
import { handleExportCommand } from './commands/export';
import { checkDockerAvailable } from './checks';

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

export function detectProfileAndSshKey(): { profile: 'dev' | 'stage' | 'stage-release' | 'prod' | 'prod-debug', sshKeyPath?: string } {
  const pathHash = getPathHash();
  const containerName = `${pathHash}-vcr-isolated-service`;
  
  try {
    const containerInfo = execSync(`docker inspect ${containerName} --format '{{.Config.Image}}'`, { encoding: 'utf8' }).trim();
    
    if (containerInfo === 'ghcr.io/zippiehq/vcr-snapshot-builder') {
      // This is a stage or prod profile - determine which one
      try {
        const containerCmd = execSync(`docker inspect ${containerName} --format '{{join .Config.Cmd " "}}'`, { encoding: 'utf8' }).trim();
        if (containerCmd.includes('cartesi-machine')) {
          // Check if it's prod or prod-debug by looking for debug tools
          // For now, assume prod (we could enhance this by checking for debug services)
          return { profile: 'prod', sshKeyPath: '/work/ssh.debug-key' };
        } else {
          // Check if it's stage or stage-release by looking for debug tools
          // For now, assume stage (we could enhance this by checking for debug services)
          return { profile: 'stage', sshKeyPath: '/work/ssh.debug-key' };
        }
      } catch (cmdErr) {
        // Fallback to stage if we can't determine
        return { profile: 'stage', sshKeyPath: '/work/ssh.debug-key' };
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
  vcr build <profile> [-t <name:tag>] [options]  Build container images
  vcr up <profile> [-t <name:tag>] [options]    Build and run environment with isolated networking
  vcr down                           Stop development environment
  vcr logs [-f|--follow] [--system]  View container or system logs
  vcr exec [--system] <command>      Execute command in container or system
  vcr shell [--system]               Open shell in container or system
  vcr cat <file-path>                View file contents in container
  vcr export <profile> <path>        Export profile artifacts to directory
  vcr prune [--local]                Clean up VCR environment (cache, registry, builder)
  vcr --help                         Show this help message

Create Options:
  --template <lang>                  Template language (e.g., python, node, go, rust)

Build Options:
  -t, --tag <name:tag>              Image name:tag (optional, defaults to vcr-build-<path-hash>:latest)
  --cache-dir <dir>                 Optional path to store exported build metadata
  --force-rebuild                   Force rebuild of cached artifacts (LinuxKit, Cartesi machine, etc.)
  --restart                         Force restart containers even if image tag matches (up command only)
  --depot                           Use depot build instead of docker buildx build
  --no-depot                        Force use docker buildx build even if depot.json is present

Profiles:
  dev               Native platform with debug tools (fastest development)
  stage             RISC-V environment with debug tools (QEMU-based)
  stage-release     RISC-V environment without debug tools (QEMU-based)
  prod              Verifiable RISC-V environment without debug tools (Cartesi Machine)
  prod-debug        Verifiable RISC-V environment with debug tools (Cartesi Machine)

Prune Options:
  --local                           Only clean current project's cache and stop its environment

Build Profiles:
  dev               Native platform with debug tools (fastest development)
  stage             RISC-V environment with debug tools (QEMU-based)
  stage-release     RISC-V environment without debug tools (QEMU-based)
  prod              Verifiable RISC-V environment without debug tools (Cartesi Machine)
  prod-debug        Verifiable RISC-V environment with debug tools (Cartesi Machine)

Examples:
  vcr create myapp --template python    # Create new Python project
  vcr create webapp --template node     # Create new Node.js project
  vcr create api --template go          # Create new Go project
  vcr create service --template rust    # Create new Rust project
  vcr build dev                      # Build for native platform with debug tools
  vcr build stage                    # Build for RISC-V with debug tools
  vcr build stage-release            # Build for RISC-V without debug tools
  vcr build prod                     # Build for verifiable RISC-V without debug tools
  vcr build prod-debug               # Build for verifiable RISC-V with debug tools
  vcr build dev -t web3link/myapp:1.2.3               # Build with custom tag
  vcr build prod --force-rebuild     # Force rebuild all artifacts
  vcr build stage --depot            # Use depot build instead of docker buildx
  vcr up dev                         # Build and run native environment
  vcr up stage                       # Build and run RISC-V with debug tools
  vcr up stage-release               # Build and run RISC-V without debug tools
  vcr up prod                        # Build and run verifiable RISC-V
  vcr up prod-debug                  # Build and run verifiable RISC-V with debug tools
  vcr up dev -t web3link/myapp:1.2.3                  # Build and run with custom tag
  vcr up prod --force-rebuild        # Force rebuild before running
  vcr up stage --depot               # Use depot build and run
  vcr up dev --restart               # Force restart containers
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
  vcr export prod ./my-deployment                      # Export prod profile artifacts
  vcr export stage-release ./stage-artifacts           # Export stage-release artifacts
  vcr export prod-debug ./debug-deployment             # Export prod-debug artifacts
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
  - If depot.json is present in the current directory, depot build is used automatically
  - Use --no-depot to force docker buildx build even when depot.json is present
  - Logs behavior varies by profile:
    * dev: vcr logs shows container logs, vcr logs --system shows all compose logs
    * stage/prod: vcr logs shows /var/log/app.log via SSH, vcr logs --system shows container logs
  - Shell behavior varies by profile:
    * dev: vcr shell opens container shell, vcr shell --system opens container shell
    * stage/prod: vcr shell opens container via containerd, vcr shell --system opens VM shell
  - Exec behavior varies by profile:
    * dev: vcr exec runs in container, vcr exec --system runs in container
    * stage/prod: vcr exec runs in container via containerd, vcr exec --system runs in VM
  - Cat behavior varies by profile:
    * dev: vcr cat uses Docker exec to view files in container
    * stage/prod: vcr cat uses SSH + containerd to view files in container

Prerequisites:
  - Docker and buildx installed
  - RISC-V binfmt emulation will be installed automatically if needed
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
      
    case 'export':
      handleExportCommand(args);
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
      handleCreateCommand(args);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} 

main(); 