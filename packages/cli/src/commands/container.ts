import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

// Import functions from the main CLI file
import { 
  getComposeCacheDirectory, 
  detectProfileAndSshKey, 
  getPathHash 
} from '../cli';
import { showCommandHelp } from './help';

export function handleLogsCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('logs');
    return;
  }
  
  try {
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    if (existsSync(composePath)) {
      // Parse logs arguments
      const followMode = args.includes('-f') || args.includes('--follow');
      const systemMode = args.includes('--system');
      
      const { profile } = detectProfileAndSshKey();
      const pathHash = getPathHash();
      const containerName = `${pathHash}-vcr-isolated-service`;
      
      if (systemMode) {
        // System logs - show Docker container logs
        if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
          // Show logs of the vcr-isolated-service container for stage/prod
          const followFlag = followMode ? ' -f' : '';
          execSync(`docker logs${followFlag} ${containerName}`, { stdio: 'inherit' });
        } else {
          // Show Docker Compose logs for dev
          const followFlag = followMode ? ' -f' : '';
          execSync(`docker compose -f ${composePath} logs${followFlag}`, { stdio: 'inherit' });
        }
      } else {
        // Application logs
        if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
          // Use SSH to cat/tail /var/log/app.log for stage/prod profiles
          
          const logCommand = followMode ? 'tail -f /var/log/app.log' : 'cat /var/log/app.log';
          try {
            execSync(`docker exec ${containerName} ssh -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "${logCommand}"`, { stdio: 'inherit' });
          } catch (sshErr) {
            // SSH command execution errors should be treated as command errors
            if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
              process.exit(sshErr.status);
            }
            process.exit(1);
          }
        } else {
          // Show logs of just the app container for dev profile
          const followFlag = followMode ? ' -f' : '';
          execSync(`docker compose -f ${composePath} logs${followFlag} isolated_service`, { stdio: 'inherit' });
        }
      }
    } else {
      console.log('ℹ️  No docker-compose.dev.json found for current directory');
      console.log('Run "vcr up" first to start the development environment');
    }
  } catch (err) {
    console.error('Error viewing logs:', err);
    process.exit(1);
  }
}

export function handleExecCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('exec');
    return;
  }
  
  try {
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    if (existsSync(composePath)) {
      // Parse exec arguments
      const systemMode = args.includes('--system');
      
      // Get the command to execute (everything after 'exec', excluding --system)
      const execArgs = args.slice(1).filter(arg => arg !== '--system');
      if (execArgs.length === 0) {
        console.error('Error: vcr exec requires a command to execute');
        console.log('Example: vcr exec ls -la');
        console.log('Example: vcr exec --system ps aux');
        process.exit(1);
      }
      
      const command = execArgs.join(' ');
      const { profile } = detectProfileAndSshKey();
      const pathHash = getPathHash();
      const containerName = `${pathHash}-vcr-isolated-service`;
      
      if (systemMode) {
        // System mode - behave like the old behavior
        if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
          // Use SSH for stage/prod profiles (exec in VM)
          
          console.log(`Detected ${profile} profile (system mode) - executing command in VM...`);
          try {
            execSync(`docker exec ${containerName} ssh -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "${command}"`, { stdio: 'inherit' });
          } catch (sshErr) {
            // SSH command execution errors should be treated as command errors
            if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
              process.exit(sshErr.status);
            }
            process.exit(1);
          }
        } else {
          // Use Docker exec for dev profile (system mode)
          console.log('Detected dev profile (system mode) - executing command in container...');
          execSync(`docker compose -f ${composePath} exec isolated_service ${command}`, { stdio: 'inherit' });
        }
              } else {
          // Container mode
          if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
            // Use SSH + containerd to exec into the container
          
          console.log(`Detected ${profile} profile - executing command in container...`);
          try {
            execSync(`docker exec ${containerName} ssh -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "ctr -n services.linuxkit task exec --exec-id debug app ${command}"`, { stdio: 'inherit' });
          } catch (sshErr) {
            // SSH command execution errors should be treated as command errors
            if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
              process.exit(sshErr.status);
            }
            process.exit(1);
          }
        } else {
          // Use Docker exec for dev profile (already in container)
          console.log('Detected dev profile - executing command in container...');
          execSync(`docker compose -f ${composePath} exec isolated_service ${command}`, { stdio: 'inherit' });
        }
      }
    } else {
      console.log('ℹ️  No docker-compose.dev.json found for current directory');
      console.log('Run "vcr up" first to start the development environment');
    }
  } catch (err) {
    // Return the exit code from the failed command
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      process.exit(err.status);
    } else {
      console.error('Error executing command:', err);
      process.exit(1);
    }
  }
}

export function handleShellCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('shell');
    return;
  }
  
  try {
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    if (existsSync(composePath)) {
      // Parse shell arguments
      const systemMode = args.includes('--system');
      
      // Detect the profile by checking the container's image
      const { profile } = detectProfileAndSshKey();
      const pathHash = getPathHash();
      const containerName = `${pathHash}-vcr-isolated-service`;
      
      if (systemMode) {
        // System mode - behave like the old behavior
        if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
          // This is a stage or prod profile - exec into container then SSH
          console.log('Detected stage/prod profile (system mode) - connecting to RISC-V VM...');
          console.log('Type "exit" to return to your host shell');
          
          // First exec into the container, then SSH from there
          try {
            execSync(`docker exec -it ${containerName} ssh -t -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost`, { stdio: 'inherit' });
          } catch (sshErr) {
            // SSH connection closure is normal, don't treat as error
            if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
              // Exit with the same status code but don't print error
              process.exit(sshErr.status);
            }
            // For other errors, still exit gracefully
            process.exit(0);
          }
        } else {
          // This is a dev profile - use Docker exec
          console.log('Detected dev profile (system mode) - opening shell in container...');
          console.log('Type "exit" to return to your host shell');
          execSync(`docker compose -f ${composePath} exec isolated_service /bin/sh`, { stdio: 'inherit' });
        }
              } else {
          // Application mode
          if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
            // Use SSH to exec into the container via containerd
            console.log('Detected stage/prod profile - connecting to container...');
            console.log('Type "exit" to return to your host shell');
          
          try {
            execSync(`docker exec -it ${containerName} ssh -t -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "ctr -n services.linuxkit task exec --exec-id debug --tty app /bin/sh"`, { stdio: 'inherit' });
          } catch (sshErr) {
            // SSH command execution errors should be treated as command errors
            if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
              process.exit(sshErr.status);
            }
            process.exit(1);
          }
        } else {
          // This is a dev profile - use Docker exec (already enters container)
          console.log('Detected dev profile - opening shell in container...');
          console.log('Type "exit" to return to your host shell');
          execSync(`docker compose -f ${composePath} exec isolated_service /bin/sh`, { stdio: 'inherit' });
        }
      }
    } else {
      console.log('ℹ️  No docker-compose.dev.json found for current directory');
      console.log('Run "vcr up" first to start the development environment');
    }
  } catch (err) {
    console.error('Error opening shell:', err);
    process.exit(1);
  }
}

export function handleCatCommand(args: string[]): void {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showCommandHelp('cat');
    return;
  }
  
  try {
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    if (existsSync(composePath)) {
      // Get the file path argument
      const catArgs = args.slice(1);
      if (catArgs.length !== 1) {
        console.error('Error: vcr cat requires exactly 1 argument: <file-path>');
        console.log('Examples:');
        console.log('  vcr cat /app/config.json');
        console.log('  vcr cat /app/logs/app.log');
        console.log('  vcr cat /app/data/output.txt');
        process.exit(1);
      }
      
      const filePath = catArgs[0];
              
      const { profile } = detectProfileAndSshKey();
      const pathHash = getPathHash();
      const containerName = `${pathHash}-vcr-isolated-service`;
      
      if (profile === 'stage' || profile === 'stage-release' || profile === 'prod' || profile === 'prod-debug') {
        // Use SSH + containerd for stage/prod profiles
        
        console.log(`Detected ${profile} profile - viewing file in container...`);
        try {
          execSync(`docker exec ${containerName} ssh -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "ctr -n services.linuxkit task exec --exec-id debug app cat ${filePath}"`, { stdio: 'inherit' });
        } catch (sshErr) {
          // SSH command execution errors should be treated as command errors
          if (sshErr && typeof sshErr === 'object' && 'status' in sshErr && typeof sshErr.status === 'number') {
            process.exit(sshErr.status);
          }
          process.exit(1);
        }
      } else {
        // Use Docker exec for dev profile
        console.log('Detected dev profile - viewing file in container...');
        execSync(`docker compose -f ${composePath} exec isolated_service cat ${filePath}`, { stdio: 'inherit' });
      }
    } else {
      console.log('ℹ️  No docker-compose.dev.json found for current directory');
      console.log('Run "vcr up" first to start the development environment');
    }
  } catch (err) {
    // Return the exit code from the failed command
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      process.exit(err.status);
    } else {
      console.error('Error viewing file:', err);
      process.exit(1);
    }
  }
} 

export function handlePerfCommand(args: string[]): void {
  // Only allow for stage and prod-debug
  const { profile } = detectProfileAndSshKey();
  if (profile !== 'stage' && profile !== 'prod-debug') {
    console.error('vcr perf is only available for stage and prod-debug profiles.');
    process.exit(1);
  }

  // Help
  if (args.length < 2 || args[1] === '--help' || args[1] === '-h') {
    showCommandHelp('perf');
    return;
  }

  const subcommand = args[1];
  const extraArgs = args.slice(2);
  const perfBin = '/proc/1/root/usr/bin/perf-cm-riscv64';
  let perfArgs: string[] = [];

  if (subcommand === 'record') {
    perfArgs = ['record'];
    if (profile === 'prod-debug') {
      perfArgs.push('-e', 'cpu-clock', '-F', 'max');
    }
  } else if (subcommand === 'top') {
    perfArgs = ['top'];
    if (profile === 'prod-debug') {
      perfArgs.push('-e', 'cpu-clock', '-F', 'max');
    }
  } else if (subcommand === 'stat') {
    perfArgs = ['stat', ...extraArgs];
  } else if (subcommand === 'report') {
    perfArgs = ['report', ...extraArgs];
  } else {
    console.error('Unknown perf subcommand. Supported: record, top, stat, report');
    process.exit(1);
  }

  // Compose the command to run in the system container
  const fullCmd = [perfBin, ...perfArgs].join(' ');

  // Use TTY for record, top, and report
  const useTty = (subcommand === 'top' || subcommand === 'report' || subcommand === 'record');
  const dockerExec = useTty ? 'docker exec -it' : 'docker exec';
  const sshFlags = useTty ? '-t' : '';

  try {
    const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
    if (existsSync(composePath)) {
      const pathHash = getPathHash();
      const containerName = `${pathHash}-vcr-isolated-service`;
      try {
        execSync(`${dockerExec} ${containerName} ssh ${sshFlags} -o StrictHostKeyChecking=no -i /work/ssh.debug-key -p 8022 localhost "${fullCmd}"`, { stdio: 'inherit' });
      } catch (err) {
        if (subcommand === 'record') {
          // Ignore errors/exit code for perf record
          return;
        } else {
          console.error('Error running perf:', err);
          process.exit(1);
        }
      }
    } else {
      console.log('ℹ️  No docker-compose.dev.json found for current directory');
      console.log('Run "vcr up stage" or "vcr up prod-debug" first.');
    }
  } catch (err) {
    console.error('Error running perf:', err);
    process.exit(1);
  }
} 