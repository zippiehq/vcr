use cmio::CmioIoDriver;
use log::{error, info};
use std::collections::HashMap;
use std::error::Error;
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use vsock::{VsockAddr, VsockStream};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RST, VSOCK_OP_RW,
    VSOCK_OP_SHUTDOWN,
};

const CMIO_QUEUE_ID: u16 = 1;
const RW_BUF_SIZE: usize = 4096;
const LOOP_SLEEP_DURATION: Duration = Duration::from_secs(5);

#[derive(PartialEq, Eq, Hash, Clone, Copy, Debug)]
struct ConnectionKey {
    cid: u32,
    port: u32,
}

impl From<&VirtioVsockHdr> for ConnectionKey {
    fn from(hdr: &VirtioVsockHdr) -> Self {
        Self {
            cid: hdr.src_cid,
            port: hdr.src_port,
        }
    }
}

struct Connection {
    stream: VsockStream,
    request_hdr: VirtioVsockHdr,
}

struct ConnectionManager {
    connections: HashMap<ConnectionKey, Connection>,
    cmio_driver: Arc<Mutex<CmioIoDriver>>,
}

impl ConnectionManager {
    fn new(cmio_driver: Arc<Mutex<CmioIoDriver>>) -> Self {
        Self {
            connections: HashMap::new(),
            cmio_driver,
        }
    }

    fn poll_cmio(&mut self) -> Result<(), Box<dyn Error>> {
        let cmio_bytes = match self
            .cmio_driver
            .lock()
            .unwrap()
            .send_cmio(&[], CMIO_QUEUE_ID)
        {
            Ok(bytes) => bytes,
            Err(e) => {
                error!(target: "guest", "Error polling CMIO for request: {}", e);
                return Ok(());
            }
        };

        if cmio_bytes.is_empty() {
            return Ok(());
        }

        let packet = match Packet::from_bytes(&cmio_bytes) {
            Ok(p) => p,
            Err(_) => {
                info!(target: "guest", "Incomplete packet from CMIO, ignoring.");
                return Ok(());
            }
        };

        self.handle_cmio_packet(packet)
    }

    fn handle_cmio_packet(&mut self, packet: Packet) -> Result<(), Box<dyn Error>> {
        let (hdr, payload) = packet.into_parts();
        info!(target: "guest", "GUEST: RECEIVED NEW PACKET FROM CMIO\n {:?}", hdr);
        let key = ConnectionKey::from(&hdr);

        match hdr.op {
            VSOCK_OP_REQUEST => self.handle_new_connection_request(hdr)?,
            VSOCK_OP_RW => {
                if let Some(connection) = self.connections.get_mut(&key) {
                    if !payload.is_empty() {
                        info!(
                            target: "guest",
                            "GUEST: FORWARDING {} BYTES FROM CMIO TO VSOCK FOR\n {:?}",
                            payload.len(),
                            key
                        );
                        if let Err(e) = connection.stream.write_all(&payload) {
                            error!(target: "guest", "Failed to write to vsock stream for {:?}: {}", key, e);
                        }
                    }
                } else {
                    info!(target: "guest", "Received OP_RW for unknown connection: {:?}. Ignoring.", key);
                }
            }
            VSOCK_OP_RST | VSOCK_OP_SHUTDOWN => {
                info!(target: "guest", "Received OP {} for {:?}, closing connection.", hdr.op, key);
                if let Some(conn) = self.connections.remove(&key) {
                    let _ = conn.stream.shutdown(std::net::Shutdown::Both);
                }
            }
            _ => info!(target: "guest", "Received unhandled OP {} from CMIO. Ignoring.", hdr.op),
        }

        Ok(())
    }

    fn handle_new_connection_request(
        &mut self,
        request_hdr: VirtioVsockHdr,
    ) -> Result<(), Box<dyn Error>> {
        let key = ConnectionKey::from(&request_hdr);
        if self.connections.contains_key(&key) {
            info!(target: "guest", "Connection request for existing key {:?}, ignoring.", key);
            return Ok(());
        }

        info!(target: "guest", "ATTEMPTING TO CONNECT FOR {:?}", key);
        match VsockStream::connect(&VsockAddr::new(request_hdr.dst_cid, request_hdr.dst_port)) {
            Ok(stream) => {
                info!(target: "guest", "Connection to guest vsock successful for {:?}", key);
                stream.set_nonblocking(true)?;
                self.send_response_to_cmio(&request_hdr)?;

                self.connections.insert(
                    key,
                    Connection {
                        stream,
                        request_hdr,
                    },
                );
            }
            Err(e) => {
                error!(target: "guest", "Failed to connect to guest vsock for {:?}: {}", key, e);
                self.send_reset_to_cmio(&request_hdr)?;
            }
        }
        Ok(())
    }

    fn poll_vsock_connections(&mut self) -> Result<(), Box<dyn Error>> {
        let mut read_buf = [0u8; RW_BUF_SIZE];
        let mut to_remove = Vec::new();
        let mut packets_to_send = Vec::new();
        let mut resets_to_send = Vec::new();

        for (key, connection) in &mut self.connections {
            match connection.stream.read(&mut read_buf) {
                Ok(0) => {
                    info!(target: "guest", "Vsock stream closed by peer for {:?}.", key);
                    to_remove.push(*key);
                }
                Ok(n) => {
                    let data = &read_buf[..n];
                    info!(
                        target: "guest",
                        "Received {} bytes from vsock for\n {:?}, forwarding to CMIO.",
                        n, key
                    );
                    let rw_hdr =
                        create_reply_header(&connection.request_hdr, VSOCK_OP_RW, n as u32);
                    let packet_to_cmio = Packet::new(rw_hdr, data.to_vec());
                    packets_to_send.push(packet_to_cmio);

                    info!(
                        target: "guest",
                        "GUEST: ECHOING {} BYTES BACK TO VSOCK FOR\n {:?}",
                        n, key
                    );
                    if let Err(e) = connection.stream.write_all(data) {
                        error!(target: "guest", "Failed to echo to vsock stream for {:?}: {}", key, e);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => {
                    error!(target: "guest", "Error reading from vsock stream for {:?}: {}", key, e);
                    resets_to_send.push(connection.request_hdr);
                    to_remove.push(*key);
                }
            }
        }

        for packet in packets_to_send {
            if let Err(e) = self
                .cmio_driver
                .lock()
                .unwrap()
                .send_cmio(&packet.to_bytes(), CMIO_QUEUE_ID)
            {
                let (hdr, _) = packet.into_parts();
                error!(
                    target: "guest",
                    "Failed to forward data to CMIO for {:?}: {}",
                    ConnectionKey::from(&hdr),
                    e
                );
            }
        }

        for hdr in resets_to_send {
            if let Err(e) = self.send_reset_to_cmio(&hdr) {
                error!(
                    target: "guest",
                    "Failed to send reset for {:?}: {}",
                    ConnectionKey::from(&hdr),
                    e
                );
            }
        }

        for key in to_remove {
            if let Some(conn) = self.connections.remove(&key) {
                let _ = conn.stream.shutdown(std::net::Shutdown::Both);
            }
            info!(target: "guest", "Removed connection {:?}", key);
        }

        Ok(())
    }

    fn send_response_to_cmio(&self, request_hdr: &VirtioVsockHdr) -> Result<(), Box<dyn Error>> {
        info!(
            target: "guest",
            "Sending VSOCK_OP_RESPONSE to CMIO for {:?}",
            ConnectionKey::from(request_hdr)
        );
        let resp_hdr = create_reply_header(request_hdr, VSOCK_OP_RESPONSE, 0);
        let response_packet = Packet::new(resp_hdr, vec![]);
        self.cmio_driver
            .lock()
            .unwrap()
            .send_cmio(&response_packet.to_bytes(), CMIO_QUEUE_ID)?;
        Ok(())
    }

    fn send_reset_to_cmio(&self, request_hdr: &VirtioVsockHdr) -> Result<(), Box<dyn Error>> {
        info!(
            target: "guest",
            "Sending VSOCK_OP_RST to CMIO for {:?}",
            ConnectionKey::from(request_hdr)
        );
        let rst_hdr = create_reply_header(request_hdr, VSOCK_OP_RST, 0);
        let rst_packet = Packet::new(rst_hdr, vec![]);
        self.cmio_driver
            .lock()
            .unwrap()
            .send_cmio(&rst_packet.to_bytes(), CMIO_QUEUE_ID)?;
        Ok(())
    }
}

fn create_reply_header(request_hdr: &VirtioVsockHdr, op: u16, len: u32) -> VirtioVsockHdr {
    VirtioVsockHdr {
        src_cid: request_hdr.dst_cid,
        dst_cid: request_hdr.src_cid,
        src_port: request_hdr.dst_port,
        dst_port: request_hdr.src_port,
        len,
        type_: request_hdr.type_,
        op,
        flags: 0,
        buf_alloc: request_hdr.buf_alloc,
        fwd_cnt: 0,
    }
}

/// Runs the main logic of the guest agent.
pub fn run_agent(cmio_driver: Arc<Mutex<CmioIoDriver>>) -> Result<(), Box<dyn Error>> {
    info!(target: "guest", "GUEST AGENT STARTED");
    let mut manager = ConnectionManager::new(cmio_driver);

    loop {
        if let Err(e) = manager.poll_vsock_connections() {
            error!(target: "guest", "Error polling vsock connections: {}", e);
        }

        if let Err(e) = manager.poll_cmio() {
            error!(target: "guest", "Error polling CMIO: {}", e);
        }

        thread::sleep(LOOP_SLEEP_DURATION);
    }
}
