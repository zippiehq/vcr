use cmio::CmioIoDriver;
use log::{error, info};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process;
use vsock::{VsockAddr, VsockStream, VMADDR_CID_LOCAL};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW, VSOCK_TYPE_STREAM,
};

enum ConnectionState {
    Handshake,
    Established,
}

struct Connection {
    stream: VsockStream,
    state: ConnectionState,
    connection_request_hdr: VirtioVsockHdr,
}

fn main() {
    env_logger::init();
    info!("Starting Guest Agent Proxy");

    if let Err(e) = run_agent() {
        error!("Agent failed: {}", e);
        process::exit(1);
    }
}

/// Runs the main logic of the guest agent.
fn run_agent() -> Result<(), Box<dyn std::error::Error>> {
    let mut driver = CmioIoDriver::new()?;
    info!("CMIO driver initialized successfully");

    let mut connections: HashMap<u32, Connection> = HashMap::new();
    let mut read_buf = [0u8; 4096];

    loop {
        // Step 1: Poll CMIo for incoming data
        if let Ok(cmio_bytes) = driver.send_cmio(&[], 1) {
            if !cmio_bytes.is_empty() {
                if let Ok(packet) = Packet::from_bytes(&cmio_bytes) {
                    let (hdr, payload) = packet.into_parts();
                    let port = hdr.dst_port;

                    if hdr.op == VSOCK_OP_REQUEST
                        && hdr.type_ == VSOCK_TYPE_STREAM
                        && !connections.contains_key(&port)
                    {
                        // New connection
                        info!("[{}] New connection request from CMIO. Attempting to connect to host...", port);
                        match VsockStream::connect(&VsockAddr::new(VMADDR_CID_LOCAL, port)) {
                            Ok(mut stream) => {
                                info!("[{}] Vsock connection to host successful. Performing handshake...", port);
                                stream.set_nonblocking(true)?;
                                let request_packet = Packet::new(hdr, payload);
                                if stream.write_all(&request_packet.to_bytes()).is_ok() {
                                    connections.insert(
                                        port,
                                        Connection {
                                            stream,
                                            state: ConnectionState::Handshake,
                                            connection_request_hdr: hdr,
                                        },
                                    );
                                } else {
                                    error!("[{}] Failed to send handshake request to host.", port);
                                }
                            }
                            Err(e) => error!("[{}] Failed to connect to host: {}", port, e),
                        }
                    } else if let Some(conn) = connections.get_mut(&port) {
                        // Data for existing connection
                        if !payload.is_empty() {
                            info!(
                                "[{}] Forwarding {} bytes from CMIO to host.",
                                port,
                                payload.len()
                            );
                            if let Err(e) = conn.stream.write_all(&payload) {
                                error!("[{}] Failed to write to vsock stream: {}", port, e);
                            }
                        }
                    }
                }
            }
        }

        // Step 2: Poll vsock streams for data and state changes
        let mut closed_ports = Vec::new();
        for (&port, conn) in connections.iter_mut() {
            match conn.stream.read(&mut read_buf) {
                Ok(0) => {
                    info!("[{}] Vsock stream closed by peer.", port);
                    closed_ports.push(port);
                }
                Ok(n) => {
                    let data = &read_buf[..n];
                    match conn.state {
                        ConnectionState::Handshake => {
                            info!("[{}] Received handshake confirmation from host.", port);
                            let req_hdr = conn.connection_request_hdr;
                            let resp_hdr = VirtioVsockHdr {
                                src_cid: req_hdr.dst_cid,
                                dst_cid: req_hdr.src_cid,
                                src_port: req_hdr.dst_port,
                                dst_port: req_hdr.src_port,
                                len: 0,
                                type_: req_hdr.type_,
                                op: VSOCK_OP_RESPONSE,
                                flags: 0,
                                buf_alloc: req_hdr.buf_alloc,
                                fwd_cnt: 0,
                            };

                            let response_packet = Packet::new(resp_hdr, vec![]);
                            info!("[{}] Sending handshake response to CMIO.", port);
                            if let Err(e) = driver.send_cmio(&response_packet.to_bytes(), 1) {
                                error!(
                                    "[{}] Failed to send handshake response to CMIO: {}",
                                    port, e
                                );
                            } else {
                                conn.state = ConnectionState::Established;
                                info!("[{}] Connection established.", port);
                            }
                        }
                        ConnectionState::Established => {
                            info!("[{}] Forwarding {} bytes from host to CMIO.", port, n);
                            if let Err(e) =
                                forward_vsock_to_cmio(&mut conn.stream, &mut driver, port, data, conn.connection_request_hdr)
                            {
                                error!("[{}] Failed to forward data to CMIO: {}", port, e);
                            }
                        }
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        error!("[{}] Error reading from vsock stream: {}", port, e);
                        closed_ports.push(port);
                    }
                }
            }
        }

        for port in closed_ports {
            info!("[{}] Closing connection.", port);
            connections.remove(&port);
        }
    }
}

/// Forwards data from the vsock stream to the CMIo driver.
fn forward_vsock_to_cmio(
    stream: &mut VsockStream,
    driver: &mut CmioIoDriver,
    port: u32,
    payload: &[u8],
    connection_request_hdr: VirtioVsockHdr,
) -> Result<(), Box<dyn std::error::Error>> {
    info!(
        "[{}] Read {} bytes from host, sending to CMIO",
        port,
        payload.len()
    );

    let hdr = VirtioVsockHdr {
        src_cid: connection_request_hdr.dst_cid,
        dst_cid: connection_request_hdr.src_cid,
        src_port: connection_request_hdr.dst_port,
        dst_port: connection_request_hdr.src_port,
        len: payload.len() as u32,
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_RW,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };

    let packet = Packet::new(hdr, payload.to_vec());
    let cmio_response = driver.send_cmio(&packet.to_bytes(), 1)?;

    if !cmio_response.is_empty() {
        let packet = Packet::from_bytes(&cmio_response)?;
        info!(
            "[{}] Received response from CMIO with op {}, forwarding to host.",
            port,
            packet.hdr().op
        );
        stream.write_all(packet.payload())?;
    }
    Ok(())
}
