use log::{error, info, warn};
use std::io::{self, Write};
use std::thread;
use std::time::Duration;
use vsock::{VsockAddr, VsockStream, VMADDR_CID_HOST};
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW, VSOCK_TYPE_STREAM,
};
const GUEST_PORT: u32 = 9000;
const RETRY_DELAY: Duration = Duration::from_secs(5);

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::init();
    info!("Starting Host Agent");

    // Loop until we can connect to the guest.
    let mut stream = loop {
        info!(
            "Attempting to connect to guest on CID {} port {}",
            VMADDR_CID_HOST, GUEST_PORT
        );
        match VsockStream::connect(&VsockAddr::new(VMADDR_CID_HOST, GUEST_PORT)) {
            Ok(stream) => {
                info!("Successfully connected to guest.");
                break stream;
            }
            Err(e) => {
                error!("Failed to connect to guest: {}. Retrying...", e);
                thread::sleep(RETRY_DELAY);
            }
        }
    };

    // 1. Send connection request
    let local_addr = stream.local_addr()?;
    let peer_addr = stream.peer_addr()?;
    let req_hdr = VirtioVsockHdr {
        src_cid: local_addr.cid(),
        dst_cid: peer_addr.cid(),
        src_port: local_addr.port(),
        dst_port: peer_addr.port(),
        len: 0, // No payload for the request
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_REQUEST,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };
    let req_packet = Packet::new(req_hdr, vec![]);
    send_packet(&mut stream, req_packet)?;

    // 2. Wait for confirmation
    read_response(&mut stream)?;

    // 3. Send data packet
    let payload = b"hello from host-agent";
    let rw_hdr = VirtioVsockHdr {
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
    let rw_packet = Packet::new(rw_hdr, payload.to_vec());
    send_packet(&mut stream, rw_packet)?;

    Ok(())
}

fn send_packet(stream: &mut VsockStream, packet: Packet) -> io::Result<()> {
    let peer_addr = stream.peer_addr()?;
    info!(
        "[{}] Sending packet with op: {}",
        peer_addr,
        packet.hdr().op
    );
    stream.write_all(&packet.to_bytes())
}

fn read_response(stream: &mut VsockStream) -> io::Result<()> {
    match Packet::from_read(stream) {
        Ok(packet) => {
            let (hdr, _) = packet.into_parts();
            if hdr.op == VSOCK_OP_RESPONSE {
                info!("Received VSOCK_OP_RESPONSE from guest. Connection successful.");
            } else {
                warn!("Received unexpected op {} from guest.", hdr.op);
            }
            Ok(())
        }
        Err(e) => {
            error!("Failed to receive response from guest: {}", e);
            Err(e)
        }
    }
}
