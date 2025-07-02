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
    wget -O dep/linux-6.15.4.tar.xz https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.15.4.tar.xz && \
    echo "0eafd627b602f58d73917d00e4fc3196ba18cba67df6995a42aa74744d8efa16  dep/linux-6.15.4.tar.xz" | sha256sum -c

# Download and verify OpenSBI
RUN wget -O dep/opensbi-1.3.1-ctsi-2.tar.gz https://github.com/cartesi/opensbi/archive/refs/tags/v1.3.1-ctsi-2.tar.gz && \
    echo "35082380131117aa8424d1b81ca9e6e0280baa9bffbcf3f46080a652e4cb4385  dep/opensbi-1.3.1-ctsi-2.tar.gz" | sha256sum -c

# Extract Linux kernel
RUN tar xf dep/linux-6.15.4.tar.xz \
  --strip-components=1 --one-top-level=linux

RUN mv linux linux-2
RUN tar xf dep/linux-6.15.4.tar.xz \
  --strip-components=1 --one-top-level=linux && \
  rm dep/linux-6.15.4.tar.xz

# Extract OpenSBI
RUN tar xzf dep/opensbi-1.3.1-ctsi-2.tar.gz \
  --strip-components=1 --one-top-level=opensbi && \
  rm dep/opensbi-1.3.1-ctsi-2.tar.gz

# Copy CM kernel configuration
COPY kernel-config linux/.config

# Build kernel with deterministic timestamps
WORKDIR /work/linux
COPY 0001-cartesi-port-cmio-to-6.15.patch /work/linux/0001-cartesi-port-cmio-to-6.15.patch
RUN patch -p1 < 0001-cartesi-port-cmio-to-6.15.patch
RUN SOURCE_DATE_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) olddefconfig

RUN SOURCE_DATE_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) vmlinux Image

RUN sha256sum /work/linux/arch/riscv/boot/Image

# Verify linux kernel Image hash
RUN echo "298b201898cffb9d5daa4667e6ac23a541b2ea20c9dfede63fe5ac65ee7802ca  /work/linux/arch/riscv/boot/Image" | sha256sum -c || (echo "❌ Linux kernel Image hash verification failed" && exit 1)

# Build kernel with deterministic timestamps
WORKDIR /work/linux-2
RUN SOURCE_DATE_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) defconfig

RUN echo "CONFIG_RISCV_SBI_V01=y" >> .config

# Add SquashFS configuration options
RUN echo "CONFIG_SQUASHFS=y" >> .config && \
    echo "CONFIG_SQUASHFS_FILE_CACHE=y" >> .config && \
    echo "# CONFIG_SQUASHFS_FILE_DIRECT is not set" >> .config && \
    echo "CONFIG_SQUASHFS_DECOMP_SINGLE=y" >> .config && \
    echo "# CONFIG_SQUASHFS_CHOICE_DECOMP_BY_MOUNT is not set" >> .config && \
    echo "CONFIG_SQUASHFS_COMPILE_DECOMP_SINGLE=y" >> .config && \
    echo "# CONFIG_SQUASHFS_COMPILE_DECOMP_MULTI is not set" >> .config && \
    echo "# CONFIG_SQUASHFS_COMPILE_DECOMP_MULTI_PERCPU is not set" >> .config && \
    echo "CONFIG_SQUASHFS_XATTR=y" >> .config && \
    echo "CONFIG_SQUASHFS_ZLIB=y" >> .config && \
    echo "# CONFIG_SQUASHFS_LZ4 is not set" >> .config && \
    echo "# CONFIG_SQUASHFS_LZO is not set" >> .config && \
    echo "CONFIG_SQUASHFS_XZ=y" >> .config && \
    echo "CONFIG_SQUASHFS_ZSTD=y" >> .config && \
    echo "CONFIG_SQUASHFS_4K_DEVBLK_SIZE=y" >> .config && \
    echo "# CONFIG_SQUASHFS_EMBEDDED is not set" >> .config && \
    echo "CONFIG_SQUASHFS_FRAGMENT_CACHE_SIZE=3" >> .config && \
    echo "CONFIG_OVERLAY_FS=y" >> .config

RUN SOURCE_DATE_EPOCH=0 ARCH=riscv CROSS_COMPILE=riscv64-linux-gnu- KBUILD_BUILD_TIMESTAMP="Thu, 01 Jan 1970 00:00:00 +0000" KBUILD_BUILD_USER=builder KBUILD_BUILD_HOST=builder make -j$(nproc) vmlinux Image

# Verify linux-2 kernel Image hash
RUN sha256sum /work/linux-2/arch/riscv/boot/Image
RUN echo "e2cc19987a6789cd4ce9c3c7e0eccf33913ea51fde166d5bdc99df240227e37b  /work/linux-2/arch/riscv/boot/Image" | sha256sum -c || (echo "❌ Linux-2 kernel Image hash verification failed" && exit 1)

# Build OpenSBI with kernel payload
WORKDIR /work/opensbi
RUN SOURCE_DATE_EPOCH=0 make FW_PAYLOAD=y FW_OPTIONS=0x01 PLATFORM=cartesi CROSS_COMPILE=riscv64-linux-gnu- FW_PAYLOAD_PATH=/work/linux/arch/riscv/boot/Image

RUN sha256sum /work/opensbi/build/platform/cartesi/firmware/fw_payload.bin
# Verify OpenSBI firmware hash
RUN echo "3a92891c6ab4f9040b4f90e7d53283b5068ad6a0364d3a65d91da3fca4543565  /work/opensbi/build/platform/cartesi/firmware/fw_payload.bin" | sha256sum -c || (echo "❌ OpenSBI firmware hash verification failed" && exit 1)

# Final stage: copy artifacts to clean image
FROM debian:bookworm-slim

RUN mkdir -p /usr/share/cartesi-machine/images /usr/share/qemu/images

COPY --from=0 /work/opensbi/build/platform/cartesi/firmware/fw_payload.bin /usr/share/cartesi-machine/images/linux.bin
COPY --from=0 /work/linux/.config /usr/share/cartesi-machine/images/linux.bin.config
COPY --from=0 /work/linux-2/arch/riscv/boot/Image /usr/share/qemu/images/linux-riscv64-Image
COPY --from=0 /work/linux-2/.config /usr/share/qemu/images/linux-riscv64-Image.config

CMD ["/bin/bash"] 