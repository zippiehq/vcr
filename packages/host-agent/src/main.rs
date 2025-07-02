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
        "[{}] Received VSOCK_OP_REQUEST from guest. Sending response.",
        peer_addr
    );

    stream.write_all(&[])?;
    info!(
        "[{}] Sent VSOCK_OP_RESPONSE to guest. Handshake complete.",
        peer_addr
    );

    let mut buf = [0; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => {
                info!("[{}] Guest closed the connection.", peer_addr);
                break;
            }
            Ok(n) => {
                info!("[{}] Received {} bytes, echoing back.", peer_addr, n);
                if let Err(e) = stream.write_all(&buf[..n]) {
                    error!(
                        "[{}] Failed to write to vsock stream, closing connection: {}",
                        peer_addr, e
                    );
                    break;
                }
            }
            Err(e) => {
                error!(
                    "[{}] Failed to read from vsock stream, closing connection: {}",
                    peer_addr, e
                );
                break;
            }
        }
    }

    info!("[{}] Shutting down stream", peer_addr);
    stream.shutdown(std::net::Shutdown::Both)?;

    Ok(())
}
