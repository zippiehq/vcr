use nix::{ioctl_read, ioctl_readwrite};
use thiserror::Error;
use std::path::Path;

#[cfg(not(feature = "mock_cmio"))]
mod driver;
#[cfg(not(feature = "mock_cmio"))]
pub use driver::CmioIoDriver;

#[cfg(feature = "mock_cmio")]
mod mock;
#[cfg(feature = "mock_cmio")]
pub use mock::CmioIoDriver;

#[derive(Error, Debug)]
pub enum CmioError {
    #[error("Invalid argument")]
    InvalidArgument,
    #[error("Invalid response from CMIo")]
    InvalidResponse,
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Memory mapping failed")]
    MmapFailed,
}

pub type Result<T> = std::result::Result<T, CmioError>;

// IOCTL definitions using nix macros for cross-platform compatibility
ioctl_read!(cmio_setup, 0xd3, 0, CmioSetup);
ioctl_readwrite!(cmio_yield, 0xd3, 1, u64);

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CmioBuffer {
    pub data: u64,
    pub length: u64,
}

#[repr(C)]
#[derive(Debug)]
pub struct CmioSetup {
    pub tx: CmioBuffer,
    pub rx: CmioBuffer,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CmioYield {
    pub dev: u8,
    pub cmd: u8,
    pub reason: u16,
    pub data: u32,
}

/// Check if /dev/cmio device exists
pub fn is_cmio_device_present() -> bool {
    Path::new("/dev/cmio").exists()
}

// HTIF Device constants
const HTIF_DEVICE_YIELD: u8 = 2;
// HTIF Commands
const HTIF_YIELD_CMD_AUTOMATIC: u8 = 0;
const HTIF_YIELD_CMD_MANUAL: u8 = 1;
// HTIF Automatic reasons
const HTIF_YIELD_AUTOMATIC_REASON_TX_REPORT: u16 = 4;
