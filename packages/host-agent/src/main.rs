use log::{info, error};
use tokio::io::{AsyncReadExt, ReadHalf};
use tokio::signal;
use tokio::io;
use tokio_vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};
use vsock_protocol::{VirtioVsockHdr, HDR_SIZE};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    let port = 6000;
    info!("Starting Host Agent, listening on vsock port {}", port);
    info!("Press Ctrl+C to shut down.");

    let listener = VsockListener::bind(VsockAddr::new(VMADDR_CID_ANY, port))?;

    tokio::select! {
        _ = server_loop(listener) => {
            error!("Server loop unexpectedly exited.");
        },
        _ = signal::ctrl_c() => {
            info!("Ctrl+C received, shutting down Host Agent.");
        }
    }

    Ok(())
}

/// Listens for and accepts new vsock connections from guests.
async fn server_loop(mut listener: VsockListener) {
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                info!("[{:?}] Accepted connection from Guest Agent.", addr);
                tokio::spawn(handle_connection(stream, addr));
            }
            Err(e) => {
                error!("Failed to accept connection: {}", e);
            }
        }
    }
}

/// Manages a single guest connection, processing packets in a loop.
async fn handle_connection(stream: VsockStream, addr: VsockAddr) {
    let (mut reader, _) = io::split(stream);

    loop {
        match process_packet(&mut reader, &addr).await {
            Ok(_) => {
                // Successfully processed a packet, continue to the next one.
            }
            Err(e) => {
                // An error occurred (e.g., client disconnected).
                info!("[{:?}] Closing connection: {}", addr, e);
                break;
            }
        }
    }
}

/// Reads and parses a single packet (header + payload) from the stream.
async fn process_packet(reader: &mut ReadHalf<VsockStream>, addr: &VsockAddr) -> Result<(), io::Error> {
    // 1. Read the fixed-size header.
    let mut hdr_buf = vec![0; HDR_SIZE];
    reader.read_exact(&mut hdr_buf).await?;

    // 2. Parse the header.
    let hdr = VirtioVsockHdr::from_bytes(&hdr_buf)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Failed to parse vsock header"))?;
    info!("[{:?}] Received header: {:?}", addr, hdr);

    // 3. Read the payload based on the length specified in the header.
    let mut payload_buf = vec![0; hdr.len as usize];
    reader.read_exact(&mut payload_buf).await?;
    
    let received = String::from_utf8_lossy(&payload_buf);
    info!("[{:?}] Received payload: {}", addr, received);

    Ok(())
} 