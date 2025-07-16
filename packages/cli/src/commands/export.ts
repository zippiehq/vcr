import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { getComposeCacheDirectory, detectProfileAndSshKey, getPathHash } from '../cli';

export function handleExportCommand(args: string[]): void {
  try {
    // Parse export arguments
    if (args.length < 3) {
      console.error('Error: vcr export requires exactly 2 arguments: <profile> <path>');
      console.log('Usage: vcr export <profile> <path>');
      console.log('Examples:');
      console.log('  vcr export prod ./my-prod-deployment');
      console.log('  vcr export stage-release ./stage-artifacts');
      console.log('  vcr export prod-debug ./debug-deployment');
      process.exit(1);
    }

    const profile = args[1];
    const exportPath = resolve(args[2]);

    // Validate profile
    const validProfiles = ['stage', 'stage-release', 'prod', 'prod-debug'];
    if (!validProfiles.includes(profile)) {
      console.error(`Error: Invalid profile '${profile}'. Valid profiles: ${validProfiles.join(', ')}`);
      process.exit(1);
    }

    console.log(`📦 Exporting ${profile} profile to: ${exportPath}`);

    // Create export directory
    if (!existsSync(exportPath)) {
      mkdirSync(exportPath, { recursive: true });
      console.log(`✅ Created export directory: ${exportPath}`);
    }

    // Get cache directory
    const pathHash = getPathHash();
    const cacheDir = getComposeCacheDirectory();
    
    // Determine debug suffix for file names
    const includeDebugTools = profile === 'stage' || profile === 'prod-debug';
    const debugSuffix = includeDebugTools ? '-debug' : '-release';

    // Export files based on profile
    const exportedFiles: string[] = [];

    if (profile === 'stage' || profile === 'stage-release') {
      // Export QEMU-based profile files
      const qemuKernel = join(cacheDir, `vc${debugSuffix}.qemu-kernel`);
      const squashfs = join(cacheDir, `vc${debugSuffix}.squashfs`);

      if (!existsSync(qemuKernel)) {
        console.error(`❌ Error: QEMU kernel not found: ${qemuKernel}`);
        console.error('Run "vcr build ' + profile + '" first to create the required files.');
        process.exit(1);
      }

      if (!existsSync(squashfs)) {
        console.error(`❌ Error: Squashfs not found: ${squashfs}`);
        console.error('Run "vcr build ' + profile + '" first to create the required files.');
        process.exit(1);
      }

      // Copy QEMU kernel
      const exportedKernel = join(exportPath, 'vc.qemu-kernel');
      copyFileSync(qemuKernel, exportedKernel);
      exportedFiles.push('vc.qemu-kernel');

      // Copy squashfs
      const exportedSquashfs = join(exportPath, 'vc.squashfs');
      copyFileSync(squashfs, exportedSquashfs);
      exportedFiles.push('vc.squashfs');

    } else if (profile === 'prod' || profile === 'prod-debug') {
      // Export Cartesi Machine profile files
      const cmSquashfs = join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs`);
      const rootHashFile = join(cacheDir, `vc-cm-snapshot${debugSuffix}.squashfs.root-hash`);
      const cmSnapshotPath = join(cacheDir, `vc-cm-snapshot${debugSuffix}`);
      const cmHashFile = join(cmSnapshotPath, 'hash');

      if (!existsSync(cmSquashfs)) {
        console.error(`❌ Error: Cartesi machine squashfs not found: ${cmSquashfs}`);
        console.error('Run "vcr build ' + profile + '" first to create the required files.');
        process.exit(1);
      }

      if (!existsSync(rootHashFile)) {
        console.error(`❌ Error: Root hash file not found: ${rootHashFile}`);
        console.error('Run "vcr build ' + profile + '" first to create the required files.');
        process.exit(1);
      }

      if (!existsSync(cmHashFile)) {
        console.error(`❌ Error: Cartesi machine hash file not found: ${cmHashFile}`);
        console.error('Run "vcr build ' + profile + '" first to create the required files.');
        process.exit(1);
      }

      // Copy Cartesi machine squashfs
      const exportedCmSquashfs = join(exportPath, 'vc-cm-snapshot.squashfs');
      copyFileSync(cmSquashfs, exportedCmSquashfs);
      exportedFiles.push('vc-cm-snapshot.squashfs');



      // Copy root hash file
      const exportedRootHash = join(exportPath, 'vc-cm-snapshot.squashfs.root-hash');
      copyFileSync(rootHashFile, exportedRootHash);
      exportedFiles.push('vc-cm-snapshot.squashfs.root-hash');

      // Copy Cartesi machine hash file
      const exportedCmHash = join(exportPath, 'vc-cm-snapshot.hash');
      copyFileSync(cmHashFile, exportedCmHash);
      exportedFiles.push('vc-cm-snapshot.hash');
    }

    // Export debug SSH key if profile has debug tools
    if (includeDebugTools) {
      const sshKeyPath = join(cacheDir, 'ssh.debug-key');
      const sshKeyPubPath = join(cacheDir, 'ssh.debug-key.pub');

      if (existsSync(sshKeyPath)) {
        const exportedSshKey = join(exportPath, 'ssh.debug-key');
        copyFileSync(sshKeyPath, exportedSshKey);
        require('fs').chmodSync(exportedSshKey, 0o600);
        exportedFiles.push('ssh.debug-key');
      }

      if (existsSync(sshKeyPubPath)) {
        const exportedSshKeyPub = join(exportPath, 'ssh.debug-key.pub');
        copyFileSync(sshKeyPubPath, exportedSshKeyPub);
        exportedFiles.push('ssh.debug-key.pub');
      }
    }

    console.log(`✅ Successfully exported ${profile} profile to: ${exportPath}`);
    console.log(`📁 Exported files:`);
    exportedFiles.forEach(file => console.log(`   - ${file}`));
    console.log('');
  } catch (err) {
    console.error('Error exporting profile:', err);
    process.exit(1);
  }
}

function getFileDescription(filename: string, profile: string): string {
  switch (filename) {
    case 'ssh.debug-key':
      return 'SSH private key for debug access';
    case 'ssh.debug-key.pub':
      return 'SSH public key';
    case 'vc.qemu-kernel':
      return 'QEMU kernel image';
    case 'vc.squashfs':
      return 'Root filesystem image';
    case 'vc-cm-snapshot.squashfs':
      return 'Cartesi machine snapshot';
    case 'vc-cm-snapshot.squashfs.root-hash':
      return 'Root hash for verity verification';
    case 'vc-cm-snapshot.hash':
      return 'Cartesi machine deterministic hash';
    default:
      return 'Profile-specific file';
  }
} 