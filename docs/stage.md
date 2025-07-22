# Stage Workflow

Test your application in a RISC-V environment with the `stage` profile. This guide covers QEMU-based testing, debugging, SSH access, and performance profiling.

---

## :test_tube: Why Use Stage Profile?

- **RISC-V Emulation:** Run your app in a RISC-V QEMU VM
- **Debug Tools:** SSH access, performance profiling (`perf`)
- **Closer to Production:** Simulates the target architecture
- **Hot Reload:** Available for rapid iteration

---

## :rocket: Getting Started

### Start Stage Environment

```bash
# Stop any running dev environment
vcr down

# Start stage environment
vcr up stage

# Your app is running in RISC-V QEMU at http://localhost:8080
```

### Hot Reload in Stage

```bash
# Enable hot reload (if needed)
vcr up stage --hot

# Make changes to your code and see them reload in the RISC-V VM
```

---

## :lock_with_ink_pen: SSH Access & Debugging

### SSH into System Container

```bash
vcr shell --system

# You are now inside the RISC-V system container
# Use familiar Linux tools for debugging
```

### Debugging Tips
- Inspect running processes: `ps aux`
- Check open ports: `netstat -tuln`
- View logs: `cat /var/log/*`
- Explore filesystem: `ls -la /`

---

## :mag: Performance Profiling

### Using Perf Tool

The `stage` profile includes the Linux `perf` tool for profiling:

```bash
# Start performance recording
vcr perf record

# View live profiling
vcr perf top

# Analyze recorded data
vcr perf report
```

- `record`: Captures performance data
- `top`: Live CPU usage and hotspots
- `report`: Analyze collected data

### Example: Profile a Python App

```bash
vcr perf record -- python app.py
vcr perf report -i perf.data
```

---

## :wrench: Best Practices for Stage

1. **Test all critical paths** in RISC-V before moving to prod
2. **Use SSH** for deep debugging and inspection
3. **Profile performance** to catch architecture-specific issues
4. **Validate dependencies** for RISC-V compatibility
5. **Automate tests** in stage for CI/CD pipelines

---

## :warning: Common Issues

### Slow Startup
- QEMU emulation is slower than native; expect ~2.3x slowdown
- Use hot reload to minimize rebuilds

### Debug Tools Missing
- Only available in `stage` and `prod-debug` profiles
- If missing, check your profile with `vcr shell --system` and `vcr logs`

### File Sync Issues
- Ensure your code changes are synced into the VM
- Restart with `vcr down` and `vcr up stage` if needed

---

## :arrow_right: Next Steps

- **Production build:** Move to [Production Workflow](prod.md)
- **Exporting:** Learn about [Exporting & Snapshots](export.md)
- **Troubleshooting:** See [Troubleshooting](troubleshooting.md) for more help

---

**Ready for production?** Continue to [Production Workflow](prod.md) to create verifiable builds. 