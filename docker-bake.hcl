target "docker-metadata-action" {
  context = "."
}

target "docker-platforms" {
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}

target "docker-platforms-amd64-only" {
  platforms = [
    "linux/amd64"
  ]
}


target "docker-platforms-riscv64-only" {
  platforms = [
    "linux/riscv64"
  ]
}

target "vcr-kernels" {
  inherits = ["docker-metadata-action", "docker-platforms-amd64-only"]
  context = "./packages/vcr-kernels"
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/zippiehq/vcr-kernels:latest"]
}

target "guest-agent" {
  inherits = ["docker-metadata-action", "docker-platforms-riscv64-only"]
  context = "."
  dockerfile = "./packages/guest-agent/Dockerfile"
  tags = ["ghcr.io/zippiehq/vcr-guest-agent:latest"]
}

target "snapshot-builder" {
  inherits = ["docker-metadata-action", "docker-platforms"]
  context = "./packages/snapshot-builder"
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/zippiehq/vcr-snapshot-builder:latest"]
  depends_on = ["vcr-kernels"]
}

target "default" {
  inherits = ["vcr-kernels", "snapshot-builder"]
} 