use cmio::CmioIoDriver;
use log::{error, info};
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};
const BUFFER_SIZE: usize = 4096;
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_TYPE_STREAM,
};

/// Runs the main logic of the host agent.
pub fn run_agent(
    cmio_driver: Arc<Mutex<CmioIoDriver>>,
    host_cid: u32,
    host_port: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let listener = VsockListener::bind(&VsockAddr::new(VMADDR_CID_ANY, host_port))?;
    info!(target: "host", "HOST AGENT STARTED.");
    info!(target: "host", "LISTENING ON THE PORT: {} CID: {}", host_port, host_cid);

    let request_hdr = VirtioVsockHdr {
        src_cid: host_cid,
        dst_cid: host_cid,
        src_port: host_port,
        dst_port: host_port,
        len: 0,
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_REQUEST,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };
    let request_packet = Packet::new(request_hdr, vec![]);
    let request_bytes = request_packet.to_bytes();

    loop {
        let response_bytes = {
            let mut driver = cmio_driver.lock().unwrap();
            driver.send_cmio(&request_bytes, 1)?
        };

        if !response_bytes.is_empty() {
            if let Ok(packet) = Packet::from_bytes(&response_bytes) {
                if packet.hdr().op == VSOCK_OP_RESPONSE {
                    info!(target: "host", "HOST: QUERY OP_RESPONSE SUCCESSFUL. CONTINUING WITH VSock CONNECTION.");
                    break;
                }
            }
        }

        info!(target: "host", "HOST: QUERY OP_RESPONSE FAILED, RETRYING IN 5 SECONDS...");
        thread::sleep(Duration::from_secs(5));
    }

    let (stream, _addr) = listener.accept()?;
    handle_host_stream(stream)
}

/// Handles a raw data stream from the guest agent, echoing back any data it receives.
fn handle_host_stream(mut stream: VsockStream) -> Result<(), Box<dyn std::error::Error>> {
    let peer = stream.peer_addr()?;

    let message = format!("hello from host {}:{}", peer.cid(), peer.port());
    info!(
        target: "host",
        "HOST: SENDING {} BYTES TO GUEST: {}:{}",
        message.len(),
        peer.cid(),
        peer.port()
    );
    stream.write_all(message.as_bytes())?;

    let mut buf = [0; BUFFER_SIZE];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => {
                info!(target: "host", "[{}:{}] Connection closed by peer", peer.cid(), peer.port());
                break;
            }
            Ok(n) => {
                info!(target: "host", "HOST: RECEIVED {} BYTES FROM GUEST.", n);
                info!(target: "host", "HOST: ECHOING BACK TO GUEST.");
                stream.write_all(&buf[..n])?;
            }
            Err(e) => {
                error!(
                    target: "host",
                    "[{}:{}] Failed to read from stream: {}",
                    peer.cid(),
                    peer.port(),
                    e
                );
                break;
            }
        }
    }

    info!(target: "host", "[{}:{}] Shutting down stream", peer.cid(), peer.port());
    stream.shutdown(std::net::Shutdown::Both)?;

    Ok(())
}
