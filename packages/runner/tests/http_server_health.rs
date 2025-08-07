use runner::http_client::HttpClient;
use runner::http_server::HttpServer;
use runner::utils::Client;

#[test]
fn test_health_check_endpoint() {
    let mut server = HttpServer::new(8080);
    let mut client = HttpClient::new(9000);
    client.make_request(8080, "GET", "/health", "localhost:8080");
    let request_data = client.get_write_data(8080).expect("Should have request data");
    println!("Request data: {:?}", String::from_utf8_lossy(&request_data));
    let response = server.handle_http_request(&request_data).expect("Should return a response");
    println!("Response: {:?}", String::from_utf8_lossy(&response));
}