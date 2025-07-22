# Quick Start Guide

Get up and running with VCR in minutes! This guide walks you through the complete development workflow.

---

## :zap: Prerequisites

- Docker installed and running
- Node.js 18+ (for the CLI)
- Git

---

## :rocket: Installation

```bash
npm install -g @zippie/vcr
```

---

## :bulb: Your First Project

### 1. Create a New Project

```bash
# Create a Python project
vcr create myapp --template python
cd myapp

# Or create a Node.js project
vcr create myapp --template nodejs
cd myapp
```


---

## :computer: Development Workflow

### Step 1: Fast Local Development (`dev`)

Start with the fastest feedback loop:

```bash
# Build and run on your native platform
vcr up dev

# Your app is now running at http://localhost:8080
# Make changes to app.py - they'll hot reload automatically!
```

**What's happening:**
- Native platform (x86_64/ARM64)
- Hot reload enabled
- Fastest build and startup
- Perfect for rapid iteration

### Step 2: RISC-V Testing (`stage`)

Test in an environment closer to production:

```bash
# Stop dev environment
vcr down

# Build and run in RISC-V QEMU
vcr up stage

# Your app is now running in RISC-V at http://localhost:8080
# SSH access available for debugging
```

**What's happening:**
- RISC-V architecture via QEMU
- Debug tools available
- SSH access for troubleshooting
- ~2.3x slower than dev, but closer to prod

### Step 3: Production Build (`prod`)

Create a verifiable, deterministic build:

```bash
# Stop stage environment
vcr down

# Build verifiable production container
vcr up prod

# Your app is now running in a Cartesi Machine
# This is what gets deployed to production
```

**What's happening:**
- Cartesi Machine (verifiable RISC-V)
- Deterministic builds
- No debug tools
- Reproducible across environments

---

## :mag: Debugging & Profiling

### SSH Access (stage/prod-debug)

```bash
# Open shell in the system container
vcr shell --system

# View logs
vcr logs

# Execute commands
vcr exec --system ls /proc/1/root/usr/bin/
```

### Performance Profiling (stage/prod-debug)

```bash
# Start performance recording
vcr perf record

# View live profiling
vcr perf top

# Analyze recorded data
vcr perf report
```

---

## :package: Exporting & Deployment

### Export Production Build

```bash
# Export the prod build to a directory
vcr export prod ./myapp-prod

# This creates a reproducible snapshot
# Ready for deployment to any Cartesi environment
```

### Push to Registry

```bash
# Build and push to a container registry
vcr push ghcr.io/your-org/myapp:latest
```

---

## :white_check_mark: Next Steps

- Read [Profiles Explained](profiles.md) for detailed profile information
- Explore [Development Workflow](dev.md) for advanced dev techniques
- Check [Troubleshooting](troubleshooting.md) if you run into issues
- Review [CLI Reference](cli-reference.md) for all available commands

---

## :question: Need Help?

- Run `vcr --help` for general help
- Run `vcr <command> --help` for command-specific help
- Check the [Troubleshooting](troubleshooting.md) guide
- Open an issue on GitHub

---

**Ready to dive deeper?** Continue to [Profiles Explained](profiles.md) to understand the differences between dev, stage, and prod environments. 