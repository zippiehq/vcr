use cmio::{CmioIoDriver, CmioYield, CmioError};
use log::{info, error, debug};
use std::process;

// HTIF Device constants
const HTIF_DEVICE_YIELD: u8 = 2;

// HTIF Commands
const HTIF_YIELD_CMD_AUTOMATIC: u8 = 0;
const HTIF_YIELD_CMD_MANUAL: u8 = 1;

// HTIF Automatic reasons
const HTIF_YIELD_AUTOMATIC_REASON_PROGRESS: u16 = 1;
const HTIF_YIELD_AUTOMATIC_REASON_TX_OUTPUT: u16 = 2;
const HTIF_YIELD_AUTOMATIC_REASON_TX_REPORT: u16 = 4;

// HTIF Manual reasons
const HTIF_YIELD_MANUAL_REASON_RX_ACCEPTED: u16 = 1;
const HTIF_YIELD_MANUAL_REASON_RX_REJECTED: u16 = 2;
const HTIF_YIELD_MANUAL_REASON_TX_EXCEPTION: u16 = 4;

// HTIF Reply reasons
const HTIF_YIELD_REASON_ADVANCE: u16 = 0;
const HTIF_YIELD_REASON_INSPECT: u16 = 1;

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
    
    // Write some test data to TX buffer
    let test_message = b"Hello from VCR Guest Agent!";
    let tx_slice = driver.tx_slice_mut();
    
    if test_message.len() <= tx_slice.len() {
        tx_slice[..test_message.len()].copy_from_slice(test_message);
        info!("Written {} bytes to TX buffer: {:?}", test_message.len(), test_message);
    } else {
        error!("Test message too large for TX buffer");
        process::exit(1);
    }
    
    // Main event loop
    loop {
        let mut yield_data = CmioYield {
            dev: HTIF_DEVICE_YIELD,
            cmd: HTIF_YIELD_CMD_AUTOMATIC,
            reason: HTIF_YIELD_AUTOMATIC_REASON_TX_REPORT,
            data: test_message.len() as u32,
        };
        
        // Yield control to emulator with TX report
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
        
        // Small delay before next iteration
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    info!("VCR Guest Agent shutting down");
}

fn handle_yield_response(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.dev {
        HTIF_DEVICE_YIELD => {
            handle_htif_yield_command(driver, yield_data);
        }
        _ => {
            error!("Unknown device: {}", yield_data.dev);
        }
    }
}

fn handle_htif_yield_command(driver: &mut CmioIoDriver, yield_data: &CmioYield) {
    match yield_data.cmd {
        HTIF_YIELD_CMD_AUTOMATIC => {
            match yield_data.reason {
                HTIF_YIELD_AUTOMATIC_REASON_PROGRESS => {
                    info!("HTIF Progress request");
                    // Continue processing
                }
                HTIF_YIELD_AUTOMATIC_REASON_TX_OUTPUT => {
                    info!("HTIF TX Output request - length: {}", yield_data.data);
                    // Handle output request
                }
                HTIF_YIELD_AUTOMATIC_REASON_TX_REPORT => {
                    info!("HTIF TX Report request - length: {}", yield_data.data);
                    // Handle report request
                }
                _ => {
                    error!("Unknown HTIF automatic reason: {}", yield_data.reason);
                }
            }
        }
        HTIF_YIELD_CMD_MANUAL => {
            match yield_data.reason {
                HTIF_YIELD_MANUAL_REASON_RX_ACCEPTED => {
                    info!("HTIF RX Accepted - length: {}", yield_data.data);
                    // Handle accepted input
                    handle_rx_data(driver, yield_data.data as usize);
                }
                HTIF_YIELD_MANUAL_REASON_RX_REJECTED => {
                    info!("HTIF RX Rejected - length: {}", yield_data.data);
                    // Handle rejected input
                }
                HTIF_YIELD_MANUAL_REASON_TX_EXCEPTION => {
                    info!("HTIF TX Exception - length: {}", yield_data.data);
                    // Handle exception
                }
                _ => {
                    error!("Unknown HTIF manual reason: {}", yield_data.reason);
                }
            }
        }
        _ => {
            error!("Unknown HTIF command: {}", yield_data.cmd);
        }
    }
}

fn handle_rx_data(driver: &mut CmioIoDriver, length: usize) {
    let rx_slice = driver.rx_slice();
    if length <= rx_slice.len() {
        let received_data = &rx_slice[..length];
        info!("Received {} bytes from RX buffer: {:?}", length, received_data);
        
        // Process the received data here
        // For now, just echo it back to TX buffer
        let tx_slice = driver.tx_slice_mut();
        if length <= tx_slice.len() {
            tx_slice[..length].copy_from_slice(received_data);
            info!("Echoed {} bytes back to TX buffer", length);
        }
    } else {
        error!("Received data length {} exceeds RX buffer size {}", length, rx_slice.len());
    }
} 