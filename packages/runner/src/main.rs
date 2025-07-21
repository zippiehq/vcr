use colored::*;
use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;

use cartesi_machine::{
    config::runtime::RuntimeConfig,
    error::MachineError,
    machine::Machine,
    types::{
        cmio::{AutomaticReason, CmioRequest, CmioResponseReason, ManualReason},
        BreakReason,
    },
};
use std::thread::sleep;
use std::time::Duration;
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RST, VSOCK_TYPE_STREAM,
};

const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";

const HOST_CID: u32 = 3;
const GUEST_CID: u32 = 1;
const HOST_PORT: u32 = 1025;
const GUEST_PORT: u32 = 8022;

fn setup_logger() {
    let mut builder = Builder::new();
    builder
        .format(|buf, record| {
            writeln!(
                buf,
                "{} [{}] - {}",
                buf.timestamp(),
                record.level(),
                record.args().to_string().blue()
            )
        })
        .filter(None, LevelFilter::Info)
        .init();
}

fn run_machine_until_yield(machine: &mut Machine) -> Result<BreakReason, MachineError> {
    loop {
        let reason = machine.run(u64::MAX)?;
        if machine.iflags_y()? {
            info!("Machine yielded for CMIO request.");
            return Ok(reason);
        } else {
            info!("Machine yielded with reason: {:?}, continuing.", reason);
        }
    }
}

fn send_connect_request(machine: &mut Machine) -> Result<(), Box<dyn Error>> {
    info!("Crafting vsock connection request for port {}", GUEST_PORT);

    let hdr = VirtioVsockHdr {
        src_cid: HOST_CID,
        dst_cid: GUEST_CID,
        src_port: HOST_PORT,
        dst_port: GUEST_PORT,
        len: 0,
        type_: VSOCK_TYPE_STREAM,
        op: VSOCK_OP_REQUEST,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };

    let packet = Packet::new(hdr, vec![]);
    let packet_bytes = packet.to_bytes();

    info!("Sending vsock connection request packet");
    machine.send_cmio_response(CmioResponseReason::Advance, &packet_bytes)?;
    Ok(())
}

fn receive_and_log_response(machine: &mut Machine) -> Result<Packet, Box<dyn Error>> {
    let request = machine.receive_cmio_request()?;
    info!("Received a CMIO request from guest.");

    let cmio_data = match request {
        CmioRequest::Automatic(AutomaticReason::TxOutput { data }) => Some(data),
        CmioRequest::Manual(ManualReason::GIO { data, .. }) => Some(data),
        _ => {
            info!("Received CMIO request without data payload: {:?}", request);
            None
        }
    };

    if let Some(data) = cmio_data {
        if data.len() > 0 {
            match Packet::from_bytes(&data) {
                Ok(packet) => {
                    info!(
                        "Successfully parsed vsock packet from response: {:?}",
                        packet
                    );
                    let response_str = String::from_utf8_lossy(packet.payload());
                    info!(
                        "--- GUEST RESPONSE ---\n{}\n----------------------",
                        response_str
                    );
                    return Ok(packet);
                }
                Err(e) => {
                    info!("Failed to parse vsock packet from CMIO data: {:?}", e);
                    info!("Raw CMIO data (bytes): {:?}", data);
                }
            }
        } else {
            info!("No data received from guest.");
        }
    }

    Err(Box::new(std::io::Error::new(
        std::io::ErrorKind::Other,
        "No packet received",
    )))
}

fn handle_connection(machine: &mut Machine) -> Result<(), Box<dyn Error>> {
    info!("Vsock connection established.");
    loop {
        info!("Connection active, running machine...");
        run_machine_until_yield(machine)?;
        match receive_and_log_response(machine) {
            Ok(packet) => {
                let (hdr, _) = packet.into_parts();
                if hdr.op == VSOCK_OP_RST {
                    info!("Received VSOCK_OP_RST, connection closed by peer.");
                    break;
                }
            }
            Err(e) => {
                info!("Error on active connection: {}. Closing connection.", e);
                break;
            }
        }
        sleep(Duration::from_secs(1));
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;

    run_machine_until_yield(&mut machine)?;

    loop {
        info!("Attempting to establish vsock connection...");
        send_connect_request(&mut machine)?;

        info!("Running machine to process connection request...");
        run_machine_until_yield(&mut machine)?;

        match receive_and_log_response(&mut machine) {
            Ok(packet) => {
                let (hdr, _) = packet.into_parts();
                if hdr.op == VSOCK_OP_RESPONSE {
                    handle_connection(&mut machine)?;
                    info!("Connection closed. Will attempt to reconnect...");
                } else {
                    info!(
                        "Received unexpected packet with op {} during connection setup. Retrying...",
                        hdr.op
                    );
                }
            }
            Err(e) => {
                info!("Failed to receive connection response: {}. Retrying...", e);
            }
        }
        sleep(Duration::from_secs(1));
    }
}
