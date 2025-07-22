# Advanced Topics

Advanced VCR features for power users and complex scenarios.

---

## 🔧 Advanced Options

### Build Control
```bash
# Force rebuild ignoring cache
vcr up prod --force-rebuild

# Use existing image instead of building
vcr up prod --image ghcr.io/org/myapp:latest

# Custom cache directory
vcr up prod --cache-dir /path/to/cache

# Use depot for faster builds
vcr up prod --depot
```

### Build System Options
```bash
# Use depot build instead of docker buildx
vcr up prod --depot

# Force docker buildx (disable depot)
vcr up prod --no-depot

# Force Docker for tar creation
vcr up prod --force-docker-tar
```

### Debug & Inspection
```bash
# View file contents
vcr cat /app/main.py
vcr cat /etc/hosts

# Run commands in specific container
vcr exec --system "ps aux"
vcr exec "python --version"

# Interactive debugging
vcr shell --system
```

---

## 🎯 Profile Deep Dive

### Stage vs Stage-Release
- **stage**: Includes debug tools, SSH access, performance profiling
- **stage-release**: SSH access only, no performance profiling tools

### Prod vs Prod-Debug  
- **prod**: Production-ready, minimal overhead, deterministic
- **prod-debug**: Production environment with debug capabilities

### Performance Comparison
```
dev: ~1x speed (native)
stage: ~2.3x slower than dev (QEMU emulation)
prod: ~2.3x slower than stage (Cartesi Machine)
```

---

## 🔍 Performance Profiling

### Available in stage/prod-debug only
```bash
# Record performance data
vcr perf record

# Real-time performance monitoring
vcr perf top

# Analyze recorded data
vcr perf report
```

### Profiling Modes
- **stage**: Basic profiling with `perf record`
- **prod-debug**: Enhanced profiling with CPU clock events

---

## 📦 Export & Deployment

### Export Options
```bash
# Export to local directory
vcr export prod ./deployment

# Export with custom name
vcr export prod ./myapp-v1.0.0
```

### Registry Push
```bash
# Push to GitHub Container Registry
vcr push ghcr.io/your-org/myapp:latest

# Push with custom tag
vcr push ghcr.io/your-org/myapp:v1.0.0
```

---

## 🧹 Maintenance

### Cache Management
```bash
# Clean local cache only
vcr prune --local

# Clean all caches
vcr prune
```

### Environment Cleanup
```bash
# Stop all environments
vcr down

# Remove containers and images
docker system prune -f
```

---

## ⚡ Hot Reload Details

### How It Works
- Monitors file system changes in your project directory
- Automatically rebuilds and restarts the container
- Preserves your development workflow

### Limitations
- Only works with `--hot` flag explicitly set
- File changes trigger full container restart
- Available in `dev`, `stage`, `stage-release`, and `prod-debug` profiles only

---

## 🏗️ Build System Options

### Depot vs Docker Buildx
- **--depot**: Uses depot build system for faster builds (auto-detected if depot.json exists)
- **--no-depot**: Forces docker buildx instead of depot
- **--force-docker-tar**: Forces Docker for tar creation instead of VCR snapshot builder

### When to Use Depot
- Faster builds for large projects
- Better caching and parallelization
- Automatic detection if `depot.json` exists in project root

---

## 🐛 Troubleshooting Advanced Issues

### Build Failures
```bash
# Clear all caches and rebuild
vcr prune --local
vcr up dev --force-rebuild --hot
```

### Performance Issues
- Use `stage` for performance testing
- Profile with `vcr perf` commands (stage/prod-debug only)
- Check resource usage with `vcr exec --system "top"`

### Export Problems
- Ensure sufficient disk space
- Check file permissions
- Verify Docker daemon is running

---

**Need more help?** Check the [workflow guide](workflow.md) or [CLI reference](reference.md). 