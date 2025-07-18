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
    // Extract the image tag from the OCI tar path to match build.ts logic
    // The OCI tar path format is: /path/to/cache/image-tag.tar
    const fileName = ociTarPath.split('/').pop() || '';
    const imageTag = fileName.replace('.tar', '');
    
    // Create a hash of the image tag for cache directory (same as build.ts)
    const imageHash = createHash('sha256').update(imageTag).digest('hex').substring(0, 8);
    return join(baseCacheDir, imageHash);
  }
  
  return baseCacheDir;
}

export function generateLinuxKitYaml(imageTag: string, profile: string, cacheDir?: string, ociTarPath?: string, guestAgentImage?: string) {
  const pathHash = getPathHash();
  
  // Determine if debug tools should be included
  // stage and prod-debug share the same base image (with debug tools)
  // stage-release and prod share the same base image (without debug tools)
  const includeDebugTools = profile === 'dev' || profile === 'stage' || profile === 'prod-debug';
  
  // Generate SSH debug keys only if debug tools are included
  let sshKeyPath: string | undefined;
  let sshKeyPubPath: string | undefined;
  
  if (includeDebugTools) {
    sshKeyPath = cacheDir ? join(cacheDir, 'ssh.debug-key') : join(cwd(), 'ssh.debug-key');
    sshKeyPubPath = cacheDir ? join(cacheDir, 'ssh.debug-key.pub') : join(cwd(), 'ssh.debug-key.pub');
    
    if (!existsSync(sshKeyPath)) {
      writeFileSync(sshKeyPath, sshDebugKey);
      chmodSync(sshKeyPath, 0o600);
    }
    
    if (!existsSync(sshKeyPubPath)) {
      writeFileSync(sshKeyPubPath, sshDebugKeyPub);
    }
  }
  
  // Use the image tag directly since the OCI image is loaded into Docker
  // LinuxKit will resolve this through its cache after import
  const imageReference = imageTag;
  
  // Guest agent image - use parameter if provided, otherwise fall back to environment variable or default
  const finalGuestAgentImage = guestAgentImage || process.env.CUSTOM_GUEST_AGENT_IMAGE || 'ghcr.io/zippiehq/vcr-guest-agent:latest';
  
  // Build onboot section conditionally
  let onboot = '';
  // this should really be be gone in debug tools but for some reason we need it
  if (true /* includeDebugTools */) {
    onboot = `onboot:
  - name: dhcpcd
    image: ghcr.io/zippiehq/vcr-dhcpcd@sha256:3ad775c7f5402fc960d3812bec6650ffa48747fbd9bd73b62ff71b8d0bb72c5a
    command: ["/sbin/dhcpcd", "--nobackground", "-f", "/dhcpcd.conf", "-1"]
`;
  }
  
  // Build services list conditionally
  let services = '';
  
  if (includeDebugTools) {
    services += `  - name: getty
    image: ghcr.io/zippiehq/vcr-getty@sha256:f1e8a4fbdbc7bf52eaad06bd59aa1268c91eb11bd615d3c27e93d8a35c0d8b7a
    env:
     - INSECURE=true
  - name: sshd
    image: ghcr.io/zippiehq/vcr-linuxkit-sshd@sha256:448f0a6f0b30e7f6f4a28ab11268b07ed2fb81a4d4feb1092c0b16a126d33183
    binds.add:
      - /root/.ssh:/root/.ssh
`;
  }
  
  services += `  - name: guest-agent
    image: ${finalGuestAgentImage}
    net: host
    binds:
      - /dev:/dev
    capabilities:
      - all
    devices:
      - path: all
  - name: app
    image: ${imageReference}
    net: host
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
`;
  
  // Build files section conditionally
  let files = '';
  if (includeDebugTools) {
    files = `files:
  - path: root/.ssh/authorized_keys
    source: /cache/ssh.debug-key.pub
    mode: "0600"
`;
  }
  
  const yamlConfig = `init:
  - ghcr.io/zippiehq/vcr-init@sha256:fd6878920ee9dd846689fc79839a82dc40f3cf568f16621f0e97a8b7b501df62
  - ghcr.io/zippiehq/vcr-runc@sha256:3f0a1027ab7507f657cafd28abff329366c0e774714eac48c4d4c10f46778596
  - ghcr.io/zippiehq/vcr-containerd@sha256:97a307ea9e3eaa21d378f903f067d742bd66abd49e5ff483ae85528bed6d4e8a
${onboot}services:
${services}${files}`;
  
  // Use a shared filename based on debug tools inclusion, not specific profile
  const debugSuffix = includeDebugTools ? '-debug' : '-release';
  const yamlPath = cacheDir ? join(cacheDir, `vc${debugSuffix}.yml`) : join(cwd(), `vc${debugSuffix}.yml`);
  writeFileSync(yamlPath, yamlConfig);
  console.log(`Generated LinuxKit YAML: ${yamlPath}`);
  return yamlPath;
}

export function generateDockerCompose(imageTag: string, profile: string, ociTarPath?: string, cacheDir?: string, turbo = false, guestAgentImage?: string, hot = false) {
  // Use the image tag directly since the OCI image is loaded into Docker
  const imageReference = imageTag;
  
  const pathHash = getPathHash();
  // Use the provided cache directory or fall back to calculating it
  const finalCacheDir = cacheDir || getCacheDirectory(ociTarPath);
  
  // For stage and prod profiles, use snapshot-builder with different commands
  let isolatedServiceConfig;
  
  if (profile === 'stage' || profile === 'stage-release') {
    // Determine the correct squashfs file based on debug tools inclusion
    const includeDebugTools = profile === 'stage';
    const debugSuffix = includeDebugTools ? '-debug' : '-release';
    
    isolatedServiceConfig = {
      image: 'ghcr.io/zippiehq/vcr-snapshot-builder',
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: [
        `${finalCacheDir}:/work`,
        `${pathHash}_vcr_shared_data:/media/vcr`
      ],
      command: [
        '/bin/bash', '-c',
        `RUST_LOG=info vhost-device-vsock --guest-cid=4 --forward-cid=1 --forward-listen=8080+8022 --socket=/tmp/vhost.socket --tx-buffer-size=65536 --queue-size=1024 &
        socat tcp-listen:8080,fork VSOCK-CONNECT:1:8080 &
        socat tcp-listen:8022,fork VSOCK-CONNECT:1:8022 &
        sleep 1
        ps ux
        qemu-system-riscv64 \\
  --machine virt,memory-backend=mem0 \\
  -cpu rv64,sscofpmf=true \\
  --kernel /work/vc${debugSuffix}.qemu-kernel \\
  -nographic \\
  ${turbo ? '-smp $(nproc) \\' : '\\'}
  -object memory-backend-memfd,id=mem0,size=512M \\
  -append "root=/dev/vda rootfstype=squashfs console=ttyS0" \\
  -drive "file=/work/vc${debugSuffix}.squashfs,format=raw,if=virtio" \\
  -chardev socket,id=c,path=/tmp/vhost.socket \\
  -device vhost-user-vsock-pci,chardev=c \\
  -monitor none \\
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
  } else if (profile === 'prod' || profile === 'prod-debug') {
    // Determine the correct squashfs file based on debug tools inclusion
    const includeDebugTools = profile === 'prod-debug';
    const debugSuffix = includeDebugTools ? '-debug' : '-release';
    
    isolatedServiceConfig = {
      image: 'ghcr.io/zippiehq/vcr-snapshot-builder',
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: [
        `${finalCacheDir}:/work`,
        `${pathHash}_vcr_shared_data:/media/vcr`
      ],
      command: [
        'cartesi-machine',
        `--flash-drive=label:root,filename:/work/vc${debugSuffix}.squashfs`,
        '--ram-length=1024Mi',
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
    const volumes = [`${pathHash}_vcr_shared_data:/media/vcr`];
    
    // Add source code mount for hot reloading
    if (hot) {
      const currentDir = process.cwd();
      volumes.push(`${currentDir}:/app`);
    }
    
    isolatedServiceConfig = {
      image: imageReference,
      container_name: `${pathHash}-vcr-isolated-service`,
      hostname: 'vcr-isolated-service',
      networks: ['internal_net'],
      volumes: volumes,
      restart: "no",
      // Remove command override; Dockerfile entrypoint handles hot reload
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
        `vcr.path.hash=${pathHash}`,
        ...(hot ? [`vcr.hot.reload=true`] : [])
      ]
      // No build or environment keys here
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
  
  // Write the Docker Compose file to the base directory (where other functions expect it)
  // but the volume mounts point to the subdirectory where build artifacts are stored
  const composePath = join(getComposeCacheDirectory(), 'docker-compose.dev.json');
  writeFileSync(composePath, JSON.stringify(composeConfig, null, 2));
  return composePath;
} 