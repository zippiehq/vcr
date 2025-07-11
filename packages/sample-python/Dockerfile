# Build stage
FROM ubuntu:24.04@sha256:440dcf6a5640b2ae5c77724e68787a906afb8ddee98bf86db94eea8528c2c076 AS base
ENV DEBIAN_FRONTEND=noninteractive

RUN <<EOF
set -eu
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
apt-get update --snapshot=20250707T074213Z
EOF
# Runtime stage - minimal image
FROM base AS runtime

# Install Python 3 runtime (includes dataclasses and other stdlib modules)
RUN apt-get install -y --no-install-recommends python3-minimal libpython3-stdlib python3-aiohttp && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash app

# Copy virtual environment from builder
COPY ./app.py /app/app.py
RUN cd /app; python3 -m compileall --invalidation-mode checked-hash .

# Set up environment
RUN mkdir -p /app
WORKDIR /app

# Change ownership to app user
RUN chown -R app:app /app

# Switch to non-root user
USER app

# Expose port
EXPOSE 8080

# Run the application
CMD ["python3", "app.py"] 