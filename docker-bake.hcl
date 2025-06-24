target "docker-metadata-action" {
  context = "."
}

target "docker-platforms" {
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}

target "advanced-squashfs-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/advanced-squashfs-builder"
  dockerfile = "./packages/advanced-squashfs-builder/Dockerfile"
  tags = ["ghcr.io/zippiehq/advanced-squashfs-builder:latest"]
}

target "cm-snapshot-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/cm-snapshot-builder"
  dockerfile = "./packages/cm-snapshot-builder/Dockerfile"
  tags = ["ghcr.io/zippiehq/cm-snapshot-builder:latest"]
}

target "linuxkit-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/linuxkit-builder"
  dockerfile = "./packages/linuxkit-builder/Dockerfile"
  tags = ["ghcr.io/zippiehq/linuxkit-builder:latest"]
}

target "default" {
  inherits = ["advanced-squashfs-builder", "cm-snapshot-builder", "linuxkit-builder"]
} 