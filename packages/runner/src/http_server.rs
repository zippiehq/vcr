use crate::utils::{Service, RunnerState};
use log::info;
use std::collections::HashMap;

/// Simple HTTP server that implements the Service trait
pub struct HttpServer {
    port: u32,
    connections: HashMap<u32, HttpConnection>,
    pending_responses: HashMap<u32, Vec<u8>>,
}

struct HttpConnection {
    port: u32,
    buffer: Vec<u8>,
    request_complete: bool,
    response_ready: bool,
}

impl HttpConnection {
    fn new(port: u32) -> Self {
        Self {
            port,
            buffer: Vec::new(),
            request_complete: false,
            response_ready: false,
        }
    }
}

impl HttpServer {
    pub fn new(port: u32) -> Self {
        info!("Creating HTTP server on port {}", port);
        Self {
            port,
            connections: HashMap::new(),
            pending_responses: HashMap::new(),
        }
    }

    pub fn handle_http_request(&mut self, data: &[u8]) -> Option<Vec<u8>> {
        // Simple HTTP request parsing
        let request_str = String::from_utf8_lossy(data);
        let lines: Vec<&str> = request_str.lines().collect();
        
        if lines.is_empty() {
            return None;
        }

        let first_line = lines[0];
        let parts: Vec<&str> = first_line.split_whitespace().collect();
        
        if parts.len() < 2 {
            return None;
        }

        let method = parts[0];
        let path = parts[1];

        info!("HTTP {} {}", method, path);

        // Simple response generation
        let response = match (method, path) {
            ("GET", "/") => {
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 25\r\n\r\n<h1>Hello World!</h1>"
            }
            ("GET", "/health") => {
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 17\r\n\r\n{\"status\":\"ok\"}"
            }
            _ => {
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\n404 Not Found"
            }
        };

        Some(response.as_bytes().to_vec())
    }
}

impl Service for HttpServer {
    fn on_connection(&mut self, port: u32) {
        info!("HTTP server received new connection on port {}", port);
        let connection = HttpConnection::new(port);
        self.connections.insert(port, connection);
    }

    fn on_data(&mut self, port: u32, data: &[u8]) {
        info!("HTTP server received {} bytes on port {}", data.len(), port);
        
        // Check if we need to process this data
        let should_process = {
            if let Some(connection) = self.connections.get(&port) {
                let buffer_str = String::from_utf8_lossy(&connection.buffer);
                buffer_str.contains("\r\n\r\n") && !connection.request_complete
            } else {
                false
            }
        };
        
        if should_process {
            // Get buffer data
            let buffer_data = {
                if let Some(connection) = self.connections.get(&port) {
                    connection.buffer.clone()
                } else {
                    return;
                }
            };
            
            // Process request
            let response = self.handle_http_request(&buffer_data);
            
            // Update connection
            if let Some(connection) = self.connections.get_mut(&port) {
                connection.request_complete = true;
                if let Some(response_data) = response {
                    self.pending_responses.insert(port, response_data);
                    connection.response_ready = true;
                }
            }
        } else {
            // Add data to buffer
            if let Some(connection) = self.connections.get_mut(&port) {
                connection.buffer.extend_from_slice(data);
            }
        }
    }

    fn on_reset(&mut self, port: u32) {
        info!("HTTP server connection reset on port {}", port);
        self.connections.remove(&port);
        self.pending_responses.remove(&port);
    }

    fn on_shutdown(&mut self, port: u32) {
        info!("HTTP server connection shutdown on port {}", port);
        self.connections.remove(&port);
        self.pending_responses.remove(&port);
    }

    fn get_write_data(&mut self, port: u32) -> Option<Vec<u8>> {
        if let Some(response) = self.pending_responses.remove(&port) {
            info!("HTTP server sending {} bytes on port {}", response.len(), port);
            return Some(response);
        }
        None
    }

    fn should_shutdown(&mut self, port: u32) -> bool {
        // Keep connections open for now
        false
    }
}

/// Helper function to create and add an HTTP server to the runner state
pub fn add_http_server(state: &mut RunnerState) {
    let http_server = HttpServer::new(8080);
    state.add_listener(8080, Box::new(http_server));
    info!("HTTP server added to runner state on port 8080");
} 