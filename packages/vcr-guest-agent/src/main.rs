use cmio::{CmioIoDriver, CmioYield, CmioError};
use log::{info, error, debug};
use std::process;

fn main() {
    // Initialize logging
    env_logger::init();
    
    info!("Starting VCR Guest Agent");
    
    // Initialize CMIO driver
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
    
    info!("TX buffer size: {} bytes", driver.tx_len());
    info!("RX buffer size: {} bytes", driver.rx_len());
    
    // Main event loop
    loop {
        let mut yield_data = CmioYield {
            dev: 0,
            cmd: 0,
            reason: 0,
            data: 0,
        };
        
        // Yield control to emulator
        match driver.yield_control(&mut yield_data) {
            Ok(()) => {
                debug!("Yield successful - dev: {}, cmd: {}, reason: {}, data: {}", 
                       yield_data.dev, yield_data.cmd, yield_data.reason, yield_data.data);
                
                // Handle the yield response
                handle_yield_response(&mut driver, &yield_data);
            }
            Err(e) => {
                error!("Yield failed: {}", e);
                break;
            }
        }
    }
    
    info!("VCR Guest Agent shutting down");
}

fn handle_yield_response(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.dev {
        0 => {
            // System device
            handle_system_command(driver, yield_data);
        }
        1 => {
            // Network device
            handle_network_command(driver, yield_data);
        }
        2 => {
            // Storage device
            handle_storage_command(driver, yield_data);
        }
        _ => {
            error!("Unknown device: {}", yield_data.dev);
        }
    }
}

fn handle_system_command(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.cmd {
        0 => {
            // System info request
            info!("System info request");
            // TODO: Implement system info response
        }
        1 => {
            // Shutdown request
            info!("Shutdown request received");
            process::exit(0);
        }
        _ => {
            error!("Unknown system command: {}", yield_data.cmd);
        }
    }
}

fn handle_network_command(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.cmd {
        0 => {
            // Network read
            info!("Network read request - length: {}", yield_data.data);
            // TODO: Implement network read using driver.rx_slice()
        }
        1 => {
            // Network write
            info!("Network write request - length: {}", yield_data.data);
            // TODO: Implement network write using driver.tx_slice_mut()
        }
        _ => {
            error!("Unknown network command: {}", yield_data.cmd);
        }
    }
}

fn handle_storage_command(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.cmd {
        0 => {
            // Storage read
            info!("Storage read request - offset: {}", yield_data.data);
            // TODO: Implement storage read using driver.rx_slice()
        }
        1 => {
            // Storage write
            info!("Storage write request - offset: {}", yield_data.data);
            // TODO: Implement storage write using driver.tx_slice_mut()
        }
        _ => {
            error!("Unknown storage command: {}", yield_data.cmd);
        }
    }
} 