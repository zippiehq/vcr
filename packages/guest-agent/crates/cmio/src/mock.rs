use super::{CmioError, Result, CmioYield};
use vsock_protocol::{
    VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW, VSOCK_TYPE_STREAM,
};

const GUEST_CID: u32 = 5;
const HOST_CID: u32 = 3;
const HOST_PORT: u32 = 9000;
const CLIENT_PORT: u32 = 1025; // An ephemeral port for the client

/// Mock IO driver for CMIO operations for development/testing on non-Linux hosts.
pub struct CmioIoDriver {
    tx_buf: Vec<u8>,
    rx_buf: Vec<u8>,
    is_established: bool,
}

impl CmioIoDriver {
    /// Initialize the mock CMIO driver.
    /// This will immediately prepare a vsock connection request in the RX buffer,
    /// simulating an incoming connection from the host.
    pub fn new() -> Result<Self> {
        let mut driver = CmioIoDriver {
            tx_buf: vec![0; 4096],
            rx_buf: vec![0; 4096],
            is_established: false,
        };
        driver.prepare_connection_request();
        Ok(driver)
    }

    /// Prepares a VSOCK_OP_REQUEST packet and places it in the rx_buf.
    fn prepare_connection_request(&mut self) {
        let request_hdr = VirtioVsockHdr {
            src_cid: HOST_CID,
            dst_cid: GUEST_CID,
            src_port: CLIENT_PORT,
            dst_port: HOST_PORT,
            len: 0,
            type_: VSOCK_TYPE_STREAM,
            op: VSOCK_OP_REQUEST,
            flags: 0,
            buf_alloc: 0,
            fwd_cnt: 0,
        };

        let packet_bytes = request_hdr.to_bytes();
        self.rx_buf.fill(0);
        self.rx_buf[..packet_bytes.len()].copy_from_slice(&packet_bytes);
    }

    /// Prepares a VSOCK_OP_RW packet with a sample payload.
    fn prepare_data_packet(&mut self) {
        let payload = b"hello from mock host";
        let data_hdr = VirtioVsockHdr {
            src_cid: HOST_CID,
            dst_cid: GUEST_CID,
            src_port: CLIENT_PORT,
            dst_port: HOST_PORT,
            len: payload.len() as u32,
            type_: VSOCK_TYPE_STREAM,
            op: VSOCK_OP_RW,
            flags: 0,
            buf_alloc: 0,
            fwd_cnt: 0,
        };
        let mut packet_bytes = data_hdr.to_bytes();
        packet_bytes.extend_from_slice(payload);
        self.rx_buf.fill(0);
        self.rx_buf[..packet_bytes.len()].copy_from_slice(&packet_bytes);
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
        self.tx_slice_mut()[..tx_data.len()].copy_from_slice(tx_data);

        // If the guest sent any data, parse the header.
        if !tx_data.is_empty() {
            if let Some(hdr) = VirtioVsockHdr::from_bytes(tx_data) {
                // If we receive a response to our connection request,
                // we mark the connection as established.
                if hdr.op == VSOCK_OP_RESPONSE && !self.is_established {
                    self.is_established = true;
                }
            }
        }

        // Once the connection is established, the mock will always
        // respond with a data packet. Before that, the rx_buf contains
        // the connection request.
        if self.is_established {
            self.prepare_data_packet();
        }

        Ok(self.rx_buf.clone())
    }
}

impl Drop for CmioIoDriver {
    fn drop(&mut self) {
        // Nothing to do for the mock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vsock_protocol::{VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW};

    #[test]
    fn test_mock_vsock_connection_flow() {
        // 1. Initialize the mock driver.
        // It should immediately prepare a connection request in its rx_buf.
        let mut driver = CmioIoDriver::new().unwrap();
        assert!(!driver.is_established);

        // 2. The guest agent would call `send_cmio` to receive the request.
        // We simulate the first "receive" from the host.
        // The `tx_data` is empty because the guest is just polling for data.
        let received_packet = driver.send_cmio(&[], 1).unwrap();

        // 3. Verify that the received packet is a connection request.
        let request_hdr = VirtioVsockHdr::from_bytes(&received_packet).unwrap();
        assert_eq!(request_hdr.op, VSOCK_OP_REQUEST);
        assert_eq!(request_hdr.dst_port, HOST_PORT);

        // 4. The guest agent would process the request and send a response.
        // We simulate the guest sending back a VSOCK_OP_RESPONSE.
        // The packet is header + a zero-length payload.
        let response_hdr = VirtioVsockHdr {
            src_cid: GUEST_CID,
            dst_cid: HOST_CID,
            src_port: HOST_PORT,
            dst_port: CLIENT_PORT,
            len: 0,
            type_: VSOCK_TYPE_STREAM,
            op: VSOCK_OP_RESPONSE,
            flags: 0,
            buf_alloc: 0,
            fwd_cnt: 0,
        };
        let response_packet = response_hdr.to_bytes();

        // 5. The guest agent calls `send_cmio` again, this time with the response packet.
        let received_data_packet = driver.send_cmio(&response_packet, 1).unwrap();

        // 6. Verify that the connection is now established and we received a data packet.
        assert!(driver.is_established);
        let data_hdr = VirtioVsockHdr::from_bytes(&received_data_packet).unwrap();
        assert_eq!(data_hdr.op, VSOCK_OP_RW);

        // 7. Verify the payload of the data packet.
        let hdr_size = std::mem::size_of::<VirtioVsockHdr>();
        let payload = &received_data_packet[hdr_size..hdr_size + data_hdr.len as usize];
        assert_eq!(payload, b"hello from mock host");
        println!("Received data packet: {:?}", String::from_utf8(payload.to_vec()).unwrap());
    }
} 