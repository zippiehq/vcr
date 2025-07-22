# Workflow Guide

The VCR workflow: develop fast, test thoroughly, deploy securely.

---

## 🔄 Development Flow

### 1. Dev Profile (Fastest)
```bash
vcr up dev --hot
```
- Runs on your computer's CPU
- Hot reload with `--hot` flag
- Full debugging tools
- Perfect for rapid iteration

**When to use:** Daily development, testing new features

### 2. Stage Profile (Testing)
```bash
vcr up stage
```
- RISC-V emulation via QEMU
- SSH access for debugging
- Performance profiling with `vcr perf`
- ~2.3x slower than dev

**When to use:** Testing RISC-V compatibility, performance analysis

### 3. Stage-Release Profile (Testing)
```bash
vcr up stage-release
```
- RISC-V emulation via QEMU
- SSH access for debugging
- No performance profiling tools
- ~2.3x slower than dev

**When to use:** Testing RISC-V compatibility without debug overhead

### 4. Prod Profile (Production)
```bash
vcr up prod
```
- Verifiable Cartesi Machine
- Deterministic builds
- No debug tools
- ~2.3x slower than stage

**When to use:** Final builds, deployment

### 5. Prod-Debug Profile (Production Debug)
```bash
vcr up prod-debug
```
- Verifiable Cartesi Machine
- SSH access for debugging
- Performance profiling with `vcr perf`
- ~2.3x slower than stage

**When to use:** Debugging production builds

---

## 🛠️ Debugging

### SSH Access
```bash
# Connect to stage/stage-release/prod-debug
vcr shell --system

# Run commands
vcr exec --system "ps aux"
```

### Performance Profiling
```bash
# Only in stage/prod-debug
vcr perf record
vcr perf top
vcr perf report
```

### Logs
```bash
# App logs
vcr logs

# System logs
vcr logs --system

# Follow in real-time
vcr logs --follow
```

---

## 🚨 Troubleshooting

### Common Issues
- **Port 8080 in use:** Stop conflicting containers with `vcr prune --local`
- **Hot reload not working:** Restart with `--hot` flag
- **Build fails:** `vcr prune --local && vcr up dev --hot`
- **Docker not running:** Start Docker Desktop

### Profile-Specific
- **Slow startup:** Normal for stage/prod (emulation overhead)
- **Debug tools missing:** Only available in stage/prod-debug
- **Export fails:** Check disk space and permissions

---

## 📦 Deployment

### Export Build
```bash
vcr export prod ./deployment
```

### Push to Registry
```bash
vcr push ghcr.io/your-org/myapp:latest
```

**Tip:** Always test in stage before deploying to prod. 