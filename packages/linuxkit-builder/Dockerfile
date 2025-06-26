# syntax=docker/dockerfile:1.4

FROM golang:1.23 as builder

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

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates docker.io
COPY --from=builder /src/bin/linuxkit /usr/local/bin/linuxkit

ENTRYPOINT ["linuxkit"] 