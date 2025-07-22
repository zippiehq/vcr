# VCR Documentation

VCR (Verifiable Container Runner) helps you build and run containers with RISC-V support. Get from code to production in 3 simple steps.

---

## 🚀 Quick Start

### 1. Install & Create
```bash
npm install -g @zippie/vcr
vcr create myapp --template python
cd myapp
```

### 2. Develop & Test
```bash
# Fast development (your computer's CPU)
vcr up dev --hot
```
> **Note:** The `--hot` flag restarts the environment automatically whenever files are changed (hot reload). Now available for all profiles, including `prod`.

```bash
# Test in RISC-V (closer to production)
vcr down
vcr up stage --hot

# Production build (verifiable)
vcr down
vcr up prod --hot
```

### 3. Deploy
```bash
# Export for deployment
vcr export prod ./deployment

# Or push to registry
vcr push ghcr.io/your-org/myapp:latest
```

---

## 📋 Profiles

| Profile        | What it does           | Speed         | Debug         |
|---------------|-----------------------|---------------|--------------|
| `dev`         | Runs on your computer | Fastest       | Full tools    |
| `stage`       | RISC-V emulation      | ~2.3x slower  | SSH + perf    |
| `stage-release`| RISC-V emulation     | ~2.3x slower  | SSH only      |
| `prod`        | Verifiable RISC-V     | ~2.3x slower  | None          |
| `prod-debug`  | Verifiable RISC-V     | ~2.3x slower  | SSH + perf    |

**Hot reload:** Add `--hot` to any profile for auto-restart on file changes.

---

## 🔧 Common Commands

```bash
# Start environment
vcr up <profile> [--hot]

# View logs
vcr logs [--follow]

# Debug
vcr shell [--system]
vcr exec <command>

# Clean up
vcr down
vcr prune --local
```

**Need help?** Run `vcr --help` or `vcr <command> --help` 