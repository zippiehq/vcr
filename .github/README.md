# GitHub Actions Workflows

This directory contains GitHub Actions workflows for building and testing the VCR project components.

## Workflows

### 1. `depot.yml` - Docker Image Builds
Builds and pushes Docker images for:
- `advanced-squashfs-builder`
- `cm-snapshot-builder` 
- `linuxkit-builder`

**Features:**
- Uses [Depot](https://depot.dev) for fast multi-platform builds
- Supports `linux/amd64` and `linux/arm64` architectures
- Pushes to GitHub Container Registry (GHCR)
- Triggers on pushes to main, tags, and pull requests

**Required Secrets:**
- `DEPOT_API_TOKEN` - Depot API token
- `DEPOT_PROJECT_ID` - Depot project ID

### 2. `cli.yml` - CLI Build and Test
Builds and tests the VCR CLI package.

**Features:**
- TypeScript compilation
- Node.js dependency installation
- CLI help command testing
- Docker availability check
- Command structure validation

### 3. `sample-python.yml` - Sample Python Build and Test
Builds and tests the sample Python HTTP server.

**Features:**
- Docker image build
- Container health endpoint testing
- Python syntax validation

## Docker Bake Configuration

The project uses Docker Bake for efficient multi-platform builds:

- `docker-bake.hcl` - Main bake configuration
- `docker-bake.platforms.hcl` - Platform definitions

## Usage

### Local Development
```bash
# Build Docker images locally
docker buildx bake

# Build specific image
docker buildx bake advanced-squashfs-builder

# Build CLI
cd packages/cli && npm run build
```

### CI/CD
Workflows automatically run on:
- Push to `main` branch
- Pull requests
- Version tags (e.g., `v1.0.0`)

## Registry
Images are published to: `ghcr.io/zippiehq/` 