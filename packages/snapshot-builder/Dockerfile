# Pull vcr-kernels image if not available locally

FROM --platform=linux/amd64 ghcr.io/zippiehq/vcr-kernels@sha256:ce8b06ba75a228b818cdb58191b99a7a1f4eaec83273d05538b777888182fb65 as kernels

FROM golang:1.23 as linuxkit-builder

ARG TARGETARCH
ENV CGO_ENABLED=0

RUN apt-get update && apt-get install -y make git file

WORKDIR /src
RUN git clone https://github.com/linuxkit/linuxkit.git . \
    && git checkout b42e1a8babbaf3a264a21aa6bcd657b1b4d5bfc6
RUN mkdir -p bin

# Build for the requested architecture
RUN make GOOS=linux GOARCH=$TARGETARCH LOCAL_TARGET=$(pwd)/bin/linuxkit local-build && \
    file bin/linuxkit

FROM rust:1.85.1 as vhost


WORKDIR /build
RUN git clone --depth=1 -b feat/forward_map https://github.com/zippiehq/vhost-device.git && cd vhost-device && git checkout 3628646155a134bfbfc657c3fc38a3325adea181
#RUN git clone --depth=1 https://github.com/rust-vmm/vhost-device
# Set working directory to the vsock device
WORKDIR /build/vhost-device/vhost-device-vsock

# Build and install the binary to /usr/bin
RUN cargo install --path . --root /usr && \
    strip /usr/bin/vhost-device-vsock

FROM ubuntu:24.04 AS qemu-builder
RUN apt-get update && apt-get install -y build-essential git curl pkg-config libglib2.0-dev python3 python3-venv ninja-build
RUN curl -OL https://download.qemu.org/qemu-10.0.2.tar.xz
RUN tar xJf qemu-10.0.2.tar.xz
RUN cd qemu-10.0.2 && ./configure --prefix=/usr --target-list=riscv64-softmmu && make -j$(nproc)
RUN cd qemu-10.0.2 && make install && strip /usr/bin/qemu-system-riscv64

# Final stage: copy artifacts to clean image
FROM ubuntu:24.04

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
        openssh-client ipxe-qemu qemu-system-data \
        ca-certificates socat && \
    rm -rf /var/lib/apt/lists/*

COPY --from=qemu-builder /usr/bin/qemu-system-riscv64 /usr/bin/qemu-system-riscv64
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
COPY --from=kernels /usr/share/qemu/perf-qemu-riscv64 /usr/share/qemu/perf-qemu-riscv64
COPY --from=vhost /usr/bin/vhost-device-vsock /usr/bin/vhost-device-vsock

# Copy LinuxKit binary from linuxkit-builder stage
COPY --from=linuxkit-builder /src/bin/linuxkit /usr/local/bin/linuxkit

CMD ["/bin/bash"] 
