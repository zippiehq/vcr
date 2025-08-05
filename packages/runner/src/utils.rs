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

/// Service trait for handling vsock connections
pub trait Service: Send {
    /// Called when a new connection is established
    fn on_connection(&mut self, port: u32);
    
    /// Called when data is received on a connection
    fn on_data(&mut self, port: u32, data: &[u8]);
    
    /// Called when a connection receives a reset
    fn on_reset(&mut self, port: u32);
    
    /// Called when a connection receives a shutdown
    fn on_shutdown(&mut self, port: u32);
    
    /// Called to get data to write to a connection
    fn get_write_data(&mut self, port: u32) -> Option<Vec<u8>>;
    
    /// Called to check if a connection should be shut down
    fn should_shutdown(&mut self, port: u32) -> bool;
}

/// Client trait for making vsock connections
pub trait Client: Send {
    /// Called when a connection attempt succeeds
    fn on_connect_success(&mut self, port: u32);
    
    /// Called when a connection attempt fails
    fn on_connect_failed(&mut self, port: u32);
    
    /// Called when data is received on a connection
    fn on_data(&mut self, port: u32, data: &[u8]);
    
    /// Called when a connection receives a reset
    fn on_reset(&mut self, port: u32);
    
    /// Called when a connection receives a shutdown
    fn on_shutdown(&mut self, port: u32);
    
    /// Called to get data to write to a connection
    fn get_write_data(&mut self, port: u32) -> Option<Vec<u8>>;
    
    /// Called to check if a connection should be shut down
    fn should_shutdown(&mut self, port: u32) -> bool;
}

pub struct RunnerState {
    listeners: HashMap<u32, Box<dyn Service>>,
    clients: HashMap<u32, Box<dyn Client>>, // Maps client port to client instance
    connection_service_map: HashMap<u32, u32>, // Maps connection port to service port
    connection_client_map: HashMap<u32, u32>, // Maps connection port to client port
    cmio_write_queue: Vec<Packet>,
    cmio_read_queue: Vec<Packet>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            listeners: HashMap::new(),
            clients: HashMap::new(),
            connection_service_map: HashMap::new(),
            connection_client_map: HashMap::new(),
            cmio_write_queue: Vec::new(),
            cmio_read_queue: Vec::new(),
        }
    }

    pub fn add_listener(&mut self, port: u32, service: Box<dyn Service>) {
        self.listeners.insert(port, service);
    }

    pub fn remove_listener(&mut self, port: u32) {
        self.listeners.remove(&port);
    }

    pub fn get_listener(&mut self, port: u32) -> Option<&mut Box<dyn Service>> {
        self.listeners.get_mut(&port)
    }

    // Client methods
    pub fn add_client(&mut self, port: u32, client: Box<dyn Client>) {
        self.clients.insert(port, client);
    }

    pub fn remove_client(&mut self, port: u32) {
        self.clients.remove(&port);
    }

    pub fn get_client(&mut self, port: u32) -> Option<&mut Box<dyn Client>> {
        self.clients.get_mut(&port)
    }

    pub fn initiate_connection(&mut self, client_port: u32, target_cid: u32, target_port: u32) -> Result<(), Box<dyn Error>> {
        // Create a connection request packet
        let packet = construct_packet(
            target_port,
            VSOCK_OP_REQUEST,
            &[],
        )?;
        
        // Add the packet to the write queue
        self.add_to_write_queue(packet);
        
        // Map the connection to this client
        // We'll use the target_port as the connection port for now
        self.add_client_connection(target_port, client_port);
        
        info!("Initiated connection from client {} to {}:{}", client_port, target_cid, target_port);
        Ok(())
    }

    // Connection methods
    pub fn add_connection(&mut self, port: u32, service_port: u32) {
        self.connection_service_map.insert(port, service_port);
    }

    pub fn add_client_connection(&mut self, port: u32, client_port: u32) {
        self.connection_client_map.insert(port, client_port);
    }

    pub fn remove_connection(&mut self, port: u32) {
        self.connection_service_map.remove(&port);
        self.connection_client_map.remove(&port);
    }

    pub fn get_service_port(&self, connection_port: u32) -> Option<u32> {
        self.connection_service_map.get(&connection_port).copied()
    }

    pub fn get_client_port(&self, connection_port: u32) -> Option<u32> {
        self.connection_client_map.get(&connection_port).copied()
    }

    pub fn get_connection_ports(&self) -> Vec<u32> {
        let mut ports = Vec::new();
        ports.extend(self.connection_service_map.keys().copied());
        ports.extend(self.connection_client_map.keys().copied());
        ports
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








pub async fn run_machine_loop(
    machine: Arc<Mutex<Machine>>,
    state: Arc<Mutex<RunnerState>>,
) -> Result<(), Box<dyn Error>> {
    loop {
        let mut machine = machine.lock().await;
        let mut state = state.lock().await;

        run_machine_until_yield(&mut machine)?;
        let packet = receive_packet(&mut machine)?;
        info!("packet = {:?}", packet);
        if let Some(packet) = packet {
            state.add_to_read_queue(packet);
            send_empty_response(&mut machine)?;
        } else {
            // pop one packet from cmio_write_queue and set it as response
            if let Some(packet) = state.pop_from_write_queue() {
                info!("Sending send_cmio_response to guest: {:?}", packet);
                machine.send_cmio_response(CmioResponseReason::Advance, &packet.to_bytes())?;
            } else {
                info!("No packet to send to guest, sending empty response");
                send_empty_response(&mut machine)?;
            }
        }

        // handle all packets in cmio_read_queue, pop them as we go
        while let Some(packet) = state.pop_from_read_queue() {
            match packet.hdr().op {
                VSOCK_OP_REQUEST => {
                    info!("Received request packet: {:?}", packet);
                    let dst_port = packet.hdr().dst_port;
                    let src_port = packet.hdr().src_port;
                    if let Some(service) = state.get_listener(dst_port) {
                        info!("Found listener for port: {:?}", dst_port);
                        state.add_to_write_queue(construct_packet(
                            dst_port,
                            VSOCK_OP_RESPONSE,
                            &[],
                        )?);
                        state.add_connection(src_port, dst_port);
                        service.on_connection(src_port);
                    } else {
                        info!("No listener found for port: {:?}", dst_port);
                        // If no listener is found for the requested port, send a reset (RST) packet
                        state.add_to_write_queue(construct_packet(dst_port, VSOCK_OP_RST, &[])?);
                    }
                }
                VSOCK_OP_RESPONSE => {
                    info!("Received response packet: {:?}", packet);
                    let dst_port = packet.hdr().dst_port;
                    let src_port = packet.hdr().src_port;
                    
                    // Check if this is a response to a client connection attempt
                    if let Some(client_port) = state.get_client_port(src_port) {
                        if let Some(client) = state.get_client(client_port) {
                            info!("Client connection successful on port {}", src_port);
                            client.on_connect_success(src_port);
                        }
                    }
                }
                VSOCK_OP_RST => {
                    info!("Received reset packet: {:?}", packet);
                    let src_port = packet.hdr().src_port;
                    if let Some(service_port) = state.get_service_port(src_port) {
                        info!("Found service connection for port: {:?}", src_port);
                        if let Some(service) = state.get_listener(service_port) {
                            service.on_reset(src_port);
                        }
                    } else if let Some(client_port) = state.get_client_port(src_port) {
                        info!("Found client connection for port: {:?}", src_port);
                        if let Some(client) = state.get_client(client_port) {
                            client.on_reset(src_port);
                        }
                    } else {
                        info!("No connection found for port: {:?}, ignoring reset", src_port);
                    }
                }
                VSOCK_OP_RW => {
                    info!("Received rw packet: {:?}", packet);
                    let src_port = packet.hdr().src_port;
                    if let Some(service_port) = state.get_service_port(src_port) {
                        // Find the service for this connection using the service_port
                        if let Some(service) = state.get_listener(service_port) {
                            service.on_data(src_port, packet.payload());
                        }
                    } else if let Some(client_port) = state.get_client_port(src_port) {
                        // Find the client for this connection using the client_port
                        if let Some(client) = state.get_client(client_port) {
                            client.on_data(src_port, packet.payload());
                        }
                    } else {
                        info!("No connection found for port: {:?}", src_port);
                    }
                }
                VSOCK_OP_SHUTDOWN => {
                    info!("Received shutdown packet: {:?}", packet);
                    let src_port = packet.hdr().src_port;
                    if let Some(service_port) = state.get_service_port(src_port) {
                        if let Some(service) = state.get_listener(service_port) {
                            service.on_shutdown(src_port);
                        }
                    } else if let Some(client_port) = state.get_client_port(src_port) {
                        if let Some(client) = state.get_client(client_port) {
                            client.on_shutdown(src_port);
                        }
                    } else {
                        info!("No connection found for port: {:?}", src_port);
                    }
                }
                _ => {
                    info!("Received unknown packet: {:?}", packet)
                }
            }
        }
        // walk through all connections and send any pending data

        let connection_ports = state.get_connection_ports();
        let mut packets_to_send = Vec::new();
        for port in connection_ports {
            // Check if service wants to write data
            if let Some(service_port) = state.get_service_port(port) {
                if let Some(service) = state.get_listener(service_port) {
                    if let Some(data) = service.get_write_data(port) {
                        let packet = construct_packet(
                            port,
                            VSOCK_OP_RW,
                            &data,
                        )?;
                        packets_to_send.push(packet);
                    }
                    
                    // Check if service wants to shutdown the connection
                    if service.should_shutdown(port) {
                        let packet = construct_packet(
                            port,
                            VSOCK_OP_SHUTDOWN,
                            &[],
                        )?;
                        packets_to_send.push(packet);
                    }
                }
            }
            
            // Check if client wants to write data
            if let Some(client_port) = state.get_client_port(port) {
                if let Some(client) = state.get_client(client_port) {
                    if let Some(data) = client.get_write_data(port) {
                        let packet = construct_packet(
                            port,
                            VSOCK_OP_RW,
                            &data,
                        )?;
                        packets_to_send.push(packet);
                    }
                    
                    // Check if client wants to shutdown the connection
                    if client.should_shutdown(port) {
                        let packet = construct_packet(
                            port,
                            VSOCK_OP_SHUTDOWN,
                            &[],
                        )?;
                        packets_to_send.push(packet);
                    }
                }
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

