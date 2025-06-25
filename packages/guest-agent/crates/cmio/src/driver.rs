use super::{CmioBuffer, CmioError, CmioSetup, CmioYield, Result};
use libc::{
    c_char, c_int, c_void, close, mmap, munmap, open, O_RDWR, PROT_READ, PROT_WRITE, MAP_FAILED,
    MAP_SHARED,
};
use nix::{ioctl_read, ioctl_readwrite};
use std::ptr;

ioctl_read!(cmio_setup, 0xd3, 0, CmioSetup);
ioctl_readwrite!(cmio_yield, 0xd3, 1, u64);

// HTIF Device constants
const HTIF_DEVICE_YIELD: u8 = 2;
// HTIF Commands
const HTIF_YIELD_CMD_MANUAL: u8 = 1;

/// IO driver for CMIO operations
pub struct CmioIoDriver {
    fd: c_int,
    tx_ptr: *mut u8,
    tx_len: usize,
    rx_ptr: *mut u8,
    rx_len: usize,
}

impl CmioIoDriver {
    /// Initialize the CMIO driver
    pub fn new() -> Result<Self> {
        let fd = unsafe { open(b"/dev/cmio\0".as_ptr() as *const c_char, O_RDWR) };

        if fd < 0 {
            return Err(CmioError::IoError(std::io::Error::last_os_error()));
        }

        let mut setup = CmioSetup {
            tx: CmioBuffer { data: 0, length: 0 },
            rx: CmioBuffer { data: 0, length: 0 },
        };

        // Use nix ioctl macro
        if unsafe { cmio_setup(fd, &mut setup) }.is_err() {
            let err = std::io::Error::last_os_error();
            unsafe { close(fd) };
            return Err(CmioError::IoError(err));
        }

        let tx_ptr = unsafe {
            mmap(
                setup.tx.data as *mut c_void,
                setup.tx.length as usize,
                PROT_READ | PROT_WRITE,
                MAP_SHARED,
                fd,
                0,
            )
        };

        if tx_ptr == MAP_FAILED {
            let err = std::io::Error::last_os_error();
            unsafe { close(fd) };
            return Err(CmioError::IoError(err));
        }

        let rx_ptr = unsafe {
            mmap(
                setup.rx.data as *mut c_void,
                setup.rx.length as usize,
                PROT_READ,
                MAP_SHARED,
                fd,
                0,
            )
        };

        if rx_ptr == MAP_FAILED {
            let err = std::io::Error::last_os_error();
            unsafe { munmap(tx_ptr, setup.tx.length as usize) };
            unsafe { close(fd) };
            return Err(CmioError::IoError(err));
        }

        Ok(CmioIoDriver {
            fd,
            tx_ptr: tx_ptr as *mut u8,
            tx_len: setup.tx.length as usize,
            rx_ptr: rx_ptr as *mut u8,
            rx_len: setup.rx.length as usize,
        })
    }

    /// Yield control to the emulator
    pub fn yield_control(&self, yield_data: &mut CmioYield) -> Result<()> {
        if yield_data as *const _ == ptr::null() {
            return Err(CmioError::InvalidArgument);
        }

        let req = Self::pack(yield_data);
        let mut response = req;

        // Use nix ioctl macro
        if unsafe { cmio_yield(self.fd, &mut response) }.is_err() {
            return Err(CmioError::IoError(std::io::Error::last_os_error()));
        }

        *yield_data = Self::unpack(response);
        Ok(())
    }

    /// Pack a CmioYield struct into a u64
    fn pack(yield_data: &CmioYield) -> u64 {
        ((yield_data.dev as u64) << 56)
            | ((yield_data.cmd as u64) << 48)
            | ((yield_data.reason as u64) << 32)
            | (yield_data.data as u64)
    }

    /// Unpack a u64 into a CmioYield struct
    fn unpack(x: u64) -> CmioYield {
        CmioYield {
            dev: (x >> 56) as u8,
            cmd: (x >> 48) as u8,
            reason: (x >> 32) as u16,
            data: x as u32,
        }
    }

    /// Get a slice of the TX buffer
    pub fn tx_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.tx_ptr, self.tx_len) }
    }

    /// Get a mutable slice of the TX buffer
    pub fn tx_slice_mut(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.tx_ptr, self.tx_len) }
    }

    /// Get a slice of the RX buffer
    pub fn rx_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.rx_ptr, self.rx_len) }
    }

    /// Get the length of the TX buffer
    pub fn tx_len(&self) -> usize {
        self.tx_len
    }

    /// Get the length of the RX buffer
    pub fn rx_len(&self) -> usize {
        self.rx_len
    }

    /// Send data via CMIO and receive a response
    pub fn send_cmio(&mut self, tx_data: &[u8], domain: u16) -> Result<Vec<u8>> {
        if tx_data.len() > self.tx_len() {
            return Err(CmioError::InvalidArgument);
        }
        // Write to TX buffer
        let tx_buf = self.tx_slice_mut();
        tx_buf[..tx_data.len()].copy_from_slice(tx_data);
        // Prepare yield
        let mut yield_data = CmioYield {
            dev: HTIF_DEVICE_YIELD,
            cmd: HTIF_YIELD_CMD_MANUAL,
            reason: domain,
            data: tx_data.len() as u32,
        };
        self.yield_control(&mut yield_data)?;
        // Copy RX buffer
        let rx_buf = self.rx_slice();
        let rx_vec = rx_buf[..self.rx_len()].to_vec();
        Ok(rx_vec)
    }
}

impl Drop for CmioIoDriver {
    fn drop(&mut self) {
        unsafe {
            munmap(self.tx_ptr as *mut c_void, self.tx_len);
            munmap(self.rx_ptr as *mut c_void, self.rx_len);
            close(self.fd);
        }
    }
} 