use cartesi_machine::machine::Machine;
use cartesi_machine::types::cmio::{
    AutomaticReason, CmioRequest, CmioResponseReason, ManualReason,
};
use log::info;
use std::error::Error;
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RST, VSOCK_TYPE_STREAM,
};

const GUEST_CID: u32 = 1;
const HOST_CID: u32 = 3;
const HOST_PORT: u32 = 1025;

pub fn send_packet(
    machine: &mut Machine,
    guest_port: u32,
    op: u16,
    payload: &[u8],
) -> Result<(), Box<dyn Error>> {
    info!("Crafting vsock packet with op {}", op);

    let hdr = VirtioVsockHdr {
        src_cid: HOST_CID,
        dst_cid: GUEST_CID,
        src_port: HOST_PORT,
        dst_port: guest_port,
        len: payload.len() as u32,
        type_: VSOCK_TYPE_STREAM,
        op,
        flags: 0,
        buf_alloc: 0,
        fwd_cnt: 0,
    };

    let packet = Packet::new(hdr, payload.to_vec());
    let packet_bytes = packet.to_bytes();

    info!("Sending vsock packet hdr {:?} payload {:?}", hdr, payload);
    machine.send_cmio_response(CmioResponseReason::Advance, &packet_bytes)?;
    Ok(())
}

pub fn vsock_connect(machine: &mut Machine, guest_port: u32) -> Result<(), Box<dyn Error>> {
    info!(
        "Attempting to connect to guest vsock port {}...",
        guest_port
    );
    run_machine_until_yield(machine)?;
    send_packet(machine, guest_port, VSOCK_OP_REQUEST, &[])?;
    loop {
        run_machine_until_yield(machine)?;
        info!("Machine cycle = {}", machine.mcycle().unwrap());
        match receive_packet(machine)? {
            Some(packet) => {
                if packet.hdr().op == VSOCK_OP_RESPONSE {
                    info!("Vsock connection established!");
                    return Ok(());
                } else if packet.hdr().op == VSOCK_OP_RST {
                    info!("Connection reset by peer, retrying...");
                } else {
                    info!("Unsuccessful connection attempt, aborting.");
                    return Err("Failed to connect".into());
                }
            }
            None => {
                info!("No packet received in response to connection request, looping around.");
                //                return Err("Connection timeout".into());
            }
        }
        machine.send_cmio_response(CmioResponseReason::Advance, &[])?;

        //sleep(Duration::from_secs(1));
    }
}

/// Runs the machine until it yields for a CMIO request.
pub fn run_machine_until_yield(
    machine: &mut Machine,
) -> Result<cartesi_machine::types::BreakReason, Box<dyn Error>> {
    loop {
        let reason = machine.run(u64::MAX)?;
        if machine.iflags_y()? {
            info!(
                "Machine yielded for CMIO request., cycle {}",
                machine.mcycle().unwrap()
            );
            return Ok(reason);
        } else {
            info!("Machine yielded with reason: {:?}, continuing.", reason);
        }
    }
}

pub fn send_empty_response(machine: &mut Machine) -> Result<(), Box<dyn Error>> {
    machine.send_cmio_response(CmioResponseReason::Advance, &[])?;
    Ok(())
}

/// Receives a vsock packet from the machine.
pub fn receive_packet(machine: &mut Machine) -> Result<Option<Packet>, Box<dyn Error>> {
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
        if !data.is_empty() {
            match Packet::from_bytes(&data) {
                Ok(packet) => {
                    info!(
                        "Successfully parsed vsock packet from response: {:?}",
                        packet
                    );
                    return Ok(Some(packet));
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

    Ok(None)
}
