# CLI Reference

Complete command reference for VCR.

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| `vcr intro` | Show introduction |
| `vcr create <name> --template <lang>` | Create new project |
| `vcr up <profile> [options]` | Build and run |
| `vcr down` | Stop environment |
| `vcr logs [options]` | View logs |
| `vcr shell [options]` | Open shell |
| `vcr exec [options] <command>` | Run command |
| `vcr cat <file>` | View file |
| `vcr export <profile> <path>` | Export build |
| `vcr push <registry>` | Push to registry |
| `vcr prune [--local]` | Clean up |
| `vcr perf <subcommand>` | Performance profiling |

---

## ⚙️ Common Options

### Build & Run
```bash
--hot                    # Enable hot reload
--image <image>          # Use existing image
--force-rebuild          # Force rebuild
--cache-dir <path>       # Custom cache directory
```

### Debug
```bash
--system                 # Target system container
--follow                 # Follow logs in real-time
```

---

## 🎯 Profiles

- `dev` - Native platform, fastest
- `stage` - RISC-V QEMU, debug tools
- `stage-release` - RISC-V QEMU, no debug
- `prod` - Cartesi Machine, production
- `prod-debug` - Cartesi Machine, debug tools

---

## 📝 Examples

### Development
```bash
# Create and start
vcr create myapp --template python
cd myapp
vcr up dev --hot

# Debug
vcr logs --follow
vcr shell
vcr exec "ls -la"
```

### Testing
```bash
# Test in RISC-V
vcr up stage
vcr shell --system
vcr perf record
```

### Production
```bash
# Build and deploy
vcr up prod
vcr export prod ./deployment
vcr push ghcr.io/org/myapp:latest
```

### Maintenance
```bash
# Clean up
vcr down
vcr prune --local

# Get help
vcr --help
vcr <command> --help
```

---

## 🔧 Templates

- `python` - Python application

---

**Need more details?** Run `vcr <command> --help` for specific command help. 