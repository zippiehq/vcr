# No arm cross compiler for musl so far?
FROM --platform=linux/amd64 ubuntu:24.04 AS builder

# Install dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    libclang-dev \
    clang \
    libc6-dev-riscv64-cross \
    pkg-config \
    libssl-dev \
    musl-tools \
    musl-dev \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN wget https://github.com/cross-tools/musl-cross/releases/download/20250520/riscv64-unknown-linux-musl.tar.xz && cd /opt && tar xf /riscv64-unknown-linux-musl.tar.xz && rm -f /riscv64-unknown-linux-musl.tar.xz

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:/opt/riscv64-unknown-linux-musl/bin:${PATH}"

RUN rustup target add riscv64gc-unknown-linux-musl

# Set up cargo config for cross-compilation
RUN mkdir -p /root/.cargo && \
    echo '[target.riscv64gc-unknown-linux-musl]\n\
linker = "riscv64-unknown-linux-musl-gcc"\n\
ar = "riscv64-unknown-linux-musl-ar"\n\
rustflags = ["-C", "link-arg=-lm", "-C", "link-arg=--sysroot=/opt/riscv64-unknown-linux-musl/riscv64-unknown-linux-musl/sysroot"]\n\
\n\
[env]\n\
CC_riscv64gc_unknown_linux_musl = "riscv64-unknown-linux-musl-gcc"\n\
CXX_riscv64gc_unknown_linux_musl = "riscv64-unknown-linux-musl-g++"\n\
AR_riscv64gc_unknown_linux_musl = "riscv64-unknown-linux-musl-ar"' > /root/.cargo/config.toml

WORKDIR /build
WORKDIR /app

# Copy source files
COPY . .

RUN cd /app/packages/guest-agent && cargo build --target riscv64gc-unknown-linux-musl --release

FROM linuxkit/alpine:35b33c6b03c40e51046c3b053dd131a68a26c37a AS mirror
RUN mkdir -p /out/etc/apk && cp -r /etc/apk/* /out/etc/apk/
RUN apk add curl
RUN apk add --no-cache --initdb -p /out \
    alpine-baselayout \
    busybox \
    libgcc \
    socat \
    musl

# Remove apk residuals
RUN rm -rf /out/etc/apk /out/lib/apk /out/var/cache

FROM scratch
ENTRYPOINT []
CMD []
WORKDIR /
COPY --from=mirror /out/ /
COPY --from=builder /app/packages/guest-agent/target/riscv64gc-unknown-linux-musl/release/guest-agent /bin/guest-agent
COPY ./packages/guest-agent/entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"] 