# VCR Kernels

This package contains the RISC-V Linux kernel and OpenSBI firmware assets used by the VCR (Verifiable Container Runner) system.

## Contents

- **Cartesi Linux Kernel** (v6.5.13-ctsi-1) - Custom RISC-V kernel with Cartesi modifications
- **OpenSBI Firmware** (v1.3.1-ctsi-2) - RISC-V SBI firmware with kernel payload
- **QEMU Kernel Image** - RISC-V kernel image for QEMU emulation

## Build

This image is built for `linux/amd64` only since kernel compilation is architecture-specific and the resulting artifacts are used across all target architectures.

## Usage

The kernel assets are copied into the `vcr-snapshot-builder` image using multi-stage builds:

```dockerfile
COPY --from=ghcr.io/zippiehq/vcr-kernels:latest /usr/share/cartesi-machine/images/linux.bin /usr/share/cartesi-machine/images/linux.bin
COPY --from=ghcr.io/zippiehq/vcr-kernels:latest /usr/share/qemu/images/linux-riscv64-Image /usr/share/qemu/images/linux-riscv64-Image
```

## Artifacts

- `/usr/share/cartesi-machine/images/linux.bin` - Cartesi machine firmware with kernel payload
- `/usr/share/cartesi-machine/images/linux.bin.config` - Kernel configuration for Cartesi
- `/usr/share/qemu/images/linux-riscv64-Image` - RISC-V kernel image for QEMU
- `/usr/share/qemu/images/linux-riscv64-Image.config` - Kernel configuration for QEMU 