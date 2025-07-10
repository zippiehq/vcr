import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { cwd } from 'process';
import { homedir } from 'os';
import { getPathHash, getComposeCacheDirectory } from './cli';

function getCacheDirectory(imageDigest?: string): string {
  const baseCacheDir = join(homedir(), '.cache', 'vcr');
  
  // Create base cache directory if it doesn't exist
  if (!existsSync(baseCacheDir)) {
    mkdirSync(baseCacheDir, { recursive: true });
  }
  
  if (imageDigest) {
    // Remove 'sha256:' prefix for directory name
    const digestDir = imageDigest.replace('sha256:', '');
    const digestCacheDir = join(baseCacheDir, digestDir);
    
    // Create digest-specific cache directory if it doesn't exist
    if (!existsSync(digestCacheDir)) {
      mkdirSync(digestCacheDir, { recursive: true });
    }
    
    return digestCacheDir;
  }
  
  return baseCacheDir;
}

export function generateLinuxKitYaml(imageTag: string, profile: string, cacheDir?: string, imageDigest?: string) {
  const imageReference = imageDigest ? `${imageTag}@${imageDigest}` : imageTag;
  
  // Add net: host for test and prod profiles
  const netConfig = (profile === 'test' || profile === 'prod') ? '    net: host' : '';
  
  // Check for custom guest agent image
  const guestAgentImage = process.env.CUSTOM_GUEST_AGENT_IMAGE || 'ghcr.io/zippiehq/vcr-guest-agent';
  const sshDebugKey = `-----BEGIN OPENSSH PRIVATE KEY-----
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
-----END OPENSSH PRIVATE KEY-----
`;
  const sshDebugKeyPub = `ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDBZq10zY1iasqUIRB+DPY/qrZS0ePfYJV6XJbXOuXyHvS/GQqSchIqIvysJEOGsEyrOZq2o1wCU4XNSoMmwY4BQxGLk5JZ5eKR8w2SFrqC5bNX4l9y3u8dIhU/Xd+TxUljiCzqZ+jzT6MtmzOHUVJPSbDxCKYqTR4iz6j3e7ux10JQs1XnjW8tTYOklbRv5gbIV2ZTxE7A5kTh9w+x3p7WhADfQ6ZhNw1KK/JSfavdUx6MdtfqFL5j8qnO69rkzlxhwGvRfE+uTfIURPaJ7LP6CUnzm5vtPZMm3e2UQ1g0As9e/ETaOzPnv96zhGeGVUc5bg3p3OtvzrsCP8+ukiGyP9GPdgjJSIHvHQ3KqeKAbud4HUsMoJn7CqsMMPf5MTwLwSAVGfst92GvQ0sWxzJ4jFx6S9XivklU5oGZuXXPDeQ4/sQXBFgJGi7D5K3uvXCK4bQpW+k7QwDwC8kEKurluG0WloWSrmTXFlj6WOgymDB/y70qZhqScUlMWFMN7ac= debug@web3.link`;
  // Create SSH debug key files in cache directory
  if (cacheDir) {
    // Write debug private key (empty for now, will be filled in later)
    const debugKeyPath = join(cacheDir, 'ssh.debug-key');
    writeFileSync(debugKeyPath, sshDebugKey, 'utf8');
    chmodSync(debugKeyPath, 0o600); // Set 0600 permissions for private key
    
    // Write debug public key (empty for now, will be filled in later)
    const debugPubKeyPath = join(cacheDir, 'ssh.debug-key.pub');
    writeFileSync(debugPubKeyPath, sshDebugKeyPub, 'utf8');
    chmodSync(debugPubKeyPath, 0o644); // Set 0644 permissions for public key
  }
  
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
    image: localhost:5001/${imageReference}
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

export function generateDockerCompose(imageTag: string, profile: string, imageDigest?: string) {
  // Use tag + SHA256 format if digest is available, otherwise just the tag
  const imageReference = imageDigest ? `localhost:5001/${imageTag}@${imageDigest}` : `localhost:5001/${imageTag}`;
  
  const pathHash = getPathHash();
  const cacheDir = getCacheDirectory(imageDigest);
  
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
        'traefik.http.routers.isolated.rule=PathPrefix(`/function`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        'traefik.http.middlewares.strip-function.stripprefix.prefixes=/function',
        'traefik.http.routers.isolated.middlewares=strip-function'
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
      healthcheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      },
      labels: [
        'traefik.enable=true',
        'traefik.http.routers.isolated.rule=PathPrefix(`/function`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        'traefik.http.middlewares.strip-function.stripprefix.prefixes=/function',
        'traefik.http.routers.isolated.middlewares=strip-function'
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
      healthcheck: {
        test: ['CMD', 'curl', '-f', 'http://localhost:8080/health'],
        interval: '30s',
        timeout: '10s',
        retries: 3,
        start_period: '40s'
      },
      labels: [
        'traefik.enable=true',
        'traefik.http.routers.isolated.rule=PathPrefix(`/function`)',
        'traefik.http.routers.isolated.entrypoints=web',
        'traefik.http.services.isolated.loadbalancer.server.port=8080',
        'traefik.http.services.isolated.loadbalancer.server.scheme=http',
        'traefik.http.middlewares.strip-function.stripprefix.prefixes=/function',
        'traefik.http.routers.isolated.middlewares=strip-function'
      ]
    };
  }
  
  const composeConfig = {
    services: {
      traefik: {
        image: 'traefik:v2.10',
        container_name: `${pathHash}-vcr-traefik`,
        hostname: 'vcr-traefik',
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