FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        build-essential autoconf automake libtool libtool-bin autotools-dev libclang-dev \
        git make pkg-config patchutils gawk bison flex ca-certificates gnupg \
        device-tree-compiler libmpc-dev libmpfr-dev libgmp-dev rsync cpio \
        libusb-1.0-0-dev texinfo gperf bc zlib1g-dev libncurses-dev \
        wget vim wget curl zip unzip libexpat-dev python3 help2man \
        gcc-riscv64-linux-gnu g++-riscv64-linux-gnu binutils-riscv64-linux-gnu

WORKDIR /work

# Download and verify Cartesi Linux kernel - note: this can be updated to non-cartesi 6.15.3
RUN mkdir -p dep && \
    wget -O dep/linux-6.5.13-ctsi-1.tar.gz https://github.com/cartesi/linux/archive/refs/tags/v6.5.13-ctsi-1.tar.gz && \
    echo "24f3326aad2aa630c6fb2192305b70963ca67c03b0218cdcd09033cbefc9e52d  dep/linux-6.5.13-ctsi-1.tar.gz" | sha256sum -c

# Download and verify OpenSBI
RUN wget -O dep/opensbi-1.3.1-ctsi-2.tar.gz https://github.com/cartesi/opensbi/archive/refs/tags/v1.3.1-ctsi-2.tar.gz && \
    echo "35082380131117aa8424d1b81ca9e6e0280baa9bffbcf3f46080a652e4cb4385  dep/opensbi-1.3.1-ctsi-2.tar.gz" | sha256sum -c

# Extract Linux kernel
RUN tar xzf dep/linux-6.5.13-ctsi-1.tar.gz \
  --strip-components=1 --one-top-level=linux

RUN mv linux linux-2
RUN tar xzf dep/linux-6.5.13-ctsi-1.tar.gz \
  --strip-components=1 --one-top-level=linux && \
  rm dep/linux-6.5.13-ctsi-1.tar.gz

# Extract OpenSBI
RUN tar xzf dep/opensbi-1.3.1-ctsi-2.tar.gz \
  --strip-components=1 --one-top-level=opensbi && \
  rm dep/opensbi-1.3.1-ctsi-2.tar.gz

# Copy kernel configuration
COPY kernel-config linux/.config

# Build kernel with deterministic timestamps
WORKDIR /work/linux
RUN SOURCE_DATA_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) olddefconfig

RUN SOURCE_DATA_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) vmlinux Image

RUN sha256sum /work/linux/arch/riscv/boot/Image

# Build kernel with deterministic timestamps
WORKDIR /work/linux-2
RUN SOURCE_DATA_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) defconfig

RUN echo "CONFIG_RISCV_SBI_V01=y" >> .config

RUN SOURCE_DATA_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) vmlinux Image

RUN sha256sum /work/linux-2/arch/riscv/boot/Image

# Build OpenSBI with kernel payload
WORKDIR /work/opensbi
RUN SOURCE_DATA_EPOCH=0 make FW_PAYLOAD=y FW_OPTIONS=0x01 PLATFORM=cartesi CROSS_COMPILE=riscv64-linux-gnu- FW_PAYLOAD_PATH=/work/linux/arch/riscv/boot/Image

# Final stage: copy artifacts to clean image
FROM debian:bookworm-slim

RUN mkdir -p /usr/share/cartesi-machine/images /usr/share/qemu/images

COPY --from=0 /work/opensbi/build/platform/cartesi/firmware/fw_payload.bin /usr/share/cartesi-machine/images/linux.bin
COPY --from=0 /work/linux/.config /usr/share/cartesi-machine/images/linux.bin.config
COPY --from=0 /work/linux-2/arch/riscv/boot/Image /usr/share/qemu/images/linux-riscv64-Image
COPY --from=0 /work/linux-2/.config /usr/share/qemu/images/linux-riscv64-Image.config

CMD ["/bin/bash"] 