# VCR Architecture & Implementation Guide

## Overview

VCR (Verifiable Container Runner) is a sophisticated CLI tool that manages Docker Compose environments with a focus on verifiable, deterministic container builds. It supports RISC-V architecture, LinuxKit integration, Cartesi machine emulation, and attestation capabilities.

## Core Architecture

### 1. Project Structure

The VCR project is organized as a monorepo with several key packages:

- **CLI Package**: The main command-line interface written in TypeScript
- **Guest Agent**: A Rust-based component that runs inside containers
- **LinuxKit Builder**: Specialized container for building LinuxKit images
- **Snapshot Builder**: Handles Cartesi machine snapshot creation
- **VCR Kernels**: Custom kernel configurations for different architectures
- **Sample Packages**: Example applications demonstrating VCR usage

### 2. CLI Architecture

The CLI is built as a single TypeScript file with modular functions organized by responsibility. The code is structured around several key areas:

**Environment Setup & Validation**: Functions that ensure all prerequisites are met, including Docker availability, Buildx support, local registry management, and RISC-V architecture support.

**Build System**: Core functions that orchestrate the multi-platform image building process, configure BuildKit for cross-architecture builds, and manage the development container lifecycle.

**LinuxKit Integration**: Specialized functions that generate LinuxKit YAML configurations and build LinuxKit images with RISC-V support, including SSH setup and security verification.

**Docker Compose Management**: Functions that create and manage Docker Compose configurations for different deployment profiles, handle port conflicts, and manage the development environment lifecycle.

**Project Management**: Utilities for creating new projects from templates, generating deterministic path-based hashes, and managing project isolation.

## Detailed Workflow

### 1. Image Building Process

The image building process follows a three-step approach:

**Step 1: Environment Validation** - The system checks all prerequisites including Docker availability, Buildx support, VCR-specific builder configuration, local registry status, and RISC-V architecture support.

**Step 2: BuildKit Configuration** - A specialized BuildKit configuration is created that supports multi-platform builds with registry connectivity, enabling builds for linux/amd64, linux/arm64, and linux/riscv64 architectures.

**Step 3: Multi-Platform Build** - Images are built for all target platforms based on the selected profile. Development profiles target native architectures (amd64/arm64), while test and production profiles target RISC-V 64-bit architecture.

### 2. LinuxKit Integration

The LinuxKit integration is a core feature that enables RISC-V support and deterministic builds:

**YAML Generation**: The system generates a LinuxKit configuration that includes init components, network services, SSH support, and the application container. All images use SHA256 digests for security verification.

**Key Features**: The LinuxKit configuration includes SHA256 verification for all images, SSH debug key generation and management, host networking for proper connectivity, and integration with the caching system for persistent build artifacts.

**Build Process**: The LinuxKit build process involves creating a tar image, converting it to a squashfs format for efficiency, and optionally creating a Cartesi machine snapshot for production deployments.

### 3. Docker Compose Profiles

VCR supports three distinct deployment profiles, each optimized for different use cases:

**Development Profile**: Designed for local development with hot reloading, volume mounts for source code, and native architecture support. Uses the local registry for fast iteration cycles.

**Test Profile**: Runs applications in a QEMU-emulated RISC-V 64-bit environment, providing a realistic test environment that matches the production architecture without the complexity of Cartesi machines.

**Production Profile**: Uses Cartesi machine emulation for deterministic, verifiable execution. This profile creates cryptographic snapshots that can be attested and verified, ensuring reproducible behavior.

### 4. Caching System

The caching system is designed for performance and reproducibility:

**Cache Directory Structure**: Build artifacts are stored in a hierarchical cache structure based on path hashes, ensuring that different projects don't interfere with each other. The cache includes LinuxKit configurations, build artifacts, SSH keys, and Cartesi machine snapshots.

**Cache Management**: The system uses path-based hashing for deterministic cache keys, proper UID/GID mapping for Docker containers, persistent storage across sessions, and a force rebuild option to bypass cache when needed.

### 5. Security & Verification

Security is built into every layer of the system:

**Image Verification**: All LinuxKit images use SHA256 digests for verification, registry connectivity is verified before builds, and reproducible builds are ensured through fixed timestamps.

**SSH Security**: The system generates debug SSH keys with proper permissions, manages authorized keys files, and provides secure access to running containers for debugging purposes.

### 6. Container Management

The container management system provides comprehensive control over running environments:

**Port Conflict Detection**: The system checks for port conflicts before starting services and provides clear error messages when conflicts are detected.

**Project Isolation**: Each project is isolated using path-based hashing, ensuring that different projects can run simultaneously without interference.

**Container Interaction**: The CLI provides commands for executing commands in containers, accessing interactive shells, copying files, and viewing file contents.

### 7. Build System Integration

The build system integrates with Docker's ecosystem:

**Docker Registry Management**: A local registry runs on port 5001 for fast image access, with proper network configuration for both host and container access.

**BuildKit Configuration**: The system uses a specialized BuildKit configuration that supports multi-platform builds with registry access, enabling efficient cross-architecture builds.

### 8. Error Handling & UX

The user experience is designed to be intuitive and informative:

**Comprehensive Error Handling**: The system validates all prerequisites, checks for conflicts, manages file permissions, and provides clear error messages when issues occur.

**User Experience Features**: Progress indicators show build status, cache usage is clearly indicated, force rebuild options are available, verbose output is provided for debugging, and comprehensive help documentation is included.

**Exit Codes**: The system uses standardized exit codes to indicate different types of errors, making it easy to integrate with CI/CD systems.

### 9. Cross-Platform Support

VCR provides comprehensive cross-platform support:

**Architecture Support**: Development environments support native architectures (amd64/arm64), while test and production environments target RISC-V 64-bit architecture for consistency and verification.

**Platform Detection**: The system automatically detects the native platform and optimizes builds accordingly, ensuring the best performance for each environment.

### 10. CI/CD Integration

The system is designed for seamless CI/CD integration:

**GitHub Actions Workflow**: The CI pipeline uses Node.js 22 with pnpm, supports multi-platform builds, includes registry caching for performance, enables on-demand workflow runs, and ensures proper TypeScript compilation.

**Build Pipeline**: The CI process includes environment setup, multi-platform image builds, registry uploads with proper tagging, integration testing, and release management.

## Key Design Principles

### 1. Deterministic Builds
The system ensures that builds are reproducible by using fixed timestamps, creating reproducible filesystem images, and implementing hash-based verification for all components.

### 2. Security First
Security is prioritized through SHA256 digest verification for all images, proper file permissions, SSH key management, and isolated project environments.

### 3. Developer Experience
The system is designed for excellent developer experience with an intuitive CLI interface, comprehensive caching, clear error messages, and fast iteration cycles.

### 4. Cross-Platform Compatibility
Multi-architecture support is provided with platform-specific optimizations and consistent behavior across different environments.

### 5. Extensibility
The modular design allows for easy extension through profile-based configurations, template systems for new projects, and a plugin-ready architecture.

## Future Enhancements

### Planned Features
1. **Attestation System**: Cryptographic proof of build integrity
2. **Advanced Caching**: Distributed cache with CDN support
3. **Plugin System**: Extensible command architecture
4. **GUI Interface**: Web-based management interface
5. **Monitoring**: Real-time build and runtime metrics

### Technical Improvements
1. **Performance**: Parallel build optimization
2. **Security**: Enhanced verification mechanisms
3. **Reliability**: Improved error recovery
4. **Scalability**: Support for large-scale deployments

This architecture provides a solid foundation for verifiable, deterministic container builds with strong security guarantees and excellent developer experience. 