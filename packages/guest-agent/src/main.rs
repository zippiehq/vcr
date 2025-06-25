use cmio::{CmioIoDriver, CmioError};
use log::{info, error};
use std::process;

fn main() {
    env_logger::init();
    info!("Starting Guest Agent");

    let mut driver = match CmioIoDriver::new() {
        Ok(driver) => {
            info!("CMIO driver initialized successfully");
            driver
        }
        Err(e) => {
            error!("Failed to initialize CMIO driver: {}", e);
            process::exit(1);
        }
    };

    let test_message = b"Hello from Guest Agent!";
    let domain = 1; // Example domain value
    match driver.send_cmio(test_message, domain) {
        Ok(rx_vec) => {
            info!("send_cmio succeeded. RX buffer ({} bytes): {:?}", rx_vec.len(), rx_vec);
        }
        Err(e) => {
            error!("send_cmio failed: {}", e);
            process::exit(1);
        }
    }
} 