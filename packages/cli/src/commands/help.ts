export function showCommandHelp(command: string): void {
  switch (command) {
    case 'build':
      showBuildHelp();
      break;
    case 'up':
      showUpHelp();
      break;
    case 'push':
      showPushHelp();
      break;
    case 'create':
      showCreateHelp();
      break;
    case 'export':
      showExportHelp();
      break;
    case 'logs':
      showLogsHelp();
      break;
    case 'exec':
      showExecHelp();
      break;
    case 'shell':
      showShellHelp();
      break;
    case 'cat':
      showCatHelp();
      break;
    case 'prune':
      showPruneHelp();
      break;
    case 'intro':
      showIntroHelp();
      break;
    case 'perf':
      showPerfHelp();
      break;
    default:
      console.log(`❓ Unknown command: ${command}`);
      console.log('Use "vcr --help" to see all available commands');
  }
}

function showBuildHelp(): void {
  console.log(`
🔨 vcr build - Build container images
====================================

Build container images for different profiles without running them.

📋 Usage:
  vcr build <profile> [options]

🎯 Profiles:
  🚀 dev          - Native platform, fastest development
  🧪 stage        - RISC-V QEMU with debug tools (⚡ ~2.3x faster than prod)
  🔒 stage-release- RISC-V QEMU without debug tools
  🔐 prod         - Verifiable RISC-V Cartesi Machine (🐢 ~2.3x slower than stage)
  🐛 prod-debug   - Verifiable RISC-V with debug tools

⚙️  Options:
  🏷️  -t, --tag <name:tag>                Custom image tag
  🖼️  --image <image>                     Use existing Docker image instead of building
  🔄 --force-rebuild                     Force rebuild all artifacts
  🏗️  --depot                             Use depot build instead of docker buildx
  🚫 --no-depot                           Disable depot build (use docker buildx)
  🚫 --no-tar-context                    Disable deterministic tar context
  🐳 --force-docker-tar                  Force using Docker for tar creation
  ⚡ --turbo                              Enable multi-core QEMU (stage profiles only)
  🤖 --guest-agent-image <image>         Custom guest agent image (prod/prod-debug only)
  🔥 --hot                               Enable hot reload (incompatible with --image)
  📁 --cache-dir <path>                  Custom cache directory

💡 Examples:
  vcr build dev                          # Build for fast development
  vcr build stage                        # Build for RISC-V testing
  vcr build prod                         # Build verifiable RISC-V image
  vcr build stage --image myapp:latest   # Use existing image
  vcr build prod --guest-agent-image my-registry/guest-agent:v2
  vcr build dev --hot                    # Build with hot reload support
  vcr build stage --turbo                # Build with multi-core QEMU
  vcr build prod --depot                 # Use depot for faster builds

🔧 Notes:
  • --image and --hot are incompatible
  • For stage/prod profiles, --image uses direct image reference in LinuxKit YAML
  • --turbo only affects stage profiles (multi-core QEMU)
  • --guest-agent-image only affects prod/prod-debug profiles
`);
}

function showUpHelp(): void {
  console.log(`
🚀 vcr up - Build and run environment
=====================================

Build container images and start the development environment.

📋 Usage:
  vcr up <profile> [options]

🎯 Profiles:
  🚀 dev          - Native platform, fastest development
  🧪 stage        - RISC-V QEMU with debug tools (⚡ ~2.3x faster than prod)
  🔒 stage-release- RISC-V QEMU without debug tools
  🔐 prod         - Verifiable RISC-V Cartesi Machine (🐢 ~2.3x slower than stage)
  🐛 prod-debug   - Verifiable RISC-V with debug tools

⚙️  Options:
  🏷️  -t, --tag <name:tag>                Custom image tag
  🖼️  --image <image>                     Use existing Docker image instead of building
  🔄 --force-rebuild                     Force rebuild all artifacts
  🔄 --restart                           Force restart environment
  🏗️  --depot                             Use depot build instead of docker buildx
  🚫 --no-depot                           Disable depot build (use docker buildx)
  🚫 --no-tar-context                    Disable deterministic tar context
  🐳 --force-docker-tar                  Force using Docker for tar creation
  ⚡ --turbo                              Enable multi-core QEMU (stage profiles only)
  🤖 --guest-agent-image <image>         Custom guest agent image (prod/prod-debug only)
  🔥 --hot                               Enable hot reload (incompatible with --image)
  📁 --cache-dir <path>                  Custom cache directory

💡 Examples:
  vcr up dev                             # Build and run (fastest)
  vcr up stage                           # Build and run (RISC-V testing)
  vcr up prod                            # Build and run (verifiable)
  vcr up stage --image myapp:latest      # Use existing image
  vcr up prod --guest-agent-image my-registry/guest-agent:v2
  vcr up dev --hot                       # Hot reload (file watching)
  vcr up stage --hot                     # Hot reload (rebuild on changes)
  vcr up stage --turbo                   # Multi-core QEMU for faster emulation
  vcr up dev --restart                   # Force restart environment

🔧 Notes:
  • --image and --hot are incompatible
  • For stage/prod profiles, --image uses direct image reference in LinuxKit YAML
  • --turbo only affects stage profiles (multi-core QEMU)
  • --guest-agent-image only affects prod/prod-debug profiles
  • Hot reload behavior varies by profile (file watching vs rebuild)
`);
}

function showPushHelp(): void {
  console.log(`
📤 vcr push - Build and push to registry
========================================

Build a production (RISC-V) container and push it to a registry.

📋 Usage:
  vcr push <registry-path> [options]

⚙️  Options:
  📁 --cache-dir <path>                  Custom cache directory
  🔄 --force-rebuild                     Force rebuild all artifacts
  🏗️  --depot                             Use depot build instead of docker buildx
  🚫 --no-depot                           Disable depot build (use docker buildx)
  🐳 --force-docker-tar                  Force using Docker for tar creation
  📦 --source                             Only push source context, don't build
  🔗 --git                                Only push to git remote, don't build

💡 Examples:
  vcr push my-registry.com/myapp:latest
  vcr push ghcr.io/myuser/myapp:v1.0.0
  vcr push docker.io/myuser/myapp:latest
  vcr push my-registry.com/myapp:latest --depot
  vcr push my-registry.com/myapp:latest --force-rebuild

🔧 Notes:
  • Always builds for RISC-V 64-bit architecture
  • Uses deterministic builds for reproducibility
  • Supports custom registry mappings
  • --source and --git are mutually exclusive
`);
}

function showCreateHelp(): void {
  console.log(`
🏗️  vcr create - Create new project
====================================

Create a new project from a template.

📋 Usage:
  vcr create <project-name> --template <language>

🎯 Templates:
  🐍 python     - Python application
  🟨 node       - Node.js application
  🦀 rust       - Rust application
  🐹 go         - Go application

💡 Examples:
  vcr create myapp --template python
  vcr create webapp --template node
  vcr create cli-tool --template rust
  vcr create api-server --template go

🔧 Notes:
  • Creates a new directory with the project name
  • Includes Dockerfile and basic application structure
  • Ready to run with "vcr up" immediately
`);
}

function showExportHelp(): void {
  console.log(`
📦 vcr export - Export profile artifacts
========================================

Export build artifacts for a specific profile to a directory.

📋 Usage:
  vcr export <profile> <path> [options]

🎯 Profiles:
  🚀 dev          - Native platform artifacts
  🧪 stage        - RISC-V QEMU artifacts
  🔒 stage-release- RISC-V QEMU artifacts (no debug)
  🔐 prod         - Verifiable RISC-V artifacts
  🐛 prod-debug   - Verifiable RISC-V artifacts (with debug)

⚙️  Options:
  🤖 --guest-agent-image <image>         Custom guest agent image (prod/prod-debug only)
  📁 --cache-dir <path>                  Custom cache directory
  🔄 --force-rebuild                     Force rebuild all artifacts

💡 Examples:
  vcr export prod ./deployment
  vcr export stage ./test-artifacts
  vcr export prod ./deployment --guest-agent-image my-registry/guest-agent:v2
  vcr export prod ./deployment --force-rebuild

🔧 Notes:
  • Exports all artifacts needed for deployment
  • For prod profiles, includes Cartesi machine snapshots
  • --guest-agent-image only affects prod/prod-debug profiles
`);
}

function showLogsHelp(): void {
  console.log(`
📄 vcr logs - View container logs
=================================

View logs from containers or system components.

📋 Usage:
  vcr logs [options]

⚙️  Options:
  💻 --system                            Target system instead of container
  📺 -f, --follow                        Follow logs in real-time
  📊 --tail <lines>                      Show last N lines (default: 100)

💡 Examples:
  vcr logs                               # View application logs
  vcr logs --follow                      # Follow logs in real-time
  vcr logs --system                      # View system logs
  vcr logs --system --follow             # Follow system logs
  vcr logs --tail 50                     # Show last 50 lines

🔧 Notes:
  • Default shows application container logs
  • --system shows VCR system component logs
  • --follow continues showing new log entries
`);
}

function showExecHelp(): void {
  console.log(`
⚡ vcr exec - Execute command in container
==========================================

Execute a command in the running container or system.

📋 Usage:
  vcr exec [options] <command>

⚙️  Options:
  💻 --system                            Target system instead of container

💡 Examples:
  vcr exec "ls -la"                      # List files in container
  vcr exec "ps aux"                      # Show processes in container
  vcr exec --system "ls -la"             # List files in system
  vcr exec "cat /etc/os-release"         # Show OS info in container

🔧 Notes:
  • Default executes in application container
  • --system executes in VCR system environment
  • Command must be quoted if it contains spaces
`);
}

function showShellHelp(): void {
  console.log(`
🐚 vcr shell - Open interactive shell
=====================================

Open an interactive shell in the container or system.

📋 Usage:
  vcr shell [options]

⚙️  Options:
  💻 --system                            Target system instead of container

💡 Examples:
  vcr shell                              # Open shell in container
  vcr shell --system                     # Open shell in system

🔧 Notes:
  • Default opens shell in application container
  • --system opens shell in VCR system environment
  • Interactive shell for debugging and exploration
`);
}

function showCatHelp(): void {
  console.log(`
📖 vcr cat - View file contents
===============================

View the contents of a file in the container or system.

📋 Usage:
  vcr cat <file-path> [options]

⚙️  Options:
  💻 --system                            Target system instead of container

💡 Examples:
  vcr cat /etc/os-release                # View OS info in container
  vcr cat /app/main.py                   # View application file
  vcr cat --system /etc/hosts            # View system hosts file

🔧 Notes:
  • Default reads from application container
  • --system reads from VCR system environment
  • Useful for debugging and file inspection
`);
}

function showPruneHelp(): void {
  console.log(`
🧹 vcr prune - Clean up VCR environment
=======================================

Clean up VCR containers, images, and cache data.

📋 Usage:
  vcr prune [options]

⚙️  Options:
  🏠 --local                             Only clean up local project data

💡 Examples:
  vcr prune                              # Clean up all VCR data
  vcr prune --local                      # Clean up only current project

🔧 Notes:
  • --local only removes data for current project
  • Without --local, removes all VCR data globally
  • Removes containers, images, and cache directories
  • Use with caution as this cannot be undone
`);
}

function showIntroHelp(): void {
  console.log(`
🆕 vcr intro - Introduction and quick start
===========================================

Show introduction and quick start guide for VCR.

📋 Usage:
  vcr intro

💡 What you'll learn:
  • What VCR is and how it works
  • Quick start workflow
  • Profile guide and when to use each
  • Common commands and examples
  • Pro tips for effective development

🔧 Notes:
  • Perfect for new users
  • Shows complete workflow from creation to deployment
  • Includes examples for all major use cases
`);
}

function showPerfHelp(): void {
  console.log(`
🎼 vcr perf - Run Linux perf tool in stage/prod-debug
====================================================

Run the Linux perf tool inside the system VM for performance analysis.

📋 Usage:
  vcr perf <subcommand> [args]

🔧 Supported subcommands:
  record    - Start a perf recording
  top       - Show live profiling
  stat      - Show performance statistics (extra args supported)

🎯 Profiles:
  🧪 stage        - Uses QEMU, runs: /proc/1/root/usr/bin/perf-cm-riscv64 <subcommand> [args]
  🐛 prod-debug   - Uses Cartesi Machine, runs: /proc/1/root/usr/bin/perf-cm-riscv64 <subcommand> [args]

⚙️  Behavior:
  • record:   stage → 'record', prod-debug → 'record -e cpu-clock -F max'
  • top:      stage → 'top',    prod-debug → 'top -e cpu-clock -F max'
  • stat:     Both → 'stat' (plus any extra args)

💡 Examples:
  vcr perf record
  vcr perf top
  vcr perf stat -e cycles -r 5

🔒 Only available for stage and prod-debug profiles.
`);
} 