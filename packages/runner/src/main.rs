use cartesi_machine::{config::runtime::RuntimeConfig, machine::Machine};
use env_logger::Builder;
use log::{info, LevelFilter};
use std::error::Error;
use std::io::Write;
use std::path::Path;
mod http_service;
mod utils;
use crate::utils::{receive_packet, send_packet, vsock_connect};
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
use tokio::net::TcpListener;
use tokio::net::TcpStream;
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

async fn connect(port: u32) -> Result<(), Box<dyn Error>> {
    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;
    vsock_connect(&mut machine, port)?;
    run_health_check(&mut machine).await;
    info!("Socket connection established on port {}", port);
    let addr: SocketAddr = ([127, 0, 0, 1], port as u16).into();
    match TcpStream::connect(addr).await {
        Ok(mut stream) => {
            info!("TCP connection established to {}", addr);
            let http_request =
                "GET /data HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
            use tokio::io::AsyncWriteExt;
            if let Err(e) = stream.write(http_request.as_bytes()).await {
                eprintln!("Write error: {}", e);
            }
        }
        Err(e) => {
            eprintln!("TCP connection failed: {}", e);
        }
    }

    Ok(())
}

async fn listen(port: u32) -> Result<(), Box<dyn Error>> {
    let addr: SocketAddr = ([127, 0, 0, 1], port as u16).into();
    let listener = TcpListener::bind(addr).await?;

    info!("HTTP server started on port {}", port);

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
async fn main() -> Result<(), Box<dyn Error>> {
    setup_logger();
    info!("START RUNNER");
    info!("________________________________________________________");

    info!("Starting HTTP server on port 8081...");
    tokio::spawn(async {
        if let Err(e) = listen(8081).await {
            eprintln!("Listen failed: {}", e);
        }
    });
    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;
    run_health_check(&mut machine).await;

    //run_vsock_tcp_proxy(machine).await?;

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    info!("Testing connect function to port 8081...");
    if let Err(e) = connect(8081).await {
        eprintln!("Connect test failed: {}", e);
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
