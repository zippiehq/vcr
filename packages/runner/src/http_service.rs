use crate::utils::{
    receive_packet, run_machine_until_yield, send_empty_response, send_packet, vsock_connect,
};
use cartesi_machine::machine::Machine;
use log::info;
use std::error::Error;
use vsock_protocol::{VSOCK_OP_RW, VSOCK_OP_SHUTDOWN};

/// A simple HTTP service that communicates over a vsock stream.
pub struct HttpService<'a> {
    machine: &'a mut Machine,
    guest_port: u32,
}

impl<'a> HttpService<'a> {
    /// Connects to the service on the guest machine.
    pub fn connect(machine: &'a mut Machine, guest_port: u32) -> Result<Self, Box<dyn Error>> {
        vsock_connect(machine, guest_port)?;
        Ok(Self {
            machine,
            guest_port,
        })
    }

    /// Performs a request by parsing the method and sending it to the guest.
    pub fn request(&mut self, request: &str) -> Result<String, Box<dyn Error>> {
        let first_line = request.lines().next().ok_or("Empty request")?;
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        if parts.is_empty() {
            return Err("Malformed request".into());
        }
        let method = parts[0];

        match method {
            "GET" | "POST" => {
                info!("Sending HTTP request to guest...");
                send_packet(
                    self.machine,
                    self.guest_port,
                    VSOCK_OP_RW,
                    request.as_bytes(),
                )?;

                info!("Waiting for response...");
                run_machine_until_yield(self.machine)?;

                let response_bytes = loop {
                    let packet_opt = receive_packet(self.machine)?;

                    if let Some(packet) = packet_opt {
                        if packet.hdr().op == VSOCK_OP_RW {
                            let payload = packet.payload();
                            if !payload.is_empty() {
                                info!("Received data chunk from guest: {:?}", payload);
                                break payload.to_vec();
                            } else {
                                info!("Received empty RW packet, waiting...");
                                send_empty_response(self.machine)?;
                                run_machine_until_yield(self.machine)?;
                            }
                        } else if packet.hdr().op == VSOCK_OP_SHUTDOWN {
                            info!("Guest has shut down the connection.");
                            return Err(format!("Shutdown").into());
                        }
                    } else {
                        info!("No packet received, waiting...");
                        send_empty_response(self.machine)?;
                        run_machine_until_yield(self.machine)?;
                    }
                };

                let response_str = String::from_utf8_lossy(&response_bytes).to_string();
                info!(
                    "--- GUEST RESPONSE ---\n{}\n----------------------",
                    response_str
                );

                Ok(response_str)
            }
            _ => Err(format!("Unsupported method {}", method).into()),
        }
    }
}
