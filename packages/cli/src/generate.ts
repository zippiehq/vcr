import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { homedir } from 'os';
import { getPathHash, getComposeCacheDirectory } from './cli';
import { sshDebugKey, sshDebugKeyPub } from './keys';
import { createHash } from 'crypto';

function getCacheDirectory(ociTarPath?: string): string {
  const pathHash = getPathHash();
  const baseCacheDir = join(homedir(), '.cache', 'vcr', pathHash);
  
  if (ociTarPath) {
    // Create a hash of the OCI tar path for cache directory
    const pathHash = createHash('sha256').update(ociTarPath).digest('hex').substring(0, 8);
    return join(baseCacheDir, pathHash);
  }
  
  return baseCacheDir;
}

export function generateLinuxKitYaml(imageTag: string, profile: string, cacheDir?: string, ociTarPath?: string) {
  const pathHash = getPathHash();
  
  // Generate SSH debug keys
  const sshKeyPath = cacheDir ? join(cacheDir, 'ssh.debug-key') : join(cwd(), 'ssh.debug-key');
  const sshKeyPubPath = cacheDir ? join(cacheDir, 'ssh.debug-key.pub') : join(cwd(), 'ssh.debug-key.pub');
  
  if (!existsSync(sshKeyPath)) {
    writeFileSync(sshKeyPath, sshDebugKey);
    chmodSync(sshKeyPath, 0o600);
  }
  
  if (!existsSync(sshKeyPubPath)) {
    writeFileSync(sshKeyPubPath, sshDebugKeyPub);
  }
  
  // Use the image tag directly since the OCI image is loaded into Docker
  const imageReference = imageTag;
  
  // Guest agent image
  const guestAgentImage = 'ghcr.io/zippiehq/vcr-guest-agent:latest';
  
  // Network configuration
  const netConfig = profile === 'prod' 
    ? 'net: host' 
    : 'net: host';
  
  const yamlConfig = `init:
  - ghcr.io/zippiehq/vcr-init@sha256:fd6878920ee9dd846689fc79839a82dc40f3cf568f16621f0e97a8b7b501df62
  - ghcr.io/zippiehq/vcr-runc@sha256:3f0a1027ab7507f657cafd28abff329366c0e774714eac48c4d4c10f46778596
  - ghcr.io/zippiehq/vcr-containerd@sha256:97a307ea9e3eaa21d378f903f067d742bd66abd49e5ff483ae85528bed6d4e8a
onboot:
  - name: dhcpcd
    image: ghcr.io/zippiehq/vcr-dhcpcd@sha256:3ad775c7f5402fc960d3812bec6650ffa48747fbd9bd73b62ff71b8d0bb72c5a
    command: ["/sbin/dhcpcd", "--nobackground", "-f", "/dhcpcd.conf", "-1"]
services:
  - name: getty
    image: ghcr.io/zippiehq/vcr-getty@sha256:f1e8a4fbdbc7bf52eaad06bd59aa1268c91eb11bd615d3c27e93d8a35c0d8b7a
    env:
     - INSECURE=true
  - name: sshd
    image: ghcr.io/zippiehq/vcr-linuxkit-sshd@sha256:448f0a6f0b30e7f6f4a28ab11268b07ed2fb81a4d4feb1092c0b16a126d33183
    binds.add:
      - /root/.ssh:/root/.ssh
  - name: guest-agent
    image: ${guestAgentImage}
    net: host
    binds:
      - /dev:/dev
    capabilities:
      - all
    devices:
      - path: all
  - name: app
    image: ${imageReference}
    capabilities:
      - CAP_CHOWN
      - CAP_DAC_OVERRIDE
      - CAP_FOWNER
      - CAP_FSETID
      - CAP_KILL
      - CAP_SETGID
      - CAP_SETUID
      - CAP_SETPCAP
      - CAP_NET_BIND_SERVICE
      - CAP_NET_RAW
      - CAP_SYS_CHROOT
      - CAP_MKNOD
      - CAP_AUDIT_WRITE
      - CAP_SETFCAP
${netConfig}
files:
  - path: root/.ssh/authorized_keys
    source: /cache/ssh.debug-key.pub
    mode: "0600"
`;
  
  const yamlPath = cacheDir ? join(cacheDir, 'vc.yml') : join(cwd(), 'vc.yml');
  writeFileSync(yamlPath, yamlConfig);
  console.log(`Generated LinuxKit YAML: ${yamlPath}`);
  return yamlPath;
}

export function generateDockerCompose(imageTag: string, profile: string, ociTarPath?: string) {
  // Use the image tag directly since the OCI image is loaded into Docker
  const imageReference = imageTag;
  
  const pathHash = getPathHash();
  const cacheDir = getCacheDirectory(ociTarPath);
  
  // For test and prod profiles, use snapshot-builder with different commands
  let isolatedServiceConfig;
  
  if (profile === 'test') {
    isolatedServiceConfig = {
      image: 'ghcr.io/zippiehq/vcr-snapshot-builder',
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: [
        `${cacheDir}:/work`,
        `${pathHash}_vcr_shared_data:/media/vcr`
      ],
      command: [
        '/bin/bash', '-c',
        `RUST_LOG=info vhost-device-vsock --guest-cid=4 --forward-cid=1 --forward-listen=8080+8022 --socket=/tmp/vhost.socket --tx-buffer-size=65536 --queue-size=1024 &
        socat tcp-listen:8080,fork VSOCK-CONNECT:1:8080 &
        socat tcp-listen:8022,fork VSOCK-CONNECT:1:8022 &
        sleep 1
        ps ux
qemu-system-riscv64 \
  --machine virt,memory-backend=mem0 \
  --kernel /work/vc.qemu-kernel \
  -nographic \
  -object memory-backend-memfd,id=mem0,size=512M \
  -append "root=/dev/vda rootfstype=squashfs console=ttyS0" \
  -drive "file=/work/vc.squashfs,format=raw,if=virtio" \
  -chardev socket,id=c,path=/tmp/vhost.socket \
  -device vhost-user-vsock-pci,chardev=c \
  -monitor none \
  -serial stdio`
      ],
      tty: true,
      stdin_open: true,
      restart: "no",
      healthcheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      },
      devices: [ "/dev/vsock"],
      privileged: true,
      labels: [
        'traefik.enable=true',
        'traefik.http.routers.isolated.rule=PathPrefix(`/`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        `vcr.profile=${profile}`,
        `vcr.image.tag=${imageTag}`,
        `vcr.image.path=${ociTarPath || 'none'}`,
        `vcr.build.timestamp=${new Date().toISOString()}`,
        `vcr.path.hash=${pathHash}`
      ]
    };
  } else if (profile === 'prod') {
    isolatedServiceConfig = {
      image: 'ghcr.io/zippiehq/vcr-snapshot-builder',
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: [
        `${cacheDir}:/work`,
        `${pathHash}_vcr_shared_data:/media/vcr`
      ],
      command: [
        'cartesi-machine',
        '--flash-drive=label:root,filename:/work/vc.squashfs',
        '--append-bootargs=loglevel=8 init=/sbin/init systemd.unified_cgroup_hierarchy=0 ro',
        '--skip-root-hash-check',
        '--virtio-net=user',
        '-p=0.0.0.0:8080:10.0.2.15:8080/tcp',
        '-p=0.0.0.0:8022:10.0.2.15:22/tcp',
        '-i'
      ],
      tty: true,
      stdin_open: true,
      restart: "no",
      healthcheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      },
      labels: [
        'traefik.enable=true',
        'traefik.http.routers.isolated.rule=PathPrefix(`/`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        `vcr.profile=${profile}`,
        `vcr.image.tag=${imageTag}`,
        `vcr.image.path=${ociTarPath || 'none'}`,
        `vcr.build.timestamp=${new Date().toISOString()}`,
        `vcr.path.hash=${pathHash}`
      ]
    };
  } else {
    // Default for dev profile
    isolatedServiceConfig = {
      image: imageReference,
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: [`${pathHash}_vcr_shared_data:/media/vcr`],
      restart: "no",
      healthcheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      },
      labels: [
        'traefik.enable=true',
        'traefik.http.routers.isolated.rule=PathPrefix(`/`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        `vcr.profile=${profile}`,
        `vcr.image.tag=${imageTag}`,
        `vcr.image.path=${ociTarPath || 'none'}`,
        `vcr.build.timestamp=${new Date().toISOString()}`,
        `vcr.path.hash=${pathHash}`
      ]
    };
  }
  
  const composeConfig = {
    services: {
      traefik: {
        image: 'traefik:v2.10',
        container_name: `${pathHash}-vcr-traefik`,
        hostname: 'vcr-traefik',
        restart: "no",
        command: [
          '--api.insecure=true',
          '--api.dashboard=false',
          '--api.debug=true',
          '--providers.docker=true',
          '--providers.docker.exposedbydefault=false',
          '--entrypoints.web.address=:8080',
          '--entrypoints.traefik.address=:9000'
        ],
        ports: ['8080:8080'],
        volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        networks: ['internal_net', 'external_net'],
        labels: [
          'traefik.enable=true',
          'traefik.http.routers.traefik.rule=PathPrefix(`/api`) || PathPrefix(`/dashboard`)',
          'traefik.http.routers.traefik.service=api@internal',
          'traefik.http.routers.traefik.entrypoints=traefik'
        ]
      },
      isolated_service: isolatedServiceConfig,
      internet_service: {
        image: 'alpine',
        container_name: `${pathHash}-vcr-guest-agent`,
        hostname: 'vcr-guest-agent',
        restart: "no",
        command: 'sh -c "mkdir -p /media/vcr/transient && sleep infinity"',
        networks: ['internal_net', 'external_net'],
        volumes: [`${pathHash}_vcr_shared_data:/media/vcr`]
      }
    },
    networks: {
      internal_net: {
        driver: 'bridge',
        internal: true
      },
      external_net: {
        driver: 'bridge'
      }
    },
    volumes: {
      [`${pathHash}_vcr_shared_data`]: {
        driver: 'local'
      }
    }
  };
  
  const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
  writeFileSync(composePath, JSON.stringify(composeConfig, null, 2));
  return composePath;
} 