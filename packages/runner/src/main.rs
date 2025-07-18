use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;

use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use tokio::time::Duration;
use tokio::time::sleep;
mod http_service;
mod utils;
use http_service::HttpService;

/// The path to the machine snapshot.
const MACHINE_PATH: &str = "../../vc-cm-vsock-machine-v2";
/// The port the guest machine is listening on.
const GUEST_PORT: u32 = 8080;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;

    let mut service = HttpService::connect(&mut machine, GUEST_PORT)?;

    let get_request = "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    info!("Performing GET request...");
    service.request(get_request)?;

    info!("Transaction complete.");
    Ok(())
}

fn setup_logger() {
    let mut builder = Builder::new();
    builder
        .format(|buf, record| {
            writeln!(
                buf,
                "{} [{}] - {}",
                buf.timestamp(),
                record.level(),
                record.args()
            )
        })
        .filter(None, LevelFilter::Info)
        .init();
}
