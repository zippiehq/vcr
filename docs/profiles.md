# Profiles Explained

VCR provides different execution environments optimized for different stages of development and deployment. Understanding these profiles helps you choose the right one for your needs.

---

## :rocket: Profile Overview

| Profile | Architecture | Speed | Debug Tools | Use Case |
|---------|-------------|-------|-------------|----------|
| `dev` | Native (x86_64/ARM64) | ⚡ Fastest | ✅ Full | Local development |
| `stage` | RISC-V (QEMU) | 🐢 ~2.3x slower | ✅ SSH + perf | Testing |
| `stage-release` | RISC-V (QEMU) | 🐢 ~2.3x slower | ❌ None | Pre-prod testing |
| `prod` | RISC-V (Cartesi) | 🐌 Slowest | ❌ None | Production |
| `prod-debug` | RISC-V (Cartesi) | 🐌 Slowest | ✅ SSH + perf | Production debugging |

---

## :computer: Development Profile (`dev`)

**Best for:** Rapid iteration and local development

### Characteristics
- **Architecture:** Native platform (x86_64 on Intel/AMD, ARM64 on Apple Silicon)
- **Speed:** Fastest possible - runs directly on your hardware
- **Hot Reload:** ✅ Enabled with `--hot` flag
- **Debug Tools:** ✅ Full access to all debugging capabilities
- **Deterministic:** ❌ No - builds may vary between machines

### Use Cases
- Initial development and prototyping
- Fast feedback loops
- Testing new features quickly
- Local debugging with full tooling

### Commands
```bash
# Start development environment
vcr up dev --hot

# Using existing image
vcr up dev --image myapp:latest
```

---

## :test_tube: Stage Profile (`stage`)

**Best for:** Testing in RISC-V environment with debug capabilities

### Characteristics
- **Architecture:** RISC-V via QEMU emulation
- **Speed:** ~2.3x faster than prod
- **Hot Reload:** ✅ Available with `--hot` flag
- **Debug Tools:** ✅ SSH access, performance profiling
- **Deterministic:** ❌ No - QEMU introduces some variability

### Use Cases
- Testing RISC-V compatibility
- Performance profiling with `vcr perf`
- Debugging RISC-V specific issues
- Pre-production validation

### Commands
```bash
# Start stage environment
vcr up stage

# With hot reload
vcr up stage --hot

# SSH into system container
vcr shell --system

# Performance profiling
vcr perf record
vcr perf top
vcr perf report
```

---

## :lock: Stage-Release Profile (`stage-release`)

**Best for:** Testing production-like environment without debug overhead

### Characteristics
- **Architecture:** RISC-V via QEMU emulation
- **Speed:** ~2.3x slower than stage
- **Hot Reload:** ✅ Available with `--hot` flag
- **Debug Tools:** ❌ No SSH or debug tools
- **Deterministic:** ❌ No - QEMU introduces some variability

### Use Cases
- Final testing before production
- Performance benchmarking
- Security testing (no debug tools)
- CI/CD pipeline testing

### Commands
```bash
# Start stage-release environment
vcr up stage-release

# Export for testing
vcr export stage-release ./test-build
```

---

## :factory: Production Profile (`prod`)

**Best for:** Creating verifiable, deterministic production builds

### Characteristics
- **Architecture:** RISC-V via Cartesi Machine
- **Speed:** Slowest - full Cartesi Machine overhead
- **Hot Reload:** ❌ Not available
- **Debug Tools:** ❌ No SSH or debug tools
- **Deterministic:** ✅ Yes - reproducible across all environments

### Use Cases
- Production deployments
- Verifiable computing
- Deterministic builds
- Blockchain integration

### Commands
```bash
# Build production environment
vcr up prod

# Export for deployment
vcr export prod ./production-build

# Push to registry
vcr push ghcr.io/your-org/myapp:latest
```

---

## :bug: Production-Debug Profile (`prod-debug`)

**Best for:** Debugging production issues in Cartesi Machine

### Characteristics
- **Architecture:** RISC-V via Cartesi Machine
- **Speed:** Slowest - full Cartesi Machine overhead
- **Hot Reload:** ❌ Not available
- **Debug Tools:** ✅ SSH access, performance profiling
- **Deterministic:** ✅ Yes - reproducible across all environments

### Use Cases
- Debugging production issues
- Performance analysis in Cartesi environment
- Troubleshooting deterministic builds
- Development of Cartesi-specific features

### Commands
```bash
# Start production-debug environment
vcr up prod-debug

# SSH into system container
vcr shell --system

# Performance profiling
vcr perf record
vcr perf top
vcr perf report
```

---

## :chart_with_upwards_trend: Performance Comparison

### Speed Rankings
1. **`dev`** - Native execution (baseline)
2. **`stage`** / **`stage-release`** - ~2.3x slower (QEMU overhead)
3. **`prod`** / **`prod-debug`** - ~2.3x slower than stage (Cartesi overhead)

---

## :bulb: Choosing the Right Profile

### Development Workflow
1. **Start with `dev`** - Fastest iteration
2. **Test with `stage`** - RISC-V compatibility
3. **Validate with `stage-release`** - Production-like testing
4. **Deploy with `prod`** - Verifiable production build

### Debugging Workflow
1. **Use `dev`** for general debugging
2. **Use `stage`** for RISC-V specific issues
3. **Use `prod-debug`** for production issues

### CI/CD Pipeline
1. **Build with `dev`** - Fast feedback
2. **Test with `stage-release`** - RISC-V validation
3. **Deploy with `prod`** - Production build

---

## :warning: Important Notes

### Hot Reload Compatibility
- **Available:** `dev`, `stage`, `stage-release` (with `--hot`)
- **Not Available:** `prod`, `prod-debug`
- **Incompatible with:** `--image` flag

### Debug Tool Availability
- **SSH Access:** `stage`, `prod-debug`
- **Performance Profiling:** `stage`, `prod-debug`
- **Full Debug Tools:** `dev` only

### Deterministic Builds
- **Deterministic:** `prod`, `prod-debug`
- **Non-deterministic:** `dev`, `stage`, `stage-release`

---

**Next:** Learn about the [Development Workflow](dev.md) to master the `dev` profile for rapid iteration. 