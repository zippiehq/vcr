# CLI Reference

A complete reference for all VCR CLI commands, options, and usage. For the most up-to-date and detailed help, use `vcr <command> --help`.

---

## :clipboard: Commands Overview

| Command                | Description                                 |
|------------------------|---------------------------------------------|
| `vcr intro`            | Show introduction and quick start guide     |
| `vcr create`           | Create new project from template            |
| `vcr build`            | Build container images                      |
| `vcr up`               | Build and run environment                   |
| `vcr push`             | Build and push prod container to registry   |
| `vcr down`             | Stop development environment                |
| `vcr logs`             | View container or system logs               |
| `vcr exec`             | Execute command in container or system      |
| `vcr shell`            | Open shell in container or system           |
| `vcr cat`              | View file contents in container             |
| `vcr export`           | Export profile artifacts to directory       |
| `vcr prune`            | Clean up VCR environment                    |
| `vcr perf`             | Run Linux perf tool in stage/prod-debug     |

---

## :wrench: Command Details

### `vcr intro`
Show introduction and quick start guide.

---

### `vcr create <project-name> --template <language>`
Create a new project from a template.

**Templates:**
- python
- node
- rust
- go

**Examples:**
- `vcr create myapp --template python`
- `vcr create webapp --template node`

---

### `vcr build <profile> [options]`
Build container images for different profiles without running them.

**Supported Profiles:**
- dev
- stage
- stage-release
- prod
- prod-debug

**Options:**
- `-t, --tag <name:tag>`                Custom image tag
- `--image <image>`                     Use existing Docker image instead of building
- `--force-rebuild`                     Force rebuild all artifacts
- `--depot`                             Use depot build instead of docker buildx
- `--no-depot`                          Disable depot build (use docker buildx)
- `--no-tar-context`                    Disable deterministic tar context
- `--force-docker-tar`                  Force using Docker for tar creation
- `--turbo`                             Enable multi-core QEMU (stage profiles only)
- `--guest-agent-image <image>`         Custom guest agent image (prod/prod-debug only)
- `--hot`                               Enable hot reload (incompatible with --image)
- `--cache-dir <path>`                  Custom cache directory

**Notes:**
- `--image` and `--hot` are incompatible
- For stage/prod profiles, `--image` uses direct image reference in LinuxKit YAML
- `--turbo` only affects stage profiles (multi-core QEMU)
- `--guest-agent-image` only affects prod/prod-debug profiles

**Examples:**
- `vcr build dev`
- `vcr build stage --image myapp:latest`
- `vcr build prod --guest-agent-image my-registry/guest-agent:v2`
- `vcr build dev --hot`
- `vcr build stage --turbo`
- `vcr build prod --depot`

---

### `vcr up <profile> [options]`
Build container images and start the development environment.

**Supported Profiles:**
- dev
- stage
- stage-release
- prod
- prod-debug

**Options:**
- `-t, --tag <name:tag>`                Custom image tag
- `--image <image>`                     Use existing Docker image instead of building
- `--force-rebuild`                     Force rebuild all artifacts
- `--restart`                           Force restart environment
- `--depot`                             Use depot build instead of docker buildx
- `--no-depot`                          Disable depot build (use docker buildx)
- `--no-tar-context`                    Disable deterministic tar context
- `--force-docker-tar`                  Force using Docker for tar creation
- `--turbo`                             Enable multi-core QEMU (stage profiles only)
- `--guest-agent-image <image>`         Custom guest agent image (prod/prod-debug only)
- `--hot`                               Enable hot reload (incompatible with --image)
- `--cache-dir <path>`                  Custom cache directory

**Notes:**
- `--image` and `--hot` are incompatible
- For stage/prod profiles, `--image` uses direct image reference in LinuxKit YAML
- `--turbo` only affects stage profiles (multi-core QEMU)
- `--guest-agent-image` only affects prod/prod-debug profiles
- Hot reload behavior varies by profile (file watching vs rebuild)

**Examples:**
- `vcr up dev --hot`
- `vcr up stage --turbo`
- `vcr up prod --guest-agent-image my-registry/guest-agent:v2`

---

### `vcr push <registry-path> [options]`
Build a production (RISC-V) container and push it to a registry.

**Options:**
- `--cache-dir <path>`                  Custom cache directory
- `--force-rebuild`                     Force rebuild all artifacts
- `--depot`                             Use depot build instead of docker buildx
- `--no-depot`                          Disable depot build (use docker buildx)
- `--force-docker-tar`                  Force using Docker for tar creation
- `--source`                            Only push source context, don't build
- `--git`                               Only push to git remote, don't build

**Notes:**
- Always builds for RISC-V 64-bit architecture
- Uses deterministic builds for reproducibility
- Supports custom registry mappings
- `--source` and `--git` are mutually exclusive

**Examples:**
- `vcr push my-registry.com/myapp:latest --depot`
- `vcr push my-registry.com/myapp:latest --force-rebuild`

---

### `vcr down`
Stop the development or test environment.

---

### `vcr logs [options]`
View logs from containers or system components.

**Options:**
- `--system`                            Target system instead of container
- `-f, --follow`                        Follow logs in real-time
- `--tail <lines>`                      Show last N lines (default: 100)

**Examples:**
- `vcr logs --follow`
- `vcr logs --system --tail 50`

---

### `vcr exec [options] <command>`
Execute a command in the running container or system.

**Options:**
- `--system`                            Target system instead of container

**Examples:**
- `vcr exec "ls -la"`
- `vcr exec --system "ps aux"`

---

### `vcr shell [options]`
Open an interactive shell in the container or system.

**Options:**
- `--system`                            Target system instead of container

**Examples:**
- `vcr shell`
- `vcr shell --system`

---

### `vcr cat <file-path> [options]`
View the contents of a file in the container or system.

**Options:**
- `--system`                            Target system instead of container

**Examples:**
- `vcr cat /etc/os-release`
- `vcr cat --system /etc/hosts`

---

### `vcr export <profile> <path> [options]`
Export build artifacts for a specific profile to a directory.

**Supported Profiles:**
- dev
- stage
- stage-release
- prod
- prod-debug

**Options:**
- `--guest-agent-image <image>`         Custom guest agent image (prod/prod-debug only)
- `--cache-dir <path>`                  Custom cache directory
- `--force-rebuild`                     Force rebuild all artifacts

**Examples:**
- `vcr export prod ./deployment --guest-agent-image my-registry/guest-agent:v2`
- `vcr export stage ./test-artifacts`

---

### `vcr prune [options]`
Clean up VCR containers, images, and cache data.

**Options:**
- `--local`                             Only clean up local project data

**Examples:**
- `vcr prune --local`

---

### `vcr perf <subcommand> [args]`
Run the Linux perf tool inside the system VM for performance analysis.

**Supported Subcommands:**
- `record`    Start a perf recording
- `top`       Show live profiling
- `report`    Analyze perf data

**Supported Profiles:**
- stage
- prod-debug

**Behavior:**
- `record`:   stage → 'record', prod-debug → 'record -e cpu-clock -F max'
- `top`:      stage → 'top',    prod-debug → 'top -e cpu-clock -F max'
- `report`:   Both → 'report' (plus any extra args)

**Examples:**
- `vcr perf record`
- `vcr perf top`
- `vcr perf report -i perf.data`

---

## :bulb: More Help

- Run `vcr --help` for a summary of all commands
- Run `vcr <command> --help` for detailed help and examples
- See [Quick Start](quick-start.md) for a hands-on guide
- See [Troubleshooting](troubleshooting.md) for common issues

---

**Tip:** For the latest options and features, always check the command-specific help! 