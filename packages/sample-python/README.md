# Sample Python Server

A simple HTTP server built with Python 3 Alpine that provides a health endpoint.

## Features

- Lightweight Python 3 Alpine base image
- Health endpoint at `/health` returning 200 OK
- JSON response with status, timestamp, and service info
- Configurable port via `PORT` environment variable

## Usage

### Build the image
```bash
docker build -t sample-python .
```

### Run the container
```bash
docker run -p 8080:8080 sample-python
```

### Test the health endpoint
```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T12:00:00.000000",
  "service": "sample-python",
  "version": "1.0.0"
}
```

## Environment Variables

- `PORT`: Port to run the server on (default: 8080)

## Development

This server uses only Python standard library modules, so no external dependencies are required. 