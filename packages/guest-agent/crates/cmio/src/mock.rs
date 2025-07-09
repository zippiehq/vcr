use super::{CmioError, Result, CmioYield};
use std::collections::HashMap;
use vsock_protocol::{
    VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW,
};

/// Mock IO driver for CMIO operations for development/testing on non-Linux hosts.
#[derive(Default)]
pub struct CmioIoDriver {
    tx_buf: Vec<u8>,
    rx_buf: Vec<u8>,
    pending_requests: Vec<Vec<u8>>,
    pending_responses: HashMap<u32, Vec<u8>>,
}

impl CmioIoDriver {
    /// Initialize the mock CMIO driver.
    /// This will immediately prepare a vsock connection request in the RX buffer,
    /// simulating an incoming connection from the host.
    pub fn new() -> Result<Self> {
        let driver = CmioIoDriver {
            tx_buf: vec![0; 4096],
            rx_buf: vec![0; 4096],
            pending_requests: Vec::new(),
            pending_responses: HashMap::new(),
        };
        Ok(driver)
    }

    /// Mock yield control
    pub fn yield_control(&self, _yield_data: &mut CmioYield) -> Result<()> {
        Ok(())
    }

    /// Get a slice of the TX buffer
    pub fn tx_slice(&self) -> &[u8] {
        &self.tx_buf
    }

    /// Get a mutable slice of the TX buffer
    pub fn tx_slice_mut(&mut self) -> &mut [u8] {
        &mut self.tx_buf
    }

    /// Get a slice of the RX buffer
    pub fn rx_slice(&self) -> &[u8] {
        &self.rx_buf
    }

    /// Get the length of the TX buffer
    pub fn tx_len(&self) -> usize {
        self.tx_buf.len()
    }

    /// Get the length of the RX buffer
    pub fn rx_len(&self) -> usize {
        self.rx_buf.len()
    }

    /// Mock send data via CMIO and receive a response.
    /// This function simulates the host side of a vsock connection.
    pub fn send_cmio(&mut self, tx_data: &[u8], _domain: u16) -> Result<Vec<u8>> {
        if tx_data.len() > self.tx_len() {
            return Err(CmioError::InvalidArgument);
        }

        if !tx_data.is_empty() {
            if let Some(hdr) = VirtioVsockHdr::from_bytes(tx_data) {
                return match hdr.op {
                    VSOCK_OP_RESPONSE => {
                        // Connection is established. Store response for the host.
                        self.pending_responses.insert(hdr.dst_port, tx_data.to_vec());
                        Ok(Vec::new())
                    }
                    VSOCK_OP_RW => {
                        // For data coming from the guest, we can just acknowledge
                        Ok(Vec::new())
                    }
                    VSOCK_OP_REQUEST => {
                        // Host is sending a request. Store it.
                        self.pending_requests.push(tx_data.to_vec());
                        if let Some(response) = self.pending_responses.remove(&hdr.src_port) {
                            Ok(response)
                        } else {
                            Ok(Vec::new())
                        }
                    }
                    _ => Ok(Vec::new()),
                };
            }
        }

        if !self.pending_requests.is_empty() {
            return Ok(self.pending_requests.remove(0));
        }

        Ok(Vec::new())
    }
}

impl Drop for CmioIoDriver {
    fn drop(&mut self) {
        // Nothing to do for the mock
    }
}