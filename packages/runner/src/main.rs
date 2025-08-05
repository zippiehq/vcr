use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;
mod http_client;
mod http_health_check_client;
mod http_server;
mod utils;
use crate::utils::{run_machine_loop, RunnerState};
use crate::http_server::add_http_server;
use crate::http_client::{add_http_client, start_health_check};
use crate::http_health_check_client::add_http_health_check_client;
use std::sync::Arc;
use tokio::sync::Mutex;
/// The path to the machine snapshot.
const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";
/// The port the guest machine is listening on.

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let machine = Arc::new(Mutex::new(Machine::load(
        Path::new(MACHINE_PATH),
        &RuntimeConfig::default(),
    )?));

    // Create a single shared state
    let state = Arc::new(Mutex::new(RunnerState::new()));

    // Add HTTP server and client to the state
    {
        let mut state_guard = state.lock().await;
        add_http_server(&mut state_guard);
        add_http_health_check_client(&mut state_guard, 9000, 10); // HTTP health check client on port 9000 with 10 max retries
        
        // Start health check example
        info!("Starting health check example...");
        if let Err(e) = start_health_check(&mut state_guard, 9000, 1, 8080) {
            eprintln!("Failed to start health check: {}", e);
        }
    }

    let machine_for_loop = Arc::clone(&machine);
    let state_for_loop = Arc::clone(&state);

    let machine_loop_fut = {
        let machine = machine_for_loop.clone();
        let state = state_for_loop.clone();
        async move {
            info!("Starting machine loop with shared state...");
            match run_machine_loop(machine, state).await {
                Ok(_) => info!("Machine loop completed."),
                Err(e) => eprintln!("Machine loop failed: {}", e),
            }
        }
    };

    tokio::join!(machine_loop_fut);

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
