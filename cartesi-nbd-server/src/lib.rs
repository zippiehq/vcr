use async_trait::async_trait;
use std::io;

pub mod server;

pub const NBD_MAGIC: u64 = 0x4e42444d41474943;
pub const NBD_OPT_MAGIC: u64 = 0x49484156454f5054;
pub const NBD_REQUEST_MAGIC: u32 = 0x25609513;
pub const NBD_REPLY_MAGIC: u32 = 0x67446698;

pub const NBD_CMD_READ: u16 = 0;
pub const NBD_CMD_WRITE: u16 = 1;
pub const NBD_CMD_DISC: u16 = 2;
const NBD_EINVAL: u32 = 1;

pub const NBD_SUCCESS: u32 = 0;

#[async_trait]
pub trait Blocks: Send + Sync {
    async fn read(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<()>;
    async fn write(&mut self, offset: u64, data: &[u8]) -> io::Result<()>;
    fn size(&self) -> u64;
}

#[derive(Debug, Clone)]
pub struct MemBlocks {
    data: Vec<u8>,
}

impl MemBlocks {
    pub fn new(size: usize) -> MemBlocks {
        MemBlocks {
            data: vec![0; size],
        }
    }
}

#[async_trait]
impl Blocks for MemBlocks {
    async fn read(&mut self, offset: u64, buf: &mut [u8]) -> io::Result<()> {
        let start = offset as usize;
        let end = start.saturating_add(buf.len());
        if end > self.data.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Read out of bounds",
            ));
        }
        let slice = &self.data[start..end];
        buf.copy_from_slice(slice);
        Ok(())
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