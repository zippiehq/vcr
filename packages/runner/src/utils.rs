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
use std::sync::Arc;
use tokio::sync::Mutex;
pub struct RunnerState {
    listeners: HashMap<u32, RunnerListener>,
    connections: HashMap<u32, RunnerConnection>,
    connection_requests: HashMap<u32, RunnerConnectionRequest>,
    cmio_write_queue: Vec<Packet>,
    cmio_read_queue: Vec<Packet>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            listeners: HashMap::new(),
            connections: HashMap::new(),
            connection_requests: HashMap::new(),
            cmio_write_queue: Vec::new(),
            cmio_read_queue: Vec::new(),
        }
    }

    pub fn add_listener(&mut self, port: u32) {
        let listener = RunnerListener::new(port);
        self.listeners.insert(port, listener);
    }

    pub fn remove_listener(&mut self, port: u32) {
        self.listeners.remove(&port);
    }

    pub fn get_listener(&self, port: u32) -> Option<&RunnerListener> {
        self.listeners.get(&port)
    }

    // Connection methods
    pub fn add_connection(&mut self, port: u32) {
        let connection = RunnerConnection::new(port);
        self.connections.insert(port, connection);
    }

    pub fn remove_connection(&mut self, port: u32) {
        self.connections.remove(&port);
    }

    pub fn get_connection(&mut self, port: u32) -> Option<&mut RunnerConnection> {
        self.connections.get_mut(&port)
    }

    pub fn get_connections_mut(&mut self) -> &mut HashMap<u32, RunnerConnection> {
        &mut self.connections
    }

    pub fn get_connections(&mut self) -> &mut HashMap<u32, RunnerConnection> {
        &mut self.connections
    }

    pub fn get_connection_requests(&mut self) -> &mut HashMap<u32, RunnerConnectionRequest> {
        &mut self.connection_requests
    }

    // Connection request methods
    pub fn add_connection_request(&mut self, port: u32) {
        let connection_request = RunnerConnectionRequest::new(port);
        self.connection_requests.insert(port, connection_request);
    }

    pub fn remove_connection_request(&mut self, port: u32) {
        self.connection_requests.remove(&port);
    }

    pub fn get_connection_request(&self, port: u32) -> Option<&RunnerConnectionRequest> {
        self.connection_requests.get(&port)
    }

    // CMIO queue methods
    pub fn add_to_write_queue(&mut self, packet: Packet) {
        self.cmio_write_queue.push(packet);
    }

    pub fn pop_from_write_queue(&mut self) -> Option<Packet> {
        self.cmio_write_queue.pop()
    }

    pub fn add_to_read_queue(&mut self, packet: Packet) {
        self.cmio_read_queue.push(packet);
    }

    pub fn pop_from_read_queue(&mut self) -> Option<Packet> {
        self.cmio_read_queue.pop()
    }
}

pub fn construct_packet(
    guest_port: u32,
    op: u16,
    payload: &[u8],
) -> Result<Packet, Box<dyn Error>> {
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
    Ok(packet)
}

pub fn vsock_connect(machine: &mut Machine, guest_port: u32) -> Result<(), Box<dyn Error>> {
    info!(
        "Attempting to connect to guest vsock port {}...",
        guest_port
    );
    run_machine_until_yield(machine)?;
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
        send_empty_response(machine)?;
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

    fn connection_successful(&self, connections: &mut HashMap<u32, RunnerConnection>) {
        info!("Connection request for port {} was successful", self.port);
        let connection = RunnerConnection::new(self.port);
        connections.insert(self.port, connection.clone());
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

pub fn run_machine_loop(
    machine: &mut Machine,
    state: &mut RunnerState,
) -> Result<(), Box<dyn Error>> {
    state.add_connection_request(8080);
    loop {
        run_machine_until_yield(machine)?;
        let packet = receive_packet(machine)?;
        info!("packet = {:?}", packet);
        if let Some(packet) = packet {
            state.add_to_read_queue(packet);
            send_empty_response(machine)?;
        } else {
            // pop one packet from cmio_write_queue and set it as response
            if let Some(packet) = state.pop_from_write_queue() {
                info!("Sending send_cmio_response to guest: {:?}", packet);
                machine.send_cmio_response(CmioResponseReason::Advance, &packet.to_bytes())?;
            } else {
                info!("No packet to send to guest, sending empty response");
                send_empty_response(machine)?;
            }
        }

        // handle all packets in cmio_read_queue, pop them as we go
        while let Some(packet) = state.pop_from_read_queue() {
            match packet.hdr().op {
                VSOCK_OP_REQUEST => {
                    info!("Received request packet: {:?}", packet);
                    // Listener scenario
                    // Do we have a listener for this port?
                    // If so, send a response packet
                    // If not, send a reset packet
                    let dst_port = packet.hdr().dst_port;
                    let src_port = packet.hdr().src_port;
                    if state.get_listener(dst_port).is_some() {
                        info!("Found listener for port: {:?}", dst_port);
                        state.add_to_write_queue(construct_packet(
                            dst_port,
                            VSOCK_OP_RESPONSE,
                            &[],
                        )?);
                        state.add_connection(src_port);
                        if let Some(listener) = state.get_listener(dst_port) {
                            listener.new_connection(RunnerConnection::new(src_port));
                        }
                    } else {
                        info!("No listener found for port: {:?}", dst_port);
                        // If no listener is found for the requested port, send a reset (RST) packet
                        state.add_to_write_queue(construct_packet(dst_port, VSOCK_OP_RST, &[])?);
                    }
                }
                VSOCK_OP_RESPONSE => {
                    info!("Received response packet: {:?}", packet);
                    // handle response to a connection request
                    let dst_port = packet.hdr().dst_port;
                    if let Some(connection_request) =
                        state.get_connection_request(packet.hdr().src_port)
                    {
                        info!(
                            "Found connection request for port: {:?}",
                            connection_request.port
                        );
                        state.add_connection(connection_request.port);
                        state.remove_connection_request(packet.hdr().src_port);
                    } else {
                        error!(
                            "No connection request found for port: {:?}",
                            packet.hdr().src_port
                        );
                        // If no connection request is found, send a reset (RST) packet
                        state.add_to_write_queue(construct_packet(dst_port, VSOCK_OP_RST, &[])?);
                    }
                    // Connection scenario
                }
                VSOCK_OP_RST => {
                    info!("Received reset packet: {:?}", packet);
                    // Reset scenario
                    // is it an ongoing connection or an established connection?
                    let connection = state.get_connection(packet.hdr().src_port);
                    if let Some(connection) = connection {
                        info!("Found connection for port: {:?}", connection.port);
                        // let connection know that a reset was received
                        connection.reset_received();
                    } else {
                        // send connection request reset to connection requester
                        if let Some(connection_request) =
                            state.get_connection_request(packet.hdr().src_port)
                        {
                            info!(
                                "Found connection request for port: {:?}",
                                connection_request.port
                            );
                            connection_request.reset_received();
                        } else {
                            error!(
                                "No connection request found for port: {:?}, ignoring reset",
                                packet.hdr().src_port
                            );
                        }
                    }
                }
                VSOCK_OP_RW => {
                    info!("Received rw packet: {:?}", packet);
                    let connection = state.get_connection(packet.hdr().src_port);
                    if let Some(connection) = connection {
                        connection.read_queue.push(packet.payload().to_vec());
                    } else {
                        info!("No connection found for port: {:?}", packet.hdr().src_port);
                    }
                }
                VSOCK_OP_SHUTDOWN => {
                    info!("Received shutdown packet: {:?}", packet);
                    let connection = state.get_connection(packet.hdr().src_port);
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
        }
        // walk through all connections and send any pending data

        let connections = state.get_connections();
        let mut packets_to_send = Vec::new();
        for (_, connection) in connections.iter_mut() {
            if !connection.write_queue.is_empty() {
                // XXX we make an assumption no packets are transmitted in response for now
                let packet = construct_packet(
                    connection.port,
                    VSOCK_OP_RW,
                    &connection.write_queue.pop().unwrap(),
                )?;
                packets_to_send.push(packet);
            }
        }
        for packet in packets_to_send {
            state.add_to_write_queue(packet);
        }

        // walk through all connection requests and open with VSOCK_OP_REQUEST if not done already
        let connection_requests = state.get_connection_requests();
        let mut packets_to_send = Vec::new();
        for (_, connection_request) in connection_requests.iter_mut() {
            info!("Connection request for port: {:?}", connection_request.port);
            if !connection_request.open_requested {
                let packet = construct_packet(connection_request.port, VSOCK_OP_REQUEST, &[])?;
                packets_to_send.push(packet);
                connection_request.open_requested = true;
            }
        }
        for packet in packets_to_send {
            state.add_to_write_queue(packet);
        }
        info!("Machine cycle = {}", machine.mcycle().unwrap());
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

pub async fn listen(machine: Arc<Mutex<Machine>>, port: u32) -> Result<(), Box<dyn Error>> {
    info!("Starting listener on port {}", port);

    let mut state = RunnerState::new();

    state.add_listener(port);
    let mut machine = machine.lock().await;

    run_machine_loop(&mut machine, &mut state)
}

pub async fn connect(machine: Arc<Mutex<Machine>>, port: u32) -> Result<(), Box<dyn Error>> {
    info!("Connecting to guest port {}", port);

    let mut state = RunnerState::new();
    state.add_connection_request(port);
    let mut machine = machine.lock().await;

    run_machine_loop(&mut machine, &mut state)
}
