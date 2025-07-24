use cartesi_machine::{Machine};
use cartesi_machine::config::runtime::RuntimeConfig;
use cartesi_nbd_server::{Export, InMemoryExport, Server};
use std::error::Error;
use std::path::Path;
const MACHINE_PATH: &str = "../../vc-cm-snapshot-release";

#[tokio::test]
async fn test_cartesi_machine_interaction() -> Result<(), Box<dyn Error>> {
    let mut export = InMemoryExport::new(1024);
    export.write(0, b"Data from nbd server").await?;
    let server = Server::new("127.0.0.1:0", export).await?;
    let _addr = server.listener.local_addr()?;
    tokio::spawn(server.run());

    let mut machine = Machine::load(Path::new(MACHINE_PATH), &RuntimeConfig::default())?;

    let result = machine.run(u64::MAX)?;
    println!("Machine execution result: {:?}", result);

    Ok(())
} 