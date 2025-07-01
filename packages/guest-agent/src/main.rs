use cmio::CmioIoDriver;
use log::{error, info, warn};
use std::io::{Read, Write};
use std::process;
use std::sync::{Arc, Mutex};
use std::thread;
use vsock::{VsockAddr, VsockStream, VMADDR_CID_HOST};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_TYPE_STREAM,
};

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
    let driver = Arc::new(Mutex::new(CmioIoDriver::new()?));
    info!("CMIO driver initialized successfully");

    // The agent will handle one connection at a time.
    // The main loop waits for a connection request, handles it, and then returns
    // to this state to wait for the next one.
    info!("Waiting for a connection request from CMIo...");
    let (req_hdr, _) = wait_for_cmio_request(driver.clone())?;

    let peer_port = req_hdr.dst_port;
    info!(
        "Received connection request from CMIO for port {}. Attempting to connect to host...",
        peer_port
    );

    match VsockStream::connect(&VsockAddr::new(VMADDR_CID_HOST, peer_port)) {
        Ok(stream) => {
            info!("[{}] Vsock connection to host successful.", peer_port);
            if let Err(e) = handle_connection(stream, req_hdr, driver.clone()) {
                error!("[{}] Connection handling failed: {}", peer_port, e);
            }
            
            info!("[{}] Connection closed.", peer_port);
        }
        Err(e) => {
            error!(
                "[{}] Failed to connect to host on port {}: {}",
                peer_port, peer_port, e
            );
        }
    };
    Ok(())
}

/// Blocks until a `VSOCK_OP_REQUEST` packet is read from the CMIo driver.
fn wait_for_cmio_request(
    driver: Arc<Mutex<CmioIoDriver>>,
) -> Result<(VirtioVsockHdr, Vec<u8>), Box<dyn std::error::Error>> {
    loop {
        // Poll request to connect to host from CMIO each 10 seconds
        let packet_bytes = driver.lock().unwrap().send_cmio(&[], 1)?;

        if packet_bytes.is_empty() {
            continue;
        }

        let packet = Packet::from_bytes(&packet_bytes)?;
        return Ok(packet.into_parts());
    }
}

/// Handles a newly established connection by proxying data in both directions.
fn handle_connection(
    mut stream: VsockStream,
    req_hdr: VirtioVsockHdr,
    driver: Arc<Mutex<CmioIoDriver>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = req_hdr.dst_port;
    info!("[{}] Performing vsock handshake with host...", port);

    let request_packet = Packet::new(req_hdr, vec![]);
    stream.write_all(&request_packet.to_bytes())?;

    // Wait for a response from the host.
    let response_packet = Packet::from_read(&mut stream)?;
    if response_packet.hdr().op != VSOCK_OP_RESPONSE {
        warn!(
            "[{}] Expected VSOCK_OP_RESPONSE, but got op {}",
            port,
            response_packet.hdr().op
        );
    } else {
        info!("[{}] Received vsock handshake response from host.", port);
    }

    // After the handshake, we enter a loop to proxy data between the host and
    // the CMIo device.
    loop {
        // Read a packet from the vsock stream (from the host).
        let host_packet = match Packet::from_read(&mut stream) {
            Ok(packet) => {
                info!(
                    "[{}] Received packet from host: {:?}, payload_len: {}",
                    port,
                    packet.hdr(),
                    packet.payload().len()
                );
                packet
            }
            Err(e) => {
                // An error here likely means the host has closed the connection.
                info!(
                    "[{}] Failed to read from vsock stream, assuming connection closed: {}",
                    port, e
                );
                break;
            }
        };

        // Forward the packet to the CMIo device and get a response.
        let cmio_response_bytes =
            driver.lock().unwrap().send_cmio(&host_packet.to_bytes(), 1)?;

        if cmio_response_bytes.is_empty() {
            warn!("[{}] Received empty response from CMIO.", port);
            continue;
        }

        // Forward the response from the CMIo device back to the host.
        if let Err(e) = stream.write_all(&cmio_response_bytes) {
            error!(
                "[{}] Failed to write to vsock stream, closing connection: {}",
                port, e
            );
            break;
        }
    }

    Ok(())
}
