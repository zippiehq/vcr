# Pull vcr-kernels image if not available locally


FROM --platform=linux/amd64 ghcr.io/zippiehq/vcr-kernels:latest as kernels

FROM rust:1.85.1 as vhost

WORKDIR /build

RUN git clone --depth=1 -b feat/forward_map https://github.com/zippiehq/vhost-device.git 

# Set working directory to the vsock device
WORKDIR /build/vhost-device/vhost-device-vsock

# Build and install the binary to /usr/bin
RUN cargo install --path . --root /usr && \
    strip /usr/bin/vhost-device-vsock

# Final stage: copy artifacts to clean image
FROM debian:bookworm-slim

# Install required packages
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
    	procps \
        lua5.4 \
        libslirp0 \
        squashfs-tools \
        cryptsetup \
        wget \
        curl \
        openssh-client qemu-system-misc ipxe-qemu \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /artifacts

# Fetch and install Cartesi machine emulator
ARG TARGETARCH
RUN wget -O /tmp/machine-emulator.deb https://github.com/cartesi/machine-emulator/releases/download/v0.19.0/machine-emulator_${TARGETARCH}.deb && \
    dpkg -i /tmp/machine-emulator.deb && \
    rm /tmp/machine-emulator.deb

# Copy kernel assets from vcr-kernels image
COPY --from=kernels /usr/share/cartesi-machine/images/linux.bin /usr/share/cartesi-machine/images/linux.bin
COPY --from=kernels /usr/share/cartesi-machine/images/linux.bin.config /usr/share/cartesi-machine/images/linux.bin.config
COPY --from=kernels /usr/share/qemu/images/linux-riscv64-Image /usr/share/qemu/images/linux-riscv64-Image
COPY --from=kernels /usr/share/qemu/images/linux-riscv64-Image.config /usr/share/qemu/images/linux-riscv64-Image.config
COPY --from=vhost /usr/bin/vhost-device-vsock /usr/bin/vhost-device-vsock
CMD ["/bin/bash"] 
