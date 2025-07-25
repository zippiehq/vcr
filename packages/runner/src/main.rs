use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;
mod http_service;
mod utils;
use crate::utils::{receive_packet, send_packet};
use bytes::Bytes;
use http_body_util::Full;
use http_service::HttpService;
use hyper::body::Incoming;
use hyper::Request;
use hyper::Response;
use hyper_util::rt::TokioIo;
use reqwest::Client;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use vsock_protocol::{VSOCK_OP_REQUEST, VSOCK_OP_RESPONSE, VSOCK_OP_RW};

/// The path to the machine snapshot.
const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";
/// The port the guest machine is listening on.
const GUEST_PORT: u32 = 8080;

async fn handle(req: Request<Incoming>) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    match req.uri().path() {
        "/health" => Ok(Response::new(Full::new(Bytes::from("OK")))),
        "/data" => Ok(Response::new(Full::new(Bytes::from(
            "Data was sent successfully!",
        )))),
        _ => Ok(Response::builder()
            .status(404)
            .body(Full::new(Bytes::from("Not Found")))
            .unwrap()),
    }
}

async fn run_vsock_tcp_proxy(mut machine: Machine) -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new();
    loop {
        match receive_packet(&mut machine) {
            Ok(Some(packet)) if packet.hdr().op == VSOCK_OP_REQUEST => {
                let guest_port = packet.hdr().src_port;
                let payload = packet.payload();
                send_packet(&mut machine, guest_port, VSOCK_OP_RESPONSE, payload)?;
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
) -> Result<(), Box<dyn std::error::Error>> {
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

async fn run_http_host_service() -> Result<(), Box<dyn Error>> {
    let addr: SocketAddr = ([127, 0, 0, 1], 8081).into();
    let listener = TcpListener::bind(addr).await?;
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.expect("Failed to accept");
            let io = TokioIo::new(stream);
            tokio::spawn(async move {
                if let Err(err) = hyper::server::conn::http1::Builder::new()
                    .serve_connection(io, hyper::service::service_fn(handle))
                    .await
                {
                    eprintln!("server error: {}", err);
                }
            });
        }
    });
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;
    run_health_check(&mut machine).await;

    run_http_host_service().await?;

    run_vsock_tcp_proxy(machine).await?;

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
