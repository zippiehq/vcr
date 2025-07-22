#!/usr/bin/env node
import { execSync } from 'child_process';
import { cwd } from 'process';
import { join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { handleBuildCommand, handleUpCommand } from './commands/build';
import { handleLogsCommand, handleExecCommand, handleShellCommand, handleCatCommand, handlePerfCommand } from './commands/container';
import { pruneVcrLocal, pruneVcr } from './commands/prune';
import { handleCreateCommand } from './commands/create';
import { handleExportCommand } from './commands/export';
import { handleIntroCommand } from './commands/intro';
import { handlePushCommand } from './commands/push';
import { showCommandHelp } from './commands/help';
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
    // Get the profile label from the container
    const profileLabel = execSync(`docker inspect ${containerName} --format '{{ index .Config.Labels "vcr.profile" }}'`, { encoding: 'utf8' }).trim();
    if (profileLabel === 'stage' || profileLabel === 'stage-release' || profileLabel === 'prod' || profileLabel === 'prod-debug') {
      // Only debug profiles have SSH key
      const sshKeyPath = (profileLabel === 'stage' || profileLabel === 'prod-debug') ? '/work/ssh.debug-key' : undefined;
      return { profile: profileLabel as any, sshKeyPath };
    } else {
      return { profile: 'dev' };
    }
  } catch (err) {
    // Fallback to dev profile if we can't inspect the container
    return { profile: 'dev' };
  }
}

function showHelp() {
  console.log(`
🚀 vcr CLI - Verifiable Container Runner

📋 Commands:
  🆕 vcr intro                           Show introduction and quick start guide
  🏗️  vcr create <dir> --template <lang>  Create new project from template
  🔨 vcr build <profile> [options]       Build container images
  🚀 vcr up <profile> [options]          Build and run environment
  📤 vcr push <registry-path> [options]  Build and push prod (RISC-V) container to registry
  🛑 vcr down                            Stop development environment
  📄 vcr logs [options]                  View container or system logs
  ⚡ vcr exec [options] <command>        Execute command in container or system
  🐚 vcr shell [options]                 Open shell in container or system
  📖 vcr cat <file-path>                 View file contents in container
  📦 vcr export <profile> <path> [options]  Export profile artifacts to directory
  🧹 vcr prune [--local]                 Clean up VCR environment
  🎼 vcr perf <subcommand> [args]        Run Linux perf tool in stage/prod-debug

🎯 Profiles:
  🚀 dev          - Native platform, fastest development
  🧪 stage        - RISC-V QEMU with debug tools (⚡ ~2.3x faster than prod)
  🔒 stage-release- RISC-V QEMU without debug tools
  🔐 prod         - Verifiable RISC-V Cartesi Machine (🐢 ~2.3x slower than stage)
  🐛 prod-debug   - Verifiable RISC-V with debug tools

💡 Quick Start:
  vcr intro                              # Get started guide
  vcr create myapp --template python     # New Python project
  vcr up dev                             # Build and run (fastest)
  vcr up stage                           # Build and run (RISC-V testing)
  vcr up prod                            # Build and run (verifiable)

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
  
  if (args.length === 0) {
    showHelp();
    return;
  }
  
  // Check for help flags (only if first argument)
  if (args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case 'intro':
      handleIntroCommand(args);
      break;
      
    case 'build':
      handleBuildCommand(args);
      break;
      
    case 'up':
      handleUpCommand(args);
      break;
      
    case 'push':
      handlePushCommand(args);
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
      
    case 'perf':
      handlePerfCommand(args);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
} 

main(); 