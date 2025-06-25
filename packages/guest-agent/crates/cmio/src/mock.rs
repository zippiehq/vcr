use super::{CmioError, Result, CmioYield};

/// Mock IO driver for CMIO operations for development/testing on non-Linux hosts.
pub struct CmioIoDriver {
    tx_buf: Vec<u8>,
    rx_buf: Vec<u8>,
}

impl CmioIoDriver {
    /// Initialize the mock CMIO driver
    pub fn new() -> Result<Self> {
        Ok(CmioIoDriver {
            tx_buf: vec![0; 4096],
            // This buffer now simulates the CMIO device providing a string payload.
            rx_buf: b"cartesi machine cmio output".to_vec(),
        })
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

    /// Mock send data via CMIO and receive a response
    pub fn send_cmio(&mut self, tx_data: &[u8], _domain: u16) -> Result<Vec<u8>> {
        if tx_data.len() > self.tx_len() {
            return Err(CmioError::InvalidArgument);
        }
        self.tx_slice_mut()[..tx_data.len()].copy_from_slice(tx_data);
        Ok(self.rx_buf.clone())
    }
}

impl Drop for CmioIoDriver {
    fn drop(&mut self) {
        // Nothing to do for the mock
    }
} 