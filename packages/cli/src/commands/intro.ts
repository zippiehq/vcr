import { execSync } from 'child_process';

export function handleIntroCommand(): void {
  console.log(`
🚀 VCR - Verifiable Container Runner
====================================

VCR helps you build and run verifiable, deterministic containers with RISC-V support.

📋 Quick Start Workflow
=======================

1. Create a new project:
   vcr create myapp --template python

2. Build and run (choose your profile):
   vcr up dev          # Fast development (native platform)
   vcr up stage        # RISC-V testing with debug tools
   vcr up prod         # Verifiable RISC-V (Cartesi Machine)

3. Interact with your app:
   vcr logs            # View application logs
   vcr exec "ls -la"   # Run commands in container
   vcr shell           # Open interactive shell

4. Stop when done:
   vcr down

🎯 Profile Guide
================

dev          - Native platform, fastest development
stage        - RISC-V QEMU with debug tools (SSH access)
stage-release- RISC-V QEMU without debug tools
prod         - Verifiable RISC-V Cartesi Machine
prod-debug   - Verifiable RISC-V with debug tools

💡 Pro Tips
===========

• Start with 'dev' for fast iteration
• Use 'stage' to test RISC-V compatibility  
• Use 'prod' for verifiable, attested builds
• SSH keys are auto-generated for debug profiles
• All builds (based on same built Docker image) are deterministic and reproducible

🔧 Common Commands
==================

vcr create <name> --template <lang>  # New project
vcr up <profile>                     # Build and run
vcr down                             # Stop environment
vcr logs                             # View logs
vcr exec <command>                   # Run command
vcr export <profile> <path>          # Export artifacts

📚 Need More Help?
==================

vcr --help                           # Full command reference
vcr <command> --help                 # Command-specific help

Happy building! 🐳
`);
} 