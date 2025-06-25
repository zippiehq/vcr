# VCR Guest Agent

A Rust-based guest agent for VCR (Verifiable Container Runner) with CMIO (Cartesi Machine I/O) support.

## Features

- **CMIO Integration**: Direct communication with Cartesi Machine emulator
- **Memory-mapped I/O**: Efficient buffer management for TX/RX operations
- **Cross-compilation**: Built for RISC-V 64-bit with musl libc
- **Device Abstraction**: Support for system, network, and storage devices
- **Error Handling**: Robust error handling with proper resource cleanup

## Architecture

### CMIO Crate (`crates/cmio/`)

The `cmio` crate provides the core functionality for communicating with the Cartesi Machine emulator:

- **CmioIoDriver**: Main driver for CMIO operations
- **CmioBuf**: Buffer wrapper for memory-mapped regions
- **CmioYield**: Yield structure for device communication
- **Error Handling**: Comprehensive error types and handling

### Main Application (`src/main.rs`)

The main application provides:
- Device command routing
- System, network, and storage device handlers
- Logging and debugging support
- Graceful shutdown handling

## Building

### Docker Build (Recommended)
```bash
docker build -t vcr-guest-agent .
```

### Native Cross-compilation
```bash
# Install RISC-V toolchain first
cargo build --target riscv64gc-unknown-linux-musl --release
```

### Testing
```bash
cargo test
```

## Usage

The guest agent runs inside a Cartesi Machine and communicates with the emulator through the `/dev/cmio` device. It handles:

- **System Commands**: Info requests, shutdown
- **Network Commands**: Read/write operations
- **Storage Commands**: Block device operations

## CMIO Protocol

The CMIO protocol uses memory-mapped I/O with two buffers:
- **TX Buffer**: For sending data to the emulator
- **RX Buffer**: For receiving data from the emulator

### Yield Structure
```rust
pub struct CmioYield {
    pub dev: u8,      // Device ID
    pub cmd: u8,      // Command
    pub reason: u16,  // Reason code
    pub data: u32,    // Data payload
}
```

### Device IDs
- `0`: System device
- `1`: Network device  
- `2`: Storage device

## Development

### Adding New Devices

1. Add device ID to the main handler
2. Implement device-specific command handlers
3. Add appropriate logging and error handling

### Testing

The cmio crate includes unit tests for:
- Pack/unpack operations
- Buffer creation and management
- Error handling

## Dependencies

- `libc`: For system calls and C interop
- `thiserror`: For error handling
- `log` + `env_logger`: For logging 