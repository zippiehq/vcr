use crate::utils::{Client, RunnerState};
use crate::http_client::HttpClient;
use log::info;

/// HTTP Health Check Client that implements the Client trait
pub struct HttpHealthCheckClient {
    http_client: HttpClient,
    health_check_retries: u32,
    max_retries: u32,
    target_host: String,
}

impl HttpHealthCheckClient {
    pub fn new(port: u32, max_retries: u32, target_host: String) -> Self {
        info!("Creating HTTP health check client on port {}", port);
        Self {
            http_client: HttpClient::new(port),
            health_check_retries: 0,
            max_retries,
            target_host,
        }
    }

    pub fn start_health_check(&mut self, connection_port: u32) {
        info!("Starting health check on port {}", connection_port);
        self.health_check_retries = 0;
        self.http_client.make_request(connection_port, "GET", "/health", &self.target_host);
    }
}

impl Client for HttpHealthCheckClient {
    fn on_connect_success(&mut self, port: u32) {
        info!("HTTP health check client connection successful on port {}", port);
        // Delegate to the underlying HTTP client
        self.http_client.on_connect_success(port);
        
        // Start health check automatically
        self.start_health_check(port);
    }

    fn on_connect_failed(&mut self, port: u32) {
        info!("HTTP health check client connection failed on port {}", port);
        self.http_client.on_connect_failed(port);
    }

    fn on_data(&mut self, port: u32, data: &[u8]) {
        info!("HTTP health check client received {} bytes on port {}", data.len(), port);
        
        // Delegate to the underlying HTTP client first
        self.http_client.on_data(port, data);
        
        // Check if we have a complete response and handle health check logic
        if let Some(connection) = self.http_client.get_connection(&port) {
            if connection.is_response_complete() {
                if let Some((status_code, body)) = self.http_client.parse_http_response(connection.get_buffer()) {
                    info!("Health check client received status {}: {}", status_code, body);
                    
                    if status_code == 200 {
                        info!("Health check SUCCESS! Server is healthy.");
                        // Don't retry on success
                    } else {
                        info!("Health check failed with status {}", status_code);
                        self.health_check_retries += 1;
                        
                        if self.health_check_retries < self.max_retries {
                            info!("Retrying health check (attempt {}/{})", 
                                  self.health_check_retries + 1, self.max_retries);
                            // Reset connection for retry
                            if let Some(conn) = self.http_client.get_mut_connection(&port) {
                                conn.set_response_complete(false);
                                conn.clear_buffer();
                            }
                            self.http_client.make_request(port, "GET", "/health", &self.target_host);
                        } else {
                            info!("Health check failed after {} attempts", self.max_retries);
                        }
                    }
                }
            }
        }
    }

    fn on_reset(&mut self, port: u32) {
        info!("HTTP health check client connection reset on port {}", port);
        self.http_client.on_reset(port);
    }

    fn on_shutdown(&mut self, port: u32) {
        info!("HTTP health check client connection shutdown on port {}", port);
        self.http_client.on_shutdown(port);
    }

    fn get_write_data(&mut self, port: u32) -> Option<Vec<u8>> {
        self.http_client.get_write_data(port)
    }

    fn should_shutdown(&mut self, port: u32) -> bool {
        // Shutdown after receiving successful response or max retries
        if let Some(connection) = self.http_client.get_connection(&port) {
            if connection.is_response_complete() {
                if let Some((status_code, _)) = self.http_client.parse_http_response(connection.get_buffer()) {
                    return status_code == 200 || self.health_check_retries >= self.max_retries;
                }
            }
        }
        false
    }
}

/// Helper function to create and add an HTTP health check client to the runner state
pub fn add_http_health_check_client(state: &mut RunnerState, client_port: u32, max_retries: u32) {
    let health_check_client = HttpHealthCheckClient::new(client_port, max_retries, "localhost:8080".to_string());
    state.add_client(client_port, Box::new(health_check_client));
    info!("HTTP health check client added to runner state on port {}", client_port);
} 