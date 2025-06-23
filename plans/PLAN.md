# Project Plan: @zippie/vcr

## Overview
This project implements a verifiable container runner (VCR) as a TypeScript CLI tool, installable globally via npm as `@zippie/vcr` and callable as `vcr`. The tool orchestrates deterministic and non-deterministic build and execution flows for containerized environments, with future integration for TEE/IPR attestation.

---

## High-Level Flows (from diagram)

1. **Development Container Build**
   - Build x86/ARM64 container for development using Dockerfile.

2. **Verifiable Container Build**
   - Build RISC64 container for verifiable running (Docker build).
   - Use linuxkit to produce deterministic kernel + tar output.
   - Create generic kernel + squashfs.

3. **Non-Deterministic VM Path**
   - Run generic kernel+squashfs in qemu-system-riscv64.
   - Results in a non-deterministic VM.

4. **Deterministic VM Path**
   - Use opensbi + cartesi kernel (future generic) + tar.
   - Squashfs the unpacked tar/directory contents deterministically.
   - Result: opensbi + cartesi kernel + uncompressed squashfs.
   - Create cartesi machine snapshot (deterministic, maybe at step 0).
   - Run machine until healthcheck passes (deterministic).
   - Save cartesi machine snapshot (directory).
   - Squashfs the snapshot (compressed) + dm-verity hashes + root hash (deterministic).
   - Load as nitro enclave-vsock-NBD mountable drive.
   - Deterministic attestation: VM up, attest on root hash or run-once attestation (CM hash = verity root hash).

5. **TEE/IPR Integration**
   - Placeholder for zippie IPR/TEE integration (future work).

---

## CLI Structure

- `vcr build [options]` — Build containers and artifacts deterministically.
- `vcr run [options]` — Run containers/VMs (deterministic or non-deterministic).
- `vcr attest [options]` — Attest VM state (future, TEE/IPR integration).

---

## Modules & Features

- **Docker Integration**: Build x86/ARM64 and RISC64 containers.
- **LinuxKit Integration**: Build deterministic kernels and rootfs.
- **QEMU Integration**: Run RISC64 VMs (non-deterministic path).
- **Cartesi/Opensbi Integration**: Deterministic kernel and snapshot creation.
- **SquashFS/Compression**: Deterministic squashfs creation and decompression.
- **dm-verity**: Hash calculation and root hash attestation.
- **Nitro Enclave Support**: Export as NBD mountable drive.
- **TEE/IPR**: Placeholder for future integration.

---

## External Dependencies
- Docker
- QEMU (system-riscv64)
- LinuxKit
- squashfs-tools
- Cartesi/Opensbi
- dm-verity tools
- AWS Nitro Enclaves (optional, for attestation)

---

## Implementation Steps
1. Scaffold TypeScript project with CLI entrypoint (`vcr`).
2. Implement `build` command for deterministic container and kernel builds.
3. Implement `run` command for both deterministic and non-deterministic VMs.
4. Integrate squashfs, dm-verity, and Nitro Enclave support.
5. Add placeholder for TEE/IPR attestation.
6. Write tests and documentation.

---

## Future Work
- Full TEE/IPR integration.
- Support for additional architectures.
- Advanced attestation and verification flows.
- User-friendly error handling and logging. 