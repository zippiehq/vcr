use cmio::CmioIoDriver;
use log::{error, info, warn};
use std::cell::RefCell;
use std::io::{self, Write};
use std::process;
use std::rc::Rc;
use vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW, VSOCK_TYPE_STREAM,
};

const GUEST_LISTEN_PORT: u32 = 9000;

fn main() {
    env_logger::init();
    info!("Starting Guest Agent");

    if let Err(e) = run_agent() {
        error!("Agent failed: {}", e);
        process::exit(1);
    }
}

/// Runs the main logic of the guest agent.
fn run_agent() -> Result<(), Box<dyn std::error::Error>> {
    let driver = Rc::new(RefCell::new(CmioIoDriver::new()?));
    info!("CMIO driver initialized successfully");

    let listener = VsockListener::bind(&VsockAddr::new(VMADDR_CID_ANY, GUEST_LISTEN_PORT))
        .map_err(|e| {
            error!("Failed to bind to vsock port {}: {}", GUEST_LISTEN_PORT, e);
            e
        })?;

    info!(
        "Guest agent is listening on vsock port {}",
        GUEST_LISTEN_PORT
    );

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let addr = stream.peer_addr().unwrap();
                info!("[{}] Accepted connection from host.", addr);
                if let Err(e) = handle_host_stream(stream, driver.clone()) {
                    error!("[{}] Error handling host connection: {}", addr, e);
                }
            }
            Err(e) => {
                error!("Failed to accept incoming vsock connection: {}", e);
            }
        }
    }

    Ok(())
}

/// Forwards packets from a host vsock stream to the CMIO driver.
fn handle_host_stream(
    mut stream: VsockStream,
    driver: Rc<RefCell<CmioIoDriver>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let peer_addr = stream.peer_addr()?;

    // 1. Perform handshake by reading the request and sending a response.
    let req_packet = match Packet::from_read(&mut stream) {
        Ok(p) => p,
        Err(e) => {
            if e.kind() != io::ErrorKind::UnexpectedEof {
                error!("[{}] Failed to read request packet: {}", peer_addr, e);
            }
            return Err(e.into());
        }
    };

    let (req_hdr, _) = req_packet.into_parts(); // Payload from request is ignored.

    if req_hdr.op != VSOCK_OP_REQUEST {
        warn!(
            "[{}] Expected VSOCK_OP_REQUEST, got op {}. Ignoring.",
            peer_addr, req_hdr.op
        );
        return Ok(());
    }

    info!("[{}] Received VSOCK_OP_REQUEST from host.", peer_addr);

    let resp_hdr = VirtioVsockHdr {
        src_cid: req_hdr.dst_cid,
        dst_cid: req_hdr.src_cid,
        src_port: req_hdr.dst_port,
        dst_port: req_hdr.src_port,
        len: 0,
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_RESPONSE,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };
    let resp_packet = Packet::new(resp_hdr, vec![]);
    stream.write_all(&resp_packet.to_bytes())?;
    info!(
        "[{}] Sent VSOCK_OP_RESPONSE to host. Connection established.",
        peer_addr
    );

    // 2. After handshake, loop for data packets (OP_RW).
    loop {
        match Packet::from_read(&mut stream) {
            Ok(packet) => {
                let (hdr, payload) = packet.into_parts();
                if hdr.op == VSOCK_OP_RW {
                    info!(
                        "[{}] Received VSOCK_OP_RW with payload: '{:?}'",
                        peer_addr, payload
                    );

                    let packet_bytes = Packet::new(hdr, payload).to_bytes();
                    let domain = 1;
                    let cmio_response = driver.borrow_mut().send_cmio(&packet_bytes, domain)?;

                    // TODO: cmio response handling
                    info!("[{}] Forwarded RW packet to CMIO.", peer_addr);
                } else {
                    warn!("[{}] Received unhandled op: {}", peer_addr, hdr.op);
                }
            }
            Err(e) => {
                if e.kind() == io::ErrorKind::UnexpectedEof {
                    info!("[{}] Connection closed by host.", peer_addr);
                } else {
                    error!("[{}] Error reading vsock packet: {}", peer_addr, e);
                }
                break;
            }
        }
    }

    info!("[{}] Stream handling finished.", peer_addr);
    Ok(())
}
