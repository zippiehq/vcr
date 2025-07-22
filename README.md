# VCR - Verifiable Container Runner

Build and run **verifiable, deterministic containers** with RISC-V support and attestation.

## ⚠️ Development Status

**This project is under heavy development and is not recommended for production use.** Features, APIs, and behavior may change without notice.

## License

Currently unlicensed.

## 🚀 Quick Start

```bash
# Install
npm install -g @zippie/vcr

# Create and run
vcr create myapp --template python
cd myapp
vcr up dev --hot
```

## 📚 Documentation

- **[Quick Start & Profiles](docs/README.md)** - Get up and running fast
- **[Workflow Guide](docs/workflow.md)** - Detailed development process  
- **[CLI Reference](docs/reference.md)** - Complete command reference
- **[Advanced Topics](docs/advanced.md)** - Power user features

## 🏗️ Build Profiles

- **`dev`** - Native platform, fastest development
- **`stage`** - RISC-V QEMU with debug tools  
- **`stage-release`** - RISC-V QEMU without debug tools
- **`prod`** - Verifiable RISC-V Cartesi Machine
- **`prod-debug`** - Verifiable RISC-V with debug tools

## 📦 Prerequisites

- Docker and buildx
- vsock support (auto-installed if needed)

---

**That's it!** VCR handles the complexity of building verifiable, deterministic containers.

**Need help?** Check the [documentation](docs/README.md) or run `vcr --help`. 