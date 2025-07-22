# Development Workflow

Master the fastest development experience with VCR's `dev` profile. This guide covers everything you need for rapid iteration and local development.

---

## :zap: Why Use Dev Profile?

The `dev` profile is your fastest path from code to running application:

- **⚡ Native Performance** - Runs directly on your hardware
- **🔄 Hot Reload** - Instant feedback on code changes (when enabled with `--hot`)
- **🐛 Full Debugging** - Complete debugging capabilities
- **🚀 Fast Builds** - No emulation overhead

---

## :rocket: Getting Started

### Basic Development Cycle

```bash
# 1. Create a new project
vcr create myapp --template python
cd myapp

# 2. Start development environment (with hot reload)
vcr up dev --hot

# 3. Your app is running at http://localhost:8080
# 4. Make changes to app.py - they'll auto-reload if --hot is enabled!
# 5. Stop when done
vcr down
```

## :fire: Hot Reload Development

### How Hot Reload Works

Hot reload monitors your source files and automatically restarts the application when changes are detected **if you start with the `--hot` flag**:

```bash
# Start with hot reload
vcr up dev --hot

# Make changes to app.py and watch it reload instantly!
```

> **Note:** Hot reload is **not enabled by default**. You must use `--hot` to enable autoreload in the dev profile.


## :mag: Debugging Techniques

### Logs and Output

```bash
# View application logs
vcr logs

# Follow logs in real-time
vcr logs --follow

# View system logs
vcr logs --system
```

### Interactive Debugging

```bash
# Open shell in your application container
vcr shell

# Execute commands in your container
vcr exec python -c "print('Hello from container!')"

# View file contents
vcr cat app.py
```

## :gear: Advanced Development Features

### Using Existing Images

```bash
# Use a pre-built image instead of building
vcr up dev --image myapp:latest

# Note: Hot reload is disabled when using --image
```
---

## :arrow_right: Next Steps

- **Test in RISC-V:** Move to [Stage Workflow](stage.md) for RISC-V testing
- **Performance profiling:** Learn about [Performance Profiling](perf.md)
- **Production deployment:** Explore [Production Workflow](prod.md)
- **Troubleshooting:** Check [Troubleshooting](troubleshooting.md) for common issues

---

**Ready to test in RISC-V?** Continue to [Stage Workflow](stage.md) to validate your application in the target architecture. 