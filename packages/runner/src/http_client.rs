use crate::utils::{Client, RunnerState};
use log::info;
use std::collections::HashMap;

/// Simple HTTP client that implements the Client trait
pub struct HttpClient {
    port: u32,
    connections: HashMap<u32, HttpClientConnection>,
    pending_requests: HashMap<u32, Vec<u8>>,
    responses: HashMap<u32, Vec<u8>>,
}

impl HttpClient {
    pub fn get_connection(&self, port: &u32) -> Option<&HttpClientConnection> {
        self.connections.get(port)
    }

    pub fn get_mut_connection(&mut self, port: &u32) -> Option<&mut HttpClientConnection> {
        self.connections.get_mut(port)
    }
}

pub struct HttpClientConnection {
    port: u32,
    buffer: Vec<u8>,
    response_complete: bool,
}

impl HttpClientConnection {
    fn new(port: u32) -> Self {
        Self {
            port,
            buffer: Vec::new(),
            response_complete: false,
        }
    }
    pub fn is_response_complete(&self) -> bool {
        self.response_complete
    }

    pub fn set_response_complete(&mut self, response_complete: bool) {
        self.response_complete = response_complete;
    }

    pub fn get_buffer(&self) -> &[u8] {
        &self.buffer
    }
    pub fn clear_buffer(&mut self) {
        self.buffer.clear();
    }
}

impl HttpClient {
    pub fn new(port: u32) -> Self {
        info!("Creating HTTP client on port {}", port);
        Self {
            port,
            connections: HashMap::new(),
            pending_requests: HashMap::new(),
            responses: HashMap::new(),
        }
    }

    fn create_http_request(&self, method: &str, path: &str, host: &str) -> Vec<u8> {
        let request = format!(
            "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            method, path, host
        );
        request.into_bytes()
    }

    pub fn make_request(&mut self, connection_port: u32, method: &str, path: &str, host: &str) {
        let request = self.create_http_request(method, path, host);
        self.pending_requests.insert(connection_port, request);
        info!("HTTP client queued {} {} request to {}", method, path, host);
    }

    pub fn parse_http_response(&self, response: &[u8]) -> Option<(u16, String)> {
        let response_str = String::from_utf8_lossy(response);
        let lines: Vec<&str> = response_str.lines().collect();
        
        if lines.is_empty() {
            return None;
        }

        let status_line = lines[0];
        let parts: Vec<&str> = status_line.split_whitespace().collect();
        
        if parts.len() < 3 {
            return None;
        }

        let status_code = parts[1].parse::<u16>().ok()?;
        let body = response_str.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        
        Some((status_code, body))
    }
}

impl Client for HttpClient {
    fn on_connect_success(&mut self, port: u32) {
        info!("HTTP client connection successful on port {}", port);
        let connection = HttpClientConnection::new(port);
        self.connections.insert(port, connection);
    }

    fn on_connect_failed(&mut self, port: u32) {
        info!("HTTP client connection failed on port {}", port);
        self.pending_requests.remove(&port);
    }

    fn on_data(&mut self, port: u32, data: &[u8]) {
        info!("HTTP client received {} bytes on port {}", data.len(), port);
        
        if let Some(connection) = self.connections.get_mut(&port) {
            connection.buffer.extend_from_slice(data);
            
            // Check if we have a complete HTTP response
            let buffer_str = String::from_utf8_lossy(&connection.buffer);
            if buffer_str.contains("\r\n\r\n") && !connection.response_complete {
                connection.response_complete = true;
                
                // Store the response
                self.responses.insert(port, connection.buffer.clone());
                info!("HTTP client received complete response on port {}", port);
                
                // Parse and log the response - clone buffer to avoid borrowing issues
                let buffer_clone = connection.buffer.clone();
                if let Some((status_code, body)) = self.parse_http_response(&buffer_clone) {
                    info!("HTTP client received status {}: {}", status_code, body);
                }
            }
        }
    }

    fn on_reset(&mut self, port: u32) {
        info!("HTTP client connection reset on port {}", port);
        self.connections.remove(&port);
        self.pending_requests.remove(&port);
        self.responses.remove(&port);
    }

    fn on_shutdown(&mut self, port: u32) {
        info!("HTTP client connection shutdown on port {}", port);
        self.connections.remove(&port);
        self.pending_requests.remove(&port);
        self.responses.remove(&port);
    }

    fn get_write_data(&mut self, port: u32) -> Option<Vec<u8>> {
        if let Some(request) = self.pending_requests.remove(&port) {
            info!("HTTP client sending {} bytes on port {}", request.len(), port);
            return Some(request);
        }
        None
    }

    fn should_shutdown(&mut self, port: u32) -> bool {
        // Shutdown after sending request and receiving response
        if let Some(connection) = self.connections.get(&port) {
            connection.response_complete
        } else {
            false
        }
    }
}

/// Helper function to create and add an HTTP client to the runner state
pub fn add_http_client(state: &mut RunnerState, client_port: u32) {
    let http_client = HttpClient::new(client_port);
    state.add_client(client_port, Box::new(http_client));
    info!("HTTP client added to runner state on port {}", client_port);
}

/// Helper function to make an HTTP request
pub fn make_http_request(
    state: &mut RunnerState,
    client_port: u32,
    target_cid: u32,
    target_port: u32,
    method: &str,
    path: &str,
    host: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Initiate the connection
    state.initiate_connection(client_port, target_cid, target_port)?;
    
    // Queue the request for when connection is established
    info!("HTTP request {} {} to {}:{} queued", method, path, target_cid, target_port);
    
    Ok(())
}



/// Helper function to start a health check
pub fn start_health_check(
    state: &mut RunnerState,
    client_port: u32,
    target_cid: u32,
    target_port: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    info!("Starting health check from client {} to {}:{}", client_port, target_cid, target_port);
    
    // Initiate the connection
    state.initiate_connection(client_port, target_cid, target_port)?;
    
    Ok(())
} 