#!/bin/sh
ip link set lo up
ip addr
socat VSOCK-LISTEN:8080,fork TCP:127.0.0.1:8080 &
socat VSOCK-LISTEN:8022,fork TCP:127.0.0.1:22 &
echo "CMIO guest agent setting: $CMIO_GUEST_AGENT" >> /dev/console
if [ x$CMIO_GUEST_AGENT != x ]; then
        RUST_LOG=debug /bin/guest-agent >> /dev/console
fi
echo "Guest agent failed to start" >> /dev/console
while true; do
        sleep 99999
done
