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
import { handleIntroCommand } from './commands/intro';
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
🚀 vcr CLI - Verifiable Container Runner

📋 Usage:
  🆕 vcr intro                           Show introduction and quick start guide
  🏗️  vcr create <dir> --template <lang>  Create new project from template
  🔨 vcr build <profile> [options]       Build container images
  🚀 vcr up <profile> [options]          Build and run environment
  🛑 vcr down                            Stop development environment
  📄 vcr logs [options]                  View container or system logs
  ⚡ vcr exec [options] <command>        Execute command in container or system
  🐚 vcr shell [options]                 Open shell in container or system
  📖 vcr cat <file-path>                 View file contents in container
  📦 vcr export <profile> <path> [options]  Export profile artifacts to directory
  🧹 vcr prune [--local]                 Clean up VCR environment
  ❓ vcr --help                          Show this help message

🎯 Profiles:
  🚀 dev          - Native platform, fastest development
  🧪 stage        - RISC-V QEMU with debug tools
  🔒 stage-release- RISC-V QEMU without debug tools
  🔐 prod         - Verifiable RISC-V Cartesi Machine
  🐛 prod-debug   - Verifiable RISC-V with debug tools

⚙️  Common Options:
  🏷️  -t, --tag <name:tag>                Custom image tag
  🔄 --force-rebuild                     Force rebuild all artifacts
  🏗️  --depot                             Use depot build instead of docker buildx
  🚫 --no-tar-context                    Disable deterministic tar context
  🐳 --force-docker-tar                  Force using Docker for tar creation
  ⚡ --turbo                              Enable multi-core QEMU (stage profiles only)
  🤖 --guest-agent-image <image>         Custom guest agent image (prod/prod-debug only)
  🔥 --hot                               Enable hot reload (in-container file watching if supported, otherwise rebuild on changes)
  💻 --system                            Target system instead of container
  📺 -f, --follow                        Follow logs in real-time

💡 Examples:
  🆕 vcr intro                           # Get started guide
  🏗️  vcr create myapp --template python  # New Python project
  🚀 vcr up dev                          # Build and run (fastest)
  🧪 vcr up stage                        # Build and run (RISC-V testing)
  🔐 vcr up prod                         # Build and run (verifiable)
  🔐 vcr up prod --guest-agent-image my-registry/guest-agent:v2  # Custom guest agent
  🔥 vcr up dev --hot                    # Hot reload (file watching)
  🔥 vcr up stage --hot                  # Hot reload (rebuild on changes)
  🔥 vcr up prod --hot                   # Hot reload (rebuild on changes)
  📦 vcr export prod ./deployment --guest-agent-image my-registry/guest-agent:v2  # Export with custom guest agent
  📄 vcr logs                            # View application logs
  ⚡ vcr exec "ls -la"                   # Run command in container
  🛑 vcr down                            # Stop environment

📚 For detailed help: vcr <command> --help
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
    case 'intro':
      handleIntroCommand();
      break;
      
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