use std::convert::TryInto;
use std::io::{self, Read};
use std::mem;

/// A vsock packet, with a header and a payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    hdr: VirtioVsockHdr,
    payload: Vec<u8>,
}

impl Packet {
    /// Creates a new packet with the given header and payload.
    pub fn new(hdr: VirtioVsockHdr, payload: Vec<u8>) -> Self {
        Self { hdr, payload }
    }

    /// Returns a reference to the packet's header.
    pub fn hdr(&self) -> &VirtioVsockHdr {
        &self.hdr
    }

    /// Returns a reference to the packet's payload.
    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    /// Consumes the packet and returns its header and payload.
    pub fn into_parts(self) -> (VirtioVsockHdr, Vec<u8>) {
        (self.hdr, self.payload)
    }

    /// Serializes the full packet (header and payload) into a byte vector.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = self.hdr.to_bytes();
        bytes.extend_from_slice(&self.payload);
        bytes
    }

    /// Reads a full vsock packet from the given reader.
    pub fn from_read(mut reader: impl Read) -> io::Result<Self> {
        let mut hdr_buf = vec![0; HDR_SIZE];
        reader.read_exact(&mut hdr_buf)?;

        let hdr = VirtioVsockHdr::from_bytes(&hdr_buf)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid vsock header"))?;

        if hdr.len > 4096 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Payload too large",
            ));
        }

        let mut payload = vec![0; hdr.len as usize];
        if hdr.len > 0 {
            reader.read_exact(&mut payload)?;
        }

        Ok(Self { hdr, payload })
    }

    /// Creates a packet from a byte slice.
    /// The byte slice is expected to contain the full packet (header + payload).
    pub fn from_bytes(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() < HDR_SIZE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Packet smaller than header",
            ));
        }

        let hdr = VirtioVsockHdr::from_bytes(&bytes[..HDR_SIZE])
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Invalid vsock header"))?;

        let payload_len = hdr.len as usize;
        let expected_total_len = HDR_SIZE + payload_len;

        if bytes.len() < expected_total_len {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Packet smaller than indicated by header length",
            ));
        }

        let payload = bytes[HDR_SIZE..expected_total_len].to_vec();

        Ok(Self { hdr, payload })
    }
}

/// The header for a virtio vsock packet.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct VirtioVsockHdr {
    pub src_cid: u32,
    pub dst_cid: u32,
    pub src_port: u32,
    pub dst_port: u32,
    pub len: u32,
    pub type_: u16,
    pub op: u16,
    pub flags: u32,
    pub buf_alloc: u32,
    pub fwd_cnt: u32,
}

pub const VSOCK_TYPE_STREAM: u16 = 1;

pub const VSOCK_OP_REQUEST: u16 = 1;
pub const VSOCK_OP_RESPONSE: u16 = 2;
pub const VSOCK_OP_RST: u16 = 3;
pub const VSOCK_OP_SHUTDOWN: u16 = 4;
pub const VSOCK_OP_RW: u16 = 5;
pub const VSOCK_OP_CREDIT_UPDATE: u16 = 6;
pub const VSOCK_OP_CREDIT_REQUEST: u16 = 7;

pub const HDR_SIZE: usize = mem::size_of::<VirtioVsockHdr>();

impl VirtioVsockHdr {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HDR_SIZE);
        bytes.extend_from_slice(&self.src_cid.to_le_bytes());
        bytes.extend_from_slice(&self.dst_cid.to_le_bytes());
        bytes.extend_from_slice(&self.src_port.to_le_bytes());
        bytes.extend_from_slice(&self.dst_port.to_le_bytes());
        bytes.extend_from_slice(&self.len.to_le_bytes());
        bytes.extend_from_slice(&self.type_.to_le_bytes());
        bytes.extend_from_slice(&self.op.to_le_bytes());
        bytes.extend_from_slice(&self.flags.to_le_bytes());
        bytes.extend_from_slice(&self.buf_alloc.to_le_bytes());
        bytes.extend_from_slice(&self.fwd_cnt.to_le_bytes());
        bytes
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < HDR_SIZE {
            return None;
        }

        let src_cid = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
        let dst_cid = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        let src_port = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let dst_port = u32::from_le_bytes(bytes[12..16].try_into().unwrap());
        let len = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
        let type_ = u16::from_le_bytes(bytes[20..22].try_into().unwrap());
        let op = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
        let flags = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let buf_alloc = u32::from_le_bytes(bytes[28..32].try_into().unwrap());
        let fwd_cnt = u32::from_le_bytes(bytes[32..36].try_into().unwrap());

        Some(VirtioVsockHdr {
            src_cid,
            dst_cid,
            src_port,
            dst_port,
            len,
            type_,
            op,
            flags,
            buf_alloc,
            fwd_cnt,
        })
    }
}
