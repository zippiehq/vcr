import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export function createProject(targetDir: string, template: string) {
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

export function handleCreateCommand(args: string[]): void {
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
} 