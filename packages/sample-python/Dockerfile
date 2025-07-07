# Build stage
FROM ubuntu:24.04@sha256:440dcf6a5640b2ae5c77724e68787a906afb8ddee98bf86db94eea8528c2c076 AS base
ARG APT_UPDATE_SNAPSHOT=20250707T074213Z
ARG APT_UPDATE_SNAPSHOT
ARG DEBIAN_FRONTEND=noninteractive

RUN <<EOF
set -eu
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
apt-get update --snapshot=${APT_UPDATE_SNAPSHOT}
EOF


FROM base AS builder
# Install Python 3 and pip for building
RUN apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Create virtual environment and install dependencies
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Compile Python bytecode
RUN python -m compileall --invalidation-mode checked-hash .

# Runtime stage - minimal image
FROM base AS runtime

# Install Python 3 runtime (includes dataclasses and other stdlib modules)
RUN apt-get install -y --no-install-recommends python3-minimal libpython3-stdlib && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash app

# Copy virtual environment from builder
COPY --from=builder /app/venv /app/venv
COPY --from=builder /app/app.py /app/app.py

# Set up environment
ENV PATH="/app/venv/bin:$PATH"
WORKDIR /app

# Change ownership to app user
RUN chown -R app:app /app

# Switch to non-root user
USER app

# Expose port
EXPOSE 8080

# Run the application
CMD ["python", "app.py"] 