#!/bin/sh
ip link set lo up
ip addr
socat VSOCK-LISTEN:8080,fork TCP:127.0.0.1:8080 &
socat VSOCK-LISTEN:8022,fork TCP:127.0.0.1:22 &
#/bin/guest-agent
echo "Guest agent failed to start" >> /dev/console
while true; do
	sleep 99999
done