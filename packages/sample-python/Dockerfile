# Build stage
FROM ubuntu:24.04@sha256:440dcf6a5640b2ae5c77724e68787a906afb8ddee98bf86db94eea8528c2c076 AS base
ENV DEBIAN_FRONTEND=noninteractive

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  : "${SOURCE_DATE_EPOCH:=$(stat --format=%Y /etc/apt/sources.list.d/ubuntu.sources)}" && \
  snapshot="$(/bin/bash -euc "printf \"%(%Y%m%dT%H%M%SZ)T\n\" \"${SOURCE_DATE_EPOCH}\"")" && \
  : "Enabling snapshot" && \
  echo $snapshot > /etc/snapshot-date && \
  touch -d @${SOURCE_DATE_EPOCH} /etc/snapshot-date && \
  sed -i -e '/Types: deb/ a\Snapshot: true' /etc/apt/sources.list.d/ubuntu.sources && \
  sed -i "s/archive.ubuntu.com\/ubuntu\//snapshot.ubuntu.com\/ubuntu\/${snapshot}/" /etc/apt/sources.list.d/ubuntu.sources && \
  sed -i "s/security.ubuntu.com\/ubuntu\//snapshot.ubuntu.com\/ubuntu\/${snapshot}/" /etc/apt/sources.list.d/ubuntu.sources && \
  sed -i "s/ports.ubuntu.com\/ubuntu-ports\//snapshot.ubuntu.com\/ubuntu\/${snapshot}/" /etc/apt/sources.list.d/ubuntu.sources && \
  : "Enabling cache" && \
  rm -f /etc/apt/apt.conf.d/docker-clean && \
  echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' >/etc/apt/apt.conf.d/keep-cache && \
  : "Fetching the snapshot and installing ca-certificates in one command" && \
  apt-get install --update -o Acquire::Check-Valid-Until=false -o Acquire::https::Verify-Peer=false -y ca-certificates && \
  rm -rf /var/log/* /var/cache/ldconfig/aux-cache

# Runtime stage - minimal image
FROM base AS runtime

# Install Python 3 runtime (includes dataclasses and other stdlib modules)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get install -y --no-install-recommends curl python3-minimal libpython3-stdlib python3-aiohttp && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* && \
    : "Clean up for improving reproducibility (optional)" && \
    rm -rf /var/log/* /var/cache/ldconfig/aux-cache

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