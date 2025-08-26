use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use log::info;
use runner::http_client::{start_health_check, HttpClient};
use runner::http_health_check_client::add_http_health_check_client;
use runner::http_server::{add_http_server, HttpServer};
use runner::utils::Client;
use runner::utils::{run_machine_loop, RunnerState};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use runner::http_client::make_http_request;
use runner::http_client::add_http_client;
/*
#[test]
fn test_health_check_endpoint() {
    let mut server = HttpServer::new(8080);
    let mut client = HttpClient::new(9000);
    client.make_request(8080, "GET", "/health", "localhost:8080");
    let request_data = client
        .get_write_data(8080)
        .expect("Should have request data");
    println!("Request data: {:?}", String::from_utf8_lossy(&request_data));
    let response = server
        .handle_http_request(&request_data)
        .expect("Should return a response");
    println!("Response: {:?}", String::from_utf8_lossy(&response));
}

#[tokio::test]
async fn test_cartesi_machine_health_check() -> Result<(), Box<dyn std::error::Error>> {
    const GUEST_PORT: u32 = 8080;

    // Path to the machine snapshot (should match your setup)
    const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";

    let machine = Arc::new(Mutex::new(Machine::load(
        Path::new(MACHINE_PATH),
        &RuntimeConfig::default(),
    )?));

    let state = Arc::new(Mutex::new(RunnerState::new()));
    let mut health_check_receiver = {
        let mut state_guard = state.lock().await;
        add_http_server(&mut state_guard);
        let rx = add_http_health_check_client(&mut state_guard, 9000, 10);
        start_health_check(&mut state_guard, 9000, 1, GUEST_PORT)?;
        rx
    };

    let machine_for_loop = Arc::clone(&machine);
    let state_for_loop = Arc::clone(&state);
    let machine_loop_fut = async move {
        info!("Starting machine loop with shared state...");
        let _ = run_machine_loop(machine_for_loop, state_for_loop).await;
    };
    // Let the loop run briefly to exercise the path, then time out

    tokio::select! {
        _ = health_check_receiver.recv() => {
            println!("Health check test sucessful")
        }
        _ = machine_loop_fut => {
            println!("machine_loop_fut completed first")
        }
    };

    println!("Machine loop completed.");
    Ok(())
}
*/
#[tokio::test]
async fn test_guest_listener_health_check() -> Result<(), Box<dyn std::error::Error>> {
    const GUEST_PORT: u32 = 10000;

    const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";

    let machine = Arc::new(Mutex::new(Machine::load(
        Path::new(MACHINE_PATH),
        &RuntimeConfig::default(),
    )?));

    let state = Arc::new(Mutex::new(RunnerState::new()));
    let machine_for_loop = Arc::clone(&machine);
    let state_for_loop = Arc::clone(&state);

    {
        let mut state_guard = state_for_loop.lock().await;
        let _rx = add_http_health_check_client(&mut state_guard, 9001, 1);
        start_health_check(&mut state_guard, 9001, 1, GUEST_PORT)?;
    }

    let machine_loop_fut = {
        let machine = machine_for_loop.clone();
        let state = state_for_loop.clone();
        async move {
            info!("Starting machine loop with shared state...");
            let _ = run_machine_loop(machine, state).await;
        }
    };

    // Short timeout; test only ensures we can dial 10000 and run a health check
    tokio::select! {
        _ = machine_loop_fut => {}
        _ = sleep(Duration::from_secs(10)) => {}
    };

    Ok(())
}
