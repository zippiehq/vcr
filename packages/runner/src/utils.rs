use cartesi_machine::machine::Machine;
use cartesi_machine::types::cmio::{
    AutomaticReason, CmioRequest, CmioResponseReason, ManualReason,
};
use log::{error, info};
use std::collections::HashMap;
use std::error::Error;
use vsock_protocol::{
    Packet, VirtioVsockHdr, VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RST, VSOCK_OP_RW,
    VSOCK_OP_SHUTDOWN, VSOCK_TYPE_STREAM,
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
    run_machine_until_yield(machine)?;
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

#[derive(Clone)]
struct RunnerListener {
    port: u32,
}

impl RunnerListener {
    fn new(port: u32) -> Self {
        Self { port }
    }

    fn new_connection(&self, connection: RunnerConnection) {
        info!(
            "Listener on port {} received new connection from port {}",
            self.port, connection.port
        );
        // In a real implementation, this might notify a callback or store the connection
    }
}

#[derive(Clone)]
struct RunnerConnectionRequest {
    port: u32,
    open_requested: bool,
}

impl RunnerConnectionRequest {
    fn new(port: u32) -> Self {
        Self {
            port,
            open_requested: false,
        }
    }

    fn connection_successful(&self) {
        info!("Connection request for port {} was successful", self.port);
        // In a real implementation, this might notify a callback or update state
    }

    fn reset_received(&self) {
        info!("Connection request for port {} received reset", self.port);
        // In a real implementation, this might notify a callback or update state
    }
}

#[derive(Clone)]
struct RunnerConnection {
    port: u32,
    read_queue: Vec<Vec<u8>>,
    write_queue: Vec<Vec<u8>>,
}

impl RunnerConnection {
    fn new(port: u32) -> Self {
        Self {
            port,
            read_queue: Vec::new(),
            write_queue: Vec::new(),
        }
    }

    fn reset_received(&mut self) {
        info!("Connection on port {} received reset", self.port);
        self.read_queue.clear();
        self.write_queue.clear();
    }

    fn shutdown_received(&mut self) {
        info!("Connection on port {} received shutdown", self.port);
        // In a real implementation, this might close the connection or notify callbacks
        self.read_queue.clear();
        self.write_queue.clear();
    }
}

pub fn run_machine_loop(machine: &mut Machine) -> Result<(), Box<dyn Error>> {
    let mut listeners: HashMap<u32, RunnerListener> = HashMap::new();
    let mut connections: HashMap<u32, RunnerConnection> = HashMap::new();
    let mut connection_requests: HashMap<u32, RunnerConnectionRequest> = HashMap::new();

    // before running machine loop, let's queue up a connection request for port 8080
    let connection_request = RunnerConnectionRequest::new(8080);
    connection_requests.insert(8080, connection_request);

    loop {
        run_machine_until_yield(machine)?;
        let packet = receive_packet(machine)?;
        if let Some(packet) = packet {
            info!("Received packet: {:?}", packet);
            match packet.hdr().op {
                VSOCK_OP_REQUEST => {
                    info!("Received request packet: {:?}", packet);
                    // Listener scenario
                    // Do we have a listener for this port?
                    // If so, send a response packet
                    // If not, send a reset packet
                    let listener = listeners.get(&packet.hdr().dst_port);
                    if let Some(listener) = listener {
                        info!("Found listener for port: {:?}", listener.port);
                        send_packet(machine, packet.hdr().dst_port, VSOCK_OP_RESPONSE, &[])?;
                        let connection = RunnerConnection::new(packet.hdr().src_port);
                        connections.insert(packet.hdr().src_port, connection.clone());
                        listener.new_connection(connection); // let the listener be aware someone connected
                    } else {
                        info!("No listener found for port: {:?}", packet.hdr().dst_port);
                        // If no listener is found for the requested port, send a reset (RST) packet
                        send_packet(machine, packet.hdr().dst_port, VSOCK_OP_RST, &[])?;
                    }
                }
                VSOCK_OP_RESPONSE => {
                    info!("Received response packet: {:?}", packet);
                    // handle response to a connection request
                    let connection_request = connection_requests.get(&packet.hdr().src_port);
                    if let Some(connection_request) = connection_request {
                        info!(
                            "Found connection request for port: {:?}",
                            connection_request.port
                        );
                        // let connection request know that a response was received
                        connection_request.connection_successful();
                    } else {
                        info!(
                            "No connection request found for port: {:?}",
                            packet.hdr().src_port
                        );
                        // If no connection request is found, send a reset (RST) packet
                        send_packet(machine, packet.hdr().src_port, VSOCK_OP_RST, &[])?;
                    }
                    // Connection scenario
                }
                VSOCK_OP_RST => {
                    info!("Received reset packet: {:?}", packet);
                    // Reset scenario
                    // is it an ongoing connection or an established connection?
                    let connection = connections.get_mut(&packet.hdr().src_port);
                    if let Some(connection) = connection {
                        info!("Found connection for port: {:?}", connection.port);
                        // let connection know that a reset was received
                        connection.reset_received();
                    } else {
                        // send connection request reset to connection requester
                        let connection_request = connection_requests.get(&packet.hdr().src_port);
                        if let Some(connection_request) = connection_request {
                            info!(
                                "Found connection request for port: {:?}",
                                connection_request.port
                            );
                            connection_request.reset_received();
                        } else {
                            error!(
                                "No connection request found for port: {:?}",
                                packet.hdr().src_port
                            );
                        }
                    }
                }
                VSOCK_OP_RW => {
                    info!("Received rw packet: {:?}", packet);
                    let connection = connections.get_mut(&packet.hdr().src_port);
                    if let Some(connection) = connection {
                        connection.read_queue.push(packet.payload().to_vec());
                    } else {
                        info!("No connection found for port: {:?}", packet.hdr().src_port);
                    }
                }
                VSOCK_OP_SHUTDOWN => {
                    info!("Received shutdown packet: {:?}", packet);
                    let connection = connections.get_mut(&packet.hdr().src_port);
                    if let Some(connection) = connection {
                        connection.shutdown_received();
                    } else {
                        info!("No connection found for port: {:?}", packet.hdr().src_port);
                    }
                }
                _ => {
                    info!("Received unknown packet: {:?}", packet)
                }
            }
        } else {
            // walk through all connections and send any pending data
            for (_, connection) in connections.iter_mut() {
                if !connection.write_queue.is_empty() {
                    // XXX we make an assumption no packets are transmitted in response for now
                    send_packet(
                        machine,
                        connection.port,
                        VSOCK_OP_RW,
                        &connection.read_queue.pop().unwrap(),
                    )?;
                }
            }
            // walk through all connection requests and open with VSOCK_OP_REQUEST if not done already
            for (_, connection_request) in connection_requests.iter_mut() {
                if !connection_request.open_requested {
                    send_packet(machine, connection_request.port, VSOCK_OP_REQUEST, &[])?;
                    connection_request.open_requested = true;
                }
            }
        }
        info!("Machine cycle = {}", machine.mcycle().unwrap());
        send_empty_response(machine)?;
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
