# Production Workflow

Build and run your application in a verifiable, deterministic environment with the `prod` profile. This guide covers Cartesi Machine builds, reproducibility, and deployment.

---

## :factory: Why Use Prod Profile?

- **Verifiable Builds:** Deterministic, reproducible output
- **Cartesi Machine:** Runs in a secure, blockchain-ready VM
- **No Debug Tools:** Production-locked environment
- **Ready for Deployment:** Artifacts are portable and verifiable

---

## :rocket: Getting Started

### Start Production Environment

```bash
# Stop any running stage environment
vcr down

# Start production environment
vcr up prod

# Your app is running in a Cartesi Machine
```

---

## :lock: Deterministic Builds

- All builds are reproducible and verifiable
- No debug tools or SSH access
- Output is identical across machines and environments

### Export Production Artifacts

```bash
# Export the prod build to a directory
vcr export prod ./myapp-prod

# This creates a reproducible snapshot for deployment
```

### Push to Registry

```bash
# Build and push to a container registry
vcr push ghcr.io/your-org/myapp:latest
```

---

## :wrench: Best Practices for Prod

 **Test thoroughly in stage** before moving to prod

## :arrow_right: Next Steps

- **Debugging in prod:** See [Performance Profiling](perf.md) and [prod-debug](profiles.md)
- **Exporting:** Learn about [Exporting & Snapshots](export.md)
- **Troubleshooting:** See [Troubleshooting](troubleshooting.md) for more help

---

**Need to debug production?** Use the `prod-debug` profile for SSH and profiling tools. 