# Exporting & Snapshots

Export your builds and create reproducible snapshots for deployment or further analysis. This guide covers exporting in different profiles, snapshot creation, and best practices.

---

## :package: Why Export?

- **Reproducibility:** Share exact builds with others
- **Deployment:** Move builds to production or other environments
- **Analysis:** Archive builds for debugging or auditing

---

## :rocket: Exporting Builds

### Export a Build

```bash
# Export the current build to a directory
vcr export <profile> ./export-dir

# Example: Export production build
vcr export prod ./myapp-prod
```

- Supported profiles: `stage`, `stage-release`, `prod`, `prod-debug`
- The export includes all necessary artifacts for deployment

## :arrow_right: Next Steps

- Learn about [Production Workflow](prod.md) for deployment
- See [Troubleshooting](troubleshooting.md) for more help
- Review [CLI Reference](cli-reference.md) for export options

---

**Ready to deploy?** Export your build and move to production with confidence. 