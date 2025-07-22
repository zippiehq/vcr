# VCR Developer Flow Documentation

Welcome to the VCR documentation! This site guides you through the complete developer workflow, from fast local iteration to verifiable production builds.

---

## :rocket: Overview

VCR (Verifiable Container Runner) enables you to:
- Develop quickly on your native platform (`dev`)
- Test in a RISC-V QEMU environment (`stage`)
- Build verifiable, deterministic containers for production (`prod`)

Each step is designed for maximum reproducibility, security, and developer productivity.

---

## :bookmark_tabs: Table of Contents

1. [Quick Start](quick-start.md)
2. [Profiles Explained](profiles.md)
3. [Development Workflow](dev.md)
4. [Stage Workflow](stage.md)
5. [Production Workflow](prod.md)
6. [Performance Profiling](perf.md)
7. [Exporting & Snapshots](export.md)
8. [Troubleshooting](troubleshooting.md)
9. [Reference: CLI Commands](cli-reference.md)

---

## :bulb: Dev → Stage → Prod Flow

1. **Develop Locally (`dev`)**
   - Fastest feedback, native platform
   - Hot reload, easy debugging
   - Run: `vcr up dev`

2. **Test in RISC-V (`stage`)**
   - QEMU-based, close to production
   - Debug tools, SSH access
   - Run: `vcr up stage`

3. **Build for Production (`prod`)**
   - Cartesi Machine, verifiable, deterministic
   - No debug tools, reproducible output
   - Run: `vcr up prod`

---

Continue to the [Quick Start](quick-start.md) to get hands-on! 