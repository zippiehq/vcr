use cmio::CmioIoDriver;
use colored::*;
use env_logger::Builder;
use guest_agent::run_agent;
use log::{error, info, LevelFilter};
use std::io::Write;
use std::process;
use std::sync::Arc;
use std::sync::Mutex;

fn main() {
    println!("Starting Guest Agent");
    let mut builder = Builder::new();

    builder
        .format(|buf, record| {
            let timestamp = buf.timestamp();
            let level = record.level();
            let message = record.args();

            writeln!(
                buf,
                "{} [{}] - {}",
                timestamp,
                level,
                message.to_string().green()
            )
        })
        .filter(None, LevelFilter::Info)
        .init();

    info!("Starting Guest Agent");
    let driver = Arc::new(Mutex::new(CmioIoDriver::new().unwrap()));

    if let Err(e) = run_agent(driver) {
        error!("Agent failed: {}", e);
        process::exit(1);
    }
}
