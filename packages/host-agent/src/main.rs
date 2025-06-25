use cmio::CmioIoDriver;
use colored::*;
use env_logger::Builder;
use host_agent::run_agent;
use log::{error, info, LevelFilter};
use std::io::Write;
use std::sync::Arc;
use std::sync::Mutex;

fn main() {
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
                message.to_string().blue()
            )
        })
        .filter(None, LevelFilter::Info)
        .init();

    info!("Starting host agent");
    let driver = Arc::new(Mutex::new(CmioIoDriver::new().unwrap()));
    if let Err(e) = run_agent(driver) {
        error!("Host agent exited with error: {}", e);
    }
}
