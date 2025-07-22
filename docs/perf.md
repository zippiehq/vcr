# Performance Profiling

Analyze and optimize your application's performance using the Linux `perf` tool in VCR. This guide covers supported profiles, usage, and best practices.

---

## :chart_with_upwards_trend: Supported Profiles

| Profile      | Perf Tool Available |
|--------------|--------------------|
| `stage`      | ✅ Yes             |
| `prod-debug` | ✅ Yes             |
| Others       | ❌ No              |

- The `perf` tool is only available in `stage` and `prod-debug` profiles.
- Use `vcr perf` commands for profiling.

---

## :rocket: Getting Started

### Start Profiling Session

```bash
# Start stage or prod-debug environment
vcr up stage
# or
vcr up prod-debug

# Open a shell (optional)
vcr shell --system
```

---

## :wrench: Perf Commands

### Record Performance Data

```bash
vcr perf record
# (stage: 'record', prod-debug: 'record -e cpu-clock -F max')
```

### Live Profiling

```bash
vcr perf top
# (stage: 'top', prod-debug: 'top -e cpu-clock -F max')
```

### Analyze Recorded Data

```bash
vcr perf report
# (both: 'report')
```

---

## :bulb: Usage Examples

### Profile a Python App

```bash
vcr perf record -- python app.py
vcr perf report -i perf.data
```

### Live CPU Hotspots

```bash
vcr perf top
```

---

## :wrench: Best Practices

1. Use `stage` for fast feedback, `prod-debug` for production accuracy
2. Always analyze performance before deploying to prod
3. Use SSH (`vcr shell --system`) for advanced inspection
4. Save and archive perf data for future analysis
5. Document performance regressions and improvements

---

## :warning: Troubleshooting

### Perf Not Available
- Ensure you are in `stage` or `prod-debug` profile
- Check with `vcr shell --system` and `which perf-cm-riscv64`

### Data Not Collected
- Ensure your app is running and generating load
- Check file permissions for `perf.data`

---

## :arrow_right: Next Steps

- Learn about [Exporting & Snapshots](export.md)
- See [Troubleshooting](troubleshooting.md) for more help
- Explore [Production Workflow](prod.md) for deployment

---

**Ready to optimize?** Use `vcr perf` to find and fix performance bottlenecks before production. 