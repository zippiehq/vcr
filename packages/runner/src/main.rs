use cmio::CmioIoDriver;
use colored::*;
use env_logger::Builder;
use log::LevelFilter;
use log::{error, info};
use std::io::Write;
use std::sync::Arc;
use std::sync::Mutex;

#[tokio::main]
async fn main() {
    let mut builder = Builder::new();

    builder
        .format(|buf, record| {
            let timestamp = buf.timestamp();
            let level = record.level();
            let message = record.args();

            match record.target() {
                "guest" => writeln!(
                    buf,
                    "{} [{}] - {}",
                    timestamp,
                    level,
                    message.to_string().green()
                ),
                "host" => writeln!(
                    buf,
                    "{} [{}] - {}",
                    timestamp,
                    level,
                    message.to_string().blue()
                ),
                _ => writeln!(buf, "{} [{}] - {}", timestamp, level, message),
            }
        })
        .filter(None, LevelFilter::Info)
        .init();

    info!("START RUNNER");
    info!("________________________________________________________");
    let driver = Arc::new(Mutex::new(CmioIoDriver::new().unwrap()));
    let driver_clone1 = driver.clone();
    let driver_clone2 = driver.clone();
    let driver_clone3 = driver.clone();

    // Simulate two connections
    let host_agent_handle1 = tokio::spawn(async move {
        if let Err(e) = host_agent::run_agent(driver_clone1, 1, 1025) {
            error!("Host agent 1 failed: {}", e);
        }
    });

    let host_agent_handle2 = tokio::spawn(async move {
        if let Err(e) = host_agent::run_agent(driver_clone2, 1, 1026) {
            error!("Host agent 2 failed: {}", e);
        }
    });

    let guest_agent_handle = tokio::spawn(async move {
        if let Err(e) = guest_agent::run_agent(driver_clone3) {
            error!("Guest agent failed: {}", e);
        }
    });

    let (res1, res2, res3) =
        tokio::join!(host_agent_handle1, host_agent_handle2, guest_agent_handle);

    if let Err(e) = res1 {
        error!("Host agent 1 task failed to execute: {}", e);
    }
    if let Err(e) = res2 {
        error!("Host agent 2 task failed to execute: {}", e);
    }
    if let Err(e) = res3 {
        error!("Guest agent task failed to execute: {}", e);
    }
}
