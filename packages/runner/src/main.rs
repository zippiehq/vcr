use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;
mod http_service;
mod utils;
use crate::utils::{connect, listen, run_machine_loop};
use crate::utils::{receive_packet, vsock_connect, RunnerState};
use bytes::Bytes;
use http_body_util::BodyExt;
use http_body_util::Full;
use http_service::HttpService;
use hyper::body::Incoming;
use hyper::Request;
use hyper::Response;
use hyper_util::rt::TokioIo;
use reqwest::Client;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::join;
use tokio::net::TcpListener;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::sleep;
use vsock_protocol::{VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW};
/// The path to the machine snapshot.
const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";
/// The port the guest machine is listening on.
const GUEST_PORT: u32 = 8080;

async fn handle(
    mut req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let headers = req.headers().clone();
    let body_bytes = req.body_mut().collect().await.unwrap_or_default();
    let body_bytes = body_bytes.to_bytes();
    let body_str = String::from_utf8_lossy(&body_bytes);

    info!(
        "Received request: method={:?}, path={}, headers={:?}, body={}",
        method, path, headers, body_str
    );

    match (method, path.as_str()) {
        (hyper::Method::GET, "/health") => Ok(Response::new(Full::new(Bytes::from("OK")))),
        _ => Ok(Response::new(Full::new(Bytes::from("Not Found")))),
    }
}

async fn run_vsock_tcp_proxy(mut machine: Machine) -> Result<(), Box<dyn Error>> {
    let client = Client::new();
    loop {
        match receive_packet(&mut machine) {
            Ok(Some(packet)) if packet.hdr().op == VSOCK_OP_REQUEST => {
                let guest_port = packet.hdr().src_port;
                let payload = packet.payload();
                //send_packet(&mut machine, guest_port, VSOCK_OP_RESPONSE, payload)?;
                loop {
                    match receive_packet(&mut machine) {
                        Ok(Some(rw_packet)) if rw_packet.hdr().op == VSOCK_OP_RW => {
                            forward_to_http_host_service(
                                &client,
                                rw_packet.payload(),
                                packet.hdr().dst_port,
                            )
                            .await?;
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
}

async fn forward_to_http_host_service(
    client: &Client,
    payload: &[u8],
    port: u32,
) -> Result<(), Box<dyn Error>> {
    let data_str = String::from_utf8_lossy(payload);
    let resp = client
        .post(format!("http://127.0.0.1:{}/data", port))
        .body(data_str.to_string())
        .send()
        .await?;
    if !resp.status().is_success() {
        Err(format!("HTTP forward failed with status {}", resp.status()).into())
    } else {
        Ok(())
    }
}

async fn run_health_check(machine: &mut Machine) {
    loop {
        info!("Attempting to connect to HTTP service...");
        match HttpService::connect(machine, GUEST_PORT) {
            Ok(mut service) => {
                info!("Successfully connected to HTTP service.");
                let get_request =
                    "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
                info!("Performing GET request...");
                if service.request(get_request).is_ok() {
                    info!("Transaction complete.");
                    break;
                } else {
                    info!("Request failed. Will attempt to reconnect.");
                }
            }
            Err(_) => {
                info!("Connection failed. Retrying in 2 seconds...");
            }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let machine = Arc::new(Mutex::new(Machine::load(
        Path::new(MACHINE_PATH),
        &RuntimeConfig::default(),
    )?));

    let machine_for_listen = Arc::clone(&machine);
    let machine_for_connect = Arc::clone(&machine);

    // Spawn both listen and connect concurrently
    let listen_fut = {
        let machine = machine_for_listen.clone();
        async move {
            info!("Running listen on port 8080...");
            match listen(machine.clone(), 8080).await {
                Ok(_) => info!("Listen completed successfully."),
                Err(e) => eprintln!("Listen failed: {}", e),
            }
        }
    };

    let connect_fut = {
        let machine = machine_for_connect.clone();
        async move {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            info!("Running connect to port 8080...");
            match connect(machine.clone(), 8080).await {
                Ok(_) => info!("Connect completed successfully."),
                Err(e) => eprintln!("Connect failed: {}", e),
            }
        }
    };

    tokio::join!(listen_fut, connect_fut);

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
