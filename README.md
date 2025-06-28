# VCR - Verifiable Container Runner

**1-Minute Quick Start Guide**

## 🚀 **What is VCR?**
VCR is a CLI tool for building and running **verifiable, deterministic containers** with RISC-V support, LinuxKit integration, Cartesi machine emulation, and attestation capabilities.

## 📦 **Prerequisites**
- Docker and buildx installed
- VCR automatically sets up `vcr-builder` and `vcr-registry` on first run
- RISC-V 64-bit emulation support (auto-installed if needed)

## 🎯 **Core Commands**

### **Create & Setup**
```bash
vcr create myapp --template python    # Create new Python project
vcr create webapp --template node     # Create new Node.js project
vcr create api --template go          # Create new Go project
vcr create service --template rust    # Create new Rust project
```

### **Build & Run**
```bash
vcr build                    # Build verifiable container with auto-generated tag
vcr build -t myapp:1.0      # Build with custom tag
vcr up                      # Build and run development environment
vcr up -t myapp:1.0        # Build and run with custom tag
vcr down                    # Stop environment
```

### **Development Workflow**
```bash
vcr logs                    # View logs
vcr logs -f                 # Follow logs in real-time
vcr exec ls -la             # Run command in container
vcr shell                   # Open shell in container
vcr cp local.txt /app/      # Copy file to container
vcr cp /app/log.txt ./      # Copy file from container
vcr cat /app/config.json    # View file in container
```

### **Management**
```bash
vcr prune                   # Clean entire VCR environment
vcr prune --local           # Clean only current project
```

## 🏗️ **Build Profiles**
- `dev` - Native platform, fast development (no attestation)
- `test` - RISC-V 64-bit with dev tools (no attestation)
- `prod` - RISC-V 64-bit production build (with attestation)
- `prod-debug` - RISC-V 64-bit with dev tools and attestation

## 🔐 **Verification Features**
- **Deterministic builds** - Reproducible container images
- **RISC-V 64-bit support** - Cross-platform verification
- **LinuxKit integration** - Custom kernel and rootfs
- **Cartesi machine emulation** - Deterministic VM execution
- **dm-verity attestation** - Hash tree verification
- **SHA256 hashing** - All artifacts are cryptographically verified

## 🎨 **Smart Features**
- **Auto-tagging**: Default tags based on project path hash
- **Smart caching**: Compose files stored in `~/.cache/vcr/<path-hash>/`
- **Project isolation**: Unique containers per project directory
- **Smart restarts**: Only recreate containers when images change
- **Port conflict detection**: Error if port 8080 is already in use

## 📁 **File Operations**
- Container paths must start with `/app/`
- `vcr cp` auto-detects direction (host ↔ container)
- `vcr cat` for quick file viewing
- Shared volume at `/media/vcr` between services

## 🔧 **Advanced Options**
```bash
vcr up --restart            # Force restart containers
vcr build --force-rebuild   # Force rebuild all artifacts (LinuxKit, Cartesi machine, etc.)
vcr build --profile prod    # Use production profile with attestation
```

## 💡 **Pro Tips**
- Use `vcr create` to quickly start new projects from templates
- Use `dev` profile for fast development loops
- Use `prod` profile for verifiable, attested builds
- RISC-V builds create deterministic LinuxKit images
- Cartesi machine integration provides VM-level verification
- All artifacts include cryptographic hashes for verification
- Port 8080 conflicts will error out with helpful resolution suggestions

---

**That's it!** VCR handles the complexity of building verifiable, deterministic containers with RISC-V support and attestation capabilities. 