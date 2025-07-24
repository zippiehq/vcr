use async_trait::async_trait;
use byteorder::{BigEndian, ByteOrder};
use std::error::Error;
use std::io;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

pub const NBD_MAGIC: u64 = 0x4e42444d41474943;
pub const NBD_OPT_MAGIC: u64 = 0x49484156454f5054;
pub const NBD_REQUEST_MAGIC: u32 = 0x25609513;
pub const NBD_RESPONSE_MAGIC: u32 = 0x67446698;

pub const NBD_CMD_READ: u16 = 0;
pub const NBD_CMD_WRITE: u16 = 1;
pub const NBD_CMD_DISC: u16 = 2;

pub const NBD_SUCCESS: u32 = 0;
const NBD_EINVAL: u32 = 1;

#[async_trait]
pub trait Export: Send + Sync {
    async fn read(&mut self, offset: u64, len: u32) -> io::Result<Vec<u8>>;
    async fn write(&mut self, offset: u64, data: &[u8]) -> io::Result<()>;
    fn size(&self) -> u64;
}

#[derive(Debug, Clone)]
pub struct InMemoryExport {
    data: Vec<u8>,
}

impl InMemoryExport {
    pub fn new(size: usize) -> InMemoryExport {
        InMemoryExport {
            data: vec![0; size],
        }
    }
}

#[async_trait]
impl Export for InMemoryExport {
    async fn read(&mut self, offset: u64, len: u32) -> io::Result<Vec<u8>> {
        let start = offset as usize;
        let end = start.saturating_add(len as usize);
        self.data
            .get_mut(start..end)
            .map(|s| s.to_vec())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Read out of bounds"))
    }

    async fn write(&mut self, offset: u64, data: &[u8]) -> io::Result<()> {
        let start = offset as usize;
        let end = start.saturating_add(data.len());
        if let Some(slice) = self.data.get_mut(start..end) {
            slice.copy_from_slice(data);
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Write out of bounds",
            ))
        }
    }

    fn size(&self) -> u64 {
        self.data.len() as u64
    }
}

struct Request {
    command: u16,
    handle: u64,
    offset: u64,
    length: u32,
}

impl Request {
    async fn from_stream(stream: &mut TcpStream) -> std::io::Result<Self> {
        let mut buf = [0u8; 28];
        stream.read_exact(&mut buf).await?;

        if BigEndian::read_u32(&buf[0..4]) != NBD_REQUEST_MAGIC {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Invalid NBD request magic",
            ));
        }

        Ok(Request {
            command: BigEndian::read_u16(&buf[4..6]),
            handle: BigEndian::read_u64(&buf[8..16]),
            offset: BigEndian::read_u64(&buf[16..24]),
            length: BigEndian::read_u32(&buf[24..28]),
        })
    }
}

struct Response {
    handle: u64,
    error: u32,
}

impl Response {
    fn new(handle: u64, error: u32) -> Self {
        Self { handle, error }
    }

    async fn write_to(&self, stream: &mut TcpStream) -> std::io::Result<()> {
        let mut buf = [0u8; 16];
        BigEndian::write_u32(&mut buf[0..4], NBD_RESPONSE_MAGIC);
        BigEndian::write_u32(&mut buf[4..8], self.error);
        BigEndian::write_u64(&mut buf[8..16], self.handle);
        stream.write_all(&buf).await
    }
}

pub struct Server {
    pub listener: TcpListener,
    export: Arc<Mutex<dyn Export>>,
}

impl Server {
    pub async fn new(
        address: &str,
        export: impl Export + 'static,
    ) -> Result<Self, Box<dyn Error>> {
        let listener = TcpListener::bind(address).await?;
        Ok(Server {
            listener,
            export: Arc::new(Mutex::new(export)),
        })
    }

    pub async fn run(self) {
        println!(
            "NBD server listening on {}",
            self.listener.local_addr().unwrap()
        );

        loop {
            let (stream, addr) = self.listener.accept().await.unwrap();
            println!("Accepted connection from {}", addr);
            let export = self.export.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_client(stream, export).await {
                    eprintln!("Error handling client {}: {}", addr, e);
                }
            });
        }
    }
}

async fn perform_handshake(stream: &mut TcpStream, export_size: u64) -> std::io::Result<()> {
    let mut handshake = [0u8; 124];
    BigEndian::write_u64(&mut handshake[0..8], NBD_MAGIC);
    BigEndian::write_u64(&mut handshake[8..16], NBD_OPT_MAGIC);
    BigEndian::write_u64(&mut handshake[16..24], export_size);
    BigEndian::write_u16(&mut handshake[24..26], 0); // Flags
    stream.write_all(&handshake).await
}

async fn handle_request_command(
    stream: &mut TcpStream,
    export: &Arc<Mutex<dyn Export>>,
    request: Request,
) -> Result<bool, Box<dyn Error + Send + Sync>> {
    match request.command {
        NBD_CMD_READ => {
            let data = export
                .lock()
                .await
                .read(request.offset, request.length)
                .await?;
            Response::new(request.handle, NBD_SUCCESS)
                .write_to(stream)
                .await?;
            stream.write_all(&data).await?;
        }
        NBD_CMD_WRITE => {
            let mut buffer = vec![0u8; request.length as usize];
            stream.read_exact(&mut buffer).await?;
            export
                .lock()
                .await
                .write(request.offset, &buffer)
                .await?;
            Response::new(request.handle, NBD_SUCCESS)
                .write_to(stream)
                .await?;
        }
        NBD_CMD_DISC => return Ok(false),
        _ => {
            Response::new(request.handle, NBD_EINVAL)
                .write_to(stream)
                .await?;
        }
    }
    Ok(true)
}

async fn handle_requests(
    stream: &mut TcpStream,
    export: &Arc<Mutex<dyn Export>>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    loop {
        let request = match Request::from_stream(stream).await {
            Ok(req) => req,
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        if !handle_request_command(stream, export, request).await? {
            break;
        }
    }
    Ok(())
}

async fn handle_client(
    mut stream: TcpStream,
    export: Arc<Mutex<dyn Export>>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let export_size = export.lock().await.size();
    perform_handshake(&mut stream, export_size).await?;
    handle_requests(&mut stream, &export).await
} 