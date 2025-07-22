# Troubleshooting

Solve common issues and error messages encountered in the VCR dev → stage → prod workflow. This guide provides solutions for each stage and general tips.

---

## :mag: General Issues

### Docker Not Running
- **Error:** `Cannot connect to the Docker daemon`
- **Solution:** Start Docker Desktop or your Docker service

### CLI Not Found
- **Error:** `vcr: command not found`
- **Solution:** Ensure you have built the CLI (`npm run build`) and your PATH is set

### Permission Denied
- **Error:** `EACCES` or `Permission denied`
- **Solution:** Check file permissions, use `sudo` if necessary

---

## :computer: Dev Profile Issues

### Hot Reload Not Working
- Restart with `vcr down` and `vcr up dev`
- Check file permissions and watcher limits

### Port Already in Use
- Use `lsof -i :8080` to find the process
- Start with a different port: `vcr up dev --port 8081`

### Build Fails
- Check logs: `vcr build dev --verbose`
- Clean and rebuild: `vcr prune --local && vcr up dev`

---

## :test_tube: Stage Profile Issues

### Slow Startup
- QEMU is slower than native; expect ~2.3x slowdown
- Use hot reload to minimize rebuilds

### SSH/Debug Tools Missing
- Only available in `stage` and `prod-debug`
- Check profile with `vcr shell --system`

### File Sync Issues
- Restart with `vcr down` and `vcr up stage`
- Ensure code changes are synced into the VM

---

## :factory: Prod Profile Issues

### Slow Build/Startup
- Cartesi Machine is slowest; use `stage` for most testing

### Debug Tools Unavailable
- Not available in `prod`; use `prod-debug` for debugging

### Export/Push Fails
- Check logs with `vcr logs`
- Ensure registry permissions for push

---

## :wrench: Exporting & Snapshot Issues

### Export Fails
- Check disk space and permissions
- Ensure build completed successfully

### Artifacts Missing
- Only supported profiles export full artifacts
- Use `prod` or `prod-debug` for complete snapshots

---

## :bulb: Tips for All Stages

1. Always check logs with `vcr logs` for more details
2. Use `vcr --help` and `vcr <command> --help` for usage info
3. Restart environments with `vcr down` and `vcr up <profile>`
4. Clean up with `vcr prune --local` if issues persist
5. Keep your CLI and dependencies up to date

---

**Still stuck?** Open an issue on GitHub or ask for help in the community. 