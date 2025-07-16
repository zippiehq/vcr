import { execSync } from 'child_process';
import { join, relative, resolve } from 'path';
import { existsSync, readFileSync, statSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { createHash } from 'crypto';
import { cwd } from 'process';
import { tmpdir } from 'os';

interface TarContextOptions {
  contextPath?: string;
  dockerignorePath?: string;
  outputPath?: string;
  deterministic?: boolean;
  forceDocker?: boolean;
}

export class TarContextBuilder {
  private contextPath: string;
  private dockerignorePath: string;
  private outputPath: string;
  private deterministic: boolean;
  private forceDocker: boolean;
  private tempFilePath?: string;

  constructor(options: TarContextOptions = {}) {
    this.contextPath = options.contextPath || cwd();
    this.dockerignorePath = options.dockerignorePath || join(this.contextPath, '.dockerignore');
    this.outputPath = options.outputPath || join(this.contextPath, '.vcr-context.tar');
    this.deterministic = options.deterministic !== false; // Default to true
    this.forceDocker = options.forceDocker || false;
  }

  /**
   * Parse .dockerignore file and return list of patterns
   * Handles both .dockerignore and .gitignore format patterns
   */
  private parseDockerignore(): string[] {
    if (!existsSync(this.dockerignorePath)) {
      return [];
    }

    const content = readFileSync(this.dockerignorePath, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .map(pattern => {
        // Handle .dockerignore specific patterns
        if (pattern.startsWith('!')) {
          return pattern; // Keep negation patterns as-is
        }
        
        // Convert .gitignore patterns to .dockerignore format
        if (pattern.includes('**')) {
          return pattern; // Keep globstar patterns as-is
        }
        
        // Handle trailing slash for directories
        if (pattern.endsWith('/')) {
          return pattern;
        }
        
        return pattern;
      });
  }

  /**
   * Check if a file should be excluded based on .dockerignore patterns
   */
  private shouldExclude(filePath: string, patterns: string[]): boolean {
    const relativePath = relative(this.contextPath, filePath);
    
    for (const pattern of patterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return !pattern.startsWith('!'); // Negation patterns start with !
      }
    }
    
    return false;
  }

  /**
   * Check if a file path matches a .dockerignore pattern
   * Implements a subset of .dockerignore pattern matching
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Handle negation patterns
    const isNegation = pattern.startsWith('!');
    const actualPattern = isNegation ? pattern.slice(1) : pattern;
    
    // Normalize paths for comparison
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = actualPattern.replace(/\\/g, '/');
    
    // Exact match
    if (normalizedPattern === normalizedPath) {
      return true;
    }
    
    // Handle directory patterns (trailing slash)
    if (normalizedPattern.endsWith('/')) {
      const dirPattern = normalizedPattern.slice(0, -1);
      return normalizedPath.startsWith(dirPattern + '/') || normalizedPath === dirPattern;
    }
    
    // Handle patterns starting with /
    if (normalizedPattern.startsWith('/')) {
      return normalizedPath === normalizedPattern.slice(1);
    }
    
    // Handle patterns ending with /
    if (normalizedPattern.endsWith('/')) {
      const dirPattern = normalizedPattern.slice(0, -1);
      return normalizedPath.startsWith(dirPattern + '/') || normalizedPath === dirPattern;
    }
    
    // Handle globstar patterns (**)
    if (normalizedPattern.includes('**')) {
      const parts = normalizedPattern.split('**');
      if (parts.length === 2) {
        const prefix = parts[0];
        const suffix = parts[1];
        
        // **/pattern - match at any depth
        if (prefix === '') {
          return normalizedPath.endsWith(suffix);
        }
        
        // pattern/** - match from start
        if (suffix === '') {
          return normalizedPath.startsWith(prefix);
        }
        
        // prefix/**/suffix - match anywhere
        return normalizedPath.startsWith(prefix) && normalizedPath.endsWith(suffix);
      }
    }
    
    // Handle single wildcard patterns (*)
    if (normalizedPattern.includes('*') && !normalizedPattern.includes('**')) {
      // Convert glob pattern to regex
      const regexPattern = normalizedPattern
        .replace(/\./g, '\\.')  // Escape dots
        .replace(/\*/g, '[^/]*'); // * matches anything except /
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedPath);
    }
    
    // Handle patterns without wildcards - check if path ends with pattern
    if (!normalizedPattern.includes('*')) {
      return normalizedPath.endsWith('/' + normalizedPattern) || normalizedPath === normalizedPattern;
    }
    
    return false;
  }

  /**
   * Get all files in the context directory, respecting .dockerignore
   */
  private getContextFiles(): string[] {
    const patterns = this.parseDockerignore();
    const files: string[] = [];
    
    const walkDir = (dir: string): void => {
      try {
        const items = readdirSync(dir);
        
        for (const item of items) {
          const fullPath = join(dir, item);
          const relativePath = relative(this.contextPath, fullPath);
          
          // Skip if excluded by .dockerignore
          if (this.shouldExclude(fullPath, patterns)) {
            continue;
          }
          
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (stat.isFile()) {
            files.push(relativePath);
          }
        }
      } catch (err) {
        // Skip directories we can't read
        console.warn(`Warning: Could not read directory ${dir}: ${err}`);
      }
    };
    
    walkDir(this.contextPath);
    return files.sort(); // Sort for deterministic order
  }

  /**
   * Check if local tar supports deterministic options
   */
  private checkTarCapabilities(): { supportsSort: boolean; supportsMtime: boolean; supportsGnuFormat: boolean } {
    const capabilities = {
      supportsSort: false,
      supportsMtime: false,
      supportsGnuFormat: false
    };
    
    try {
      // Check for --sort option
      execSync('tar --help | grep -q "sort"', { stdio: 'ignore' });
      capabilities.supportsSort = true;
    } catch (err) {
      // sort not supported
    }
    
    try {
      // Check for --mtime option
      execSync('tar --help | grep -q "mtime"', { stdio: 'ignore' });
      capabilities.supportsMtime = true;
    } catch (err) {
      // mtime not supported
    }
    
    try {
      // Check for --format option
      execSync('tar --help | grep -q "format"', { stdio: 'ignore' });
      capabilities.supportsGnuFormat = true;
    } catch (err) {
      // format not supported
    }
    
    return capabilities;
  }

  /**
   * Create tar using local tar command
   */
  private createTarLocal(files: string[], tempDir: string): void {
    const capabilities = this.checkTarCapabilities();
    
    // Create tar command with deterministic options
    const tarArgs = [
      '--create',
      '--file', this.outputPath,
      '--numeric-owner', // Use numeric IDs
      '--files-from', this.tempFilePath,
    ];
    
    // Add deterministic options if supported
    if (capabilities.supportsGnuFormat) {
      tarArgs.push('--format', 'gnu');
    }
    
    if (capabilities.supportsSort) {
      tarArgs.push('--sort=name');
    }
    
    if (this.deterministic && capabilities.supportsMtime) {
      tarArgs.push('--mtime', '1752444000');
    }
    
    const tarCommand = `tar ${tarArgs.join(' ')}`;
    
    console.log(`Executing local tar: ${tarCommand}`);
    execSync(tarCommand, { 
      stdio: 'inherit', 
      cwd: this.contextPath,
      env: { ...process.env, TZ: 'UTC' }
    });
  }

  /**
   * Create tar using Docker snapshot builder
   */
  private createTarDocker(files: string[], tempDir: string): void {
    console.log('🐳 Using VCR snapshot builder for deterministic tar creation...');
    
    // Create a temporary directory for Docker volume mount
    const dockerTempDir = mkdtempSync(join(tmpdir(), 'vcr-docker-'));
    const dockerFileList = join(dockerTempDir, 'filelist.txt');
    const dockerOutput = join(dockerTempDir, 'output.tar');
    
    // Write file list for Docker
    writeFileSync(dockerFileList, files.join('\n'));
    
    // Create tar command with full deterministic options
    const tarArgs = [
      '--create',
      '--file', '/tmp/output.tar',
      '--format', 'gnu',
      '--numeric-owner',
      '--sort=name',
      '--mtime', '1752444000',
      '--files-from', '/tmp/filelist.txt',
    ];
    
    const dockerCommand = [
      'docker', 'run', '--rm',
      '-v', `${this.contextPath}:/context:ro`,
      '-v', `${dockerTempDir}:/tmp`,
      '-w', '/context',
      'ghcr.io/zippiehq/vcr-snapshot-builder',
      'tar', ...tarArgs
    ].join(' ');
    
    console.log(`Executing Docker tar: ${dockerCommand}`);
    execSync(dockerCommand, { stdio: 'inherit' });
    
    // Copy the result to our output location
    execSync(`cp "${dockerOutput}" "${this.outputPath}"`, { stdio: 'inherit' });
    
    // Clean up Docker temp directory
    execSync(`rm -rf "${dockerTempDir}"`, { stdio: 'ignore' });
  }

  /**
   * Create a deterministic tar file from the build context using a file list
   */
  public createTar(): string {
    console.log('📦 Creating deterministic build context...');
    
    const files = this.getContextFiles();
    console.log(`Found ${files.length} files to include in build context`);
    
    if (files.length === 0) {
      throw new Error('No files found in build context');
    }
    
    // Write file list to a temporary file
    const tempDir = mkdtempSync(join(tmpdir(), 'vcr-tar-'));
    this.tempFilePath = join(tempDir, 'filelist.txt');
    writeFileSync(this.tempFilePath, files.join('\n'));
    
    try {
      // Check if local tar supports deterministic options
      const capabilities = this.checkTarCapabilities();
      
      if (this.forceDocker) {
        console.log('🐳 Force using VCR snapshot builder for tar creation');
        this.createTarDocker(files, tempDir);
      } else if (capabilities.supportsSort && capabilities.supportsMtime && capabilities.supportsGnuFormat) {
        console.log('✅ Local tar supports all deterministic options');
        this.createTarLocal(files, tempDir);
      } else {
        console.log('⚠️  Local tar missing deterministic options, using VCR snapshot builder');
        this.createTarDocker(files, tempDir);
      }
      
      if (!existsSync(this.outputPath)) {
        throw new Error('Tar file was not created');
      }
      
      const tarSize = statSync(this.outputPath).size;
      console.log(`✅ Created deterministic tar: ${this.outputPath} (${tarSize} bytes)`);
      
      return this.outputPath;
    } catch (err) {
      console.error('Error creating tar file:', err);
      throw err;
    }
  }

  /**
   * Get the hash of the build context for caching
   */
  public getContextHash(): string {
    const files = this.getContextFiles();
    const hash = createHash('sha256');
    
    // Include file paths and modification times for hash
    for (const file of files) {
      const fullPath = join(this.contextPath, file);
      const stat = statSync(fullPath);
      hash.update(file);
      hash.update(stat.mtime.getTime().toString());
      hash.update(stat.size.toString());
    }
    
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Clean up the tar file and temp file list
   */
  public cleanup(): void {
    if (existsSync(this.outputPath)) {
      try {
        execSync(`rm -f "${this.outputPath}"`, { stdio: 'ignore' });
        console.log(`🧹 Cleaned up: ${this.outputPath}`);
      } catch (err) {
        console.warn(`Warning: Could not clean up ${this.outputPath}: ${err}`);
      }
    }
    if (this.tempFilePath && existsSync(this.tempFilePath)) {
      try {
        unlinkSync(this.tempFilePath);
        // Also remove the temp dir
        const tempDir = this.tempFilePath.substring(0, this.tempFilePath.lastIndexOf('/'));
        execSync(`rm -rf "${tempDir}"`, { stdio: 'ignore' });
      } catch (err) {
        console.warn(`Warning: Could not clean up temp file list: ${err}`);
      }
    }
  }
}

/**
 * Convenience function to create a deterministic tar context
 */
export function createDeterministicTarContext(
  contextPath?: string,
  outputPath?: string
): string {
  const builder = new TarContextBuilder({
    contextPath,
    outputPath,
    deterministic: true
  });
  
  try {
    return builder.createTar();
  } finally {
    // Clean up after a delay to allow build to use the file
    setTimeout(() => builder.cleanup(), 5000);
  }
} 