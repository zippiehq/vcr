use log::{error, info, warn};
use std::io::{self, Read, Write};
use std::process;
use std::thread;
use vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW, VSOCK_TYPE_STREAM,
};
const HOST_LISTEN_PORT: u32 = 9000;

fn main() {
    env_logger::init();
    info!("Starting Host Agent");

    if let Err(e) = run_agent() {
        error!("Agent failed: {}", e);
        process::exit(1);
    }
}

/// Runs the main logic of the host agent.
fn run_agent() -> Result<(), Box<dyn std::error::Error>> {
    let listener =
        VsockListener::bind(&VsockAddr::new(VMADDR_CID_ANY, HOST_LISTEN_PORT)).map_err(|e| {
            error!("Failed to bind to vsock port {}: {}", HOST_LISTEN_PORT, e);
            e
        })?;

    info!("Host agent is listening on vsock port {}", HOST_LISTEN_PORT);

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let addr = stream.peer_addr().unwrap();
                info!("[{}] Accepted connection from guest.", addr);
                if let Err(e) = handle_guest_stream(stream) {
                    error!("[{}] Error handling guest connection: {}", addr, e);
                }
            }
            Err(e) => {
                error!("Failed to accept incoming vsock connection: {}", e);
            }
        }
    }

    Ok(())
}

/// Handles a raw data stream from the guest agent, echoing back any data it receives.
fn handle_guest_stream(
    mut stream: VsockStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let peer_addr = stream.peer_addr()?;
    info!(
        "[{}] Accepted connection. Waiting for handshake...",
        peer_addr
    );

    // 1. Perform handshake by reading the request and sending a response.
    let req_packet = match Packet::from_read(&mut stream) {
        Ok(p) => p,
        Err(e) => {
            error!("[{}] Failed to read request packet: {}", peer_addr, e);
            return Err(e.into());
        }
    };

    let (req_hdr, _) = req_packet.into_parts(); // Payload from request is ignored.

    if req_hdr.op != VSOCK_OP_REQUEST {
        warn!(
            "[{}] Expected VSOCK_OP_REQUEST, got op {}. Closing connection.",
            peer_addr, req_hdr.op
        );
        return Ok(());
    }

    info!(
        "[{}] Received VSOCK_OP_REQUEST from guest. Sending response.",
        peer_addr
    );

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
        "[{}] Sent VSOCK_OP_RESPONSE to guest. Handshake complete.",
        peer_addr
    );

    for _ in 0..10 {
        // 2. After handshake, send a single packet and read one response.
        let request_payload = b"Test packet from host".to_vec();
        let request_hdr = VirtioVsockHdr {
            src_cid: req_hdr.dst_cid,
            dst_cid: req_hdr.src_cid,
            src_port: req_hdr.dst_port,
            dst_port: req_hdr.src_port,
            len: request_payload.len() as u32,
            type_: VSOCK_TYPE_STREAM,
            op: VSOCK_OP_RW,
            flags: 0,
            buf_alloc: 0,
            fwd_cnt: 0,
        };
        let request_packet = Packet::new(request_hdr, request_payload);

        info!("[{}] Sending a test packet to the guest.", peer_addr);
        stream.write_all(&request_packet.to_bytes())?;

        // Read the response packet from the guest.
        match Packet::from_read(&mut stream) {
            Ok(packet) => {
                info!(
                    "[{}] Received response from guest with op {} and {} bytes of payload.",
                    peer_addr,
                    packet.hdr().op,
                    packet.payload().len()
                );
            }
            Err(e) => {
                error!(
                    "[{}] Failed to read response packet from guest: {}",
                    peer_addr, e
                );
                return Err(e.into());
            }
        };
        thread::sleep(std::time::Duration::from_secs(30));
    }

    info!("[{}] Shutting down stream", peer_addr);
    stream.shutdown(std::net::Shutdown::Both)?;

    Ok(())
}
