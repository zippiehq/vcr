target "docker-metadata-action" {
  context = "."
}

target "docker-platforms" {
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}

target "snapshot-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/snapshot-builder"
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/zippiehq/vcr-snapshot-builder:latest"]
}

target "linuxkit-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/linuxkit-builder"
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/zippiehq/vcr-linuxkit-builder:latest"]
}

target "default" {
  inherits = ["snapshot-builder", "linuxkit-builder"]
} 