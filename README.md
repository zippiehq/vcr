# VCR - Verifiable Container Runner

Build and run **verifiable, deterministic containers** with RISC-V support and attestation.

## License

Currently unlicensed.

## 🚀 Quick Start

```bash
# Get started
vcr intro
vcr create myapp --template python

# Build and run
vcr up                    # Fast dev build
vcr up stage             # RISC-V testing
vcr up prod              # Verifiable build

# Development
vcr logs                 # View logs
vcr shell                # Open shell
vcr exec "ls -la"        # Run command
vcr down                 # Stop environment
```

## 🏗️ Build Profiles

- **`dev`** - Native platform, fastest development
- **`stage`** - RISC-V QEMU with debug tools  
- **`stage-release`** - RISC-V QEMU without debug tools
- **`prod`** - Verifiable RISC-V Cartesi Machine
- **`prod-debug`** - Verifiable RISC-V with debug tools

## 📦 Prerequisites

- Docker and buildx
- vsock support (auto-installed if needed)

## 💡 Pro Tips

- Use `dev` for fast development loops
- Use `stage` for RISC-V testing
- Use `prod` for verifiable, attested builds

---

**That's it!** VCR handles the complexity of building verifiable, deterministic containers. 