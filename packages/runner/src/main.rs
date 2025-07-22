use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;

use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
mod http_service;
mod utils;
use http_service::HttpService;
use std::thread::sleep;
use std::time::Duration;

/// The path to the machine snapshot.
const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";
/// The port the guest machine is listening on.
const GUEST_PORT: u32 = 8080;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;

    'health_check: loop {
        info!("Attempting to connect to HTTP service...");
        match HttpService::connect(&mut machine, GUEST_PORT) {
            Ok(mut service) => {
                info!("Successfully connected to HTTP service.");
                loop {
                    let get_request =
                        "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
                    info!("Performing GET request...");
                    if service.request(get_request).is_ok() {
                        info!("Transaction complete.");
                        break 'health_check;
                    } else {
                        info!("Request failed. Will attempt to reconnect.");
                        break;
                    }
                }
            }
            Err(_) => {
                info!("Connection failed. Retrying in 2 seconds...");
            }
        }
    }

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
