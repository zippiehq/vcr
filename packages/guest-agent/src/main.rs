use cmio::CmioIoDriver;
use log::{error, info};
use std::process;
use tokio::io::{self, AsyncWriteExt};
use tokio_vsock::{VsockAddr, VsockStream, VMADDR_CID_HOST};
use vsock_protocol::{VirtioVsockHdr, VSOCK_OP_RW, VSOCK_TYPE_STREAM};

#[tokio::main]
async fn main() {
    env_logger::init();
    info!("Starting Guest Agent");

    if let Err(e) = run_agent().await {
        error!("Agent failed: {}", e);
        process::exit(1);
    }
}

/// Runs the main logic of the guest agent.
async fn run_agent() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize the CMIO driver.
    let mut driver = CmioIoDriver::new()?;
    info!("CMIO driver initialized successfully");

    // 2. Get a data payload from the (mock) CMIO device.
    let payload_from_cmio = driver.send_cmio(b"get_data", 1)?;
    info!(
        "Received payload from CMIO: \"{}\"",
        String::from_utf8_lossy(&payload_from_cmio)
    );

    // 3. Define a fixed vsock port to connect to the host agent.
    let host_port = 6000;

    // 4. Connect to the host and send the payload received from CMIO.
    connect_and_send(host_port, &payload_from_cmio).await?;

    Ok(())
}

/// Establishes a vsock connection and sends a packet.
async fn connect_and_send(port: u32, payload: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    info!("Attempting to connect to host on vsock port {}...", port);
    let mut stream = VsockStream::connect(VsockAddr::new(VMADDR_CID_HOST, port)).await?;
    info!("Successfully connected to host via vsock.");

    send_vsock_packet(&mut stream, payload).await?;
    Ok(())
}

/// Constructs and sends a single virtio vsock packet.
async fn send_vsock_packet(
    stream: &mut VsockStream,
    payload: &[u8],
) -> Result<(), io::Error> {
    let local_addr = stream.local_addr()?;
    let peer_addr = stream.peer_addr()?;

    let hdr = VirtioVsockHdr {
        src_cid: local_addr.cid(),
        dst_cid: peer_addr.cid(),
        src_port: local_addr.port(),
        dst_port: peer_addr.port(),
        len: payload.len() as u32,
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_RW,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };

    // Combine header and payload into a single packet to send.
    let mut packet = hdr.to_bytes();
    packet.extend_from_slice(payload);

    stream.write_all(&packet).await?;
    info!("Successfully sent packet to host.");
    Ok(())
} 