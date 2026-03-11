const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const service = require('../src/services/tunnelEnrollment.service');

describe('tunnelEnrollment.service', () => {
  let tempRoot;
  let registerScript;
  let revokeScript;
  let registryFile;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ehub-tunnel-service-'));
    registerScript = path.join(tempRoot, 'register-device.sh');
    revokeScript = path.join(tempRoot, 'revoke-device.sh');
    registryFile = path.join(tempRoot, 'devices.csv');

    await fs.writeFile(registryFile, 'device_id,bastion_user,remote_port,status,key_fingerprint,created_at,revoked_at\n');

    await fs.writeFile(
      registerScript,
      '#!/usr/bin/env bash\n'
      + 'if [[ "${FAIL_COLLISION:-}" == "1" ]]; then\n'
      + '  echo "[FAILED] Remote port already assigned in registry: 22501" >&2\n'
      + '  exit 1\n'
      + 'fi\n'
      + 'echo "[OK] Registered"\n'
      + 'echo "REMOTE_TUNNEL_BASTION_HOST=ops.example.org"\n'
      + 'echo "REMOTE_TUNNEL_BASTION_PORT=443"\n'
      + 'echo "REMOTE_TUNNEL_BASTION_USER=rt-am_r24fa"\n'
      + 'echo "REMOTE_TUNNEL_REMOTE_PORT=22501"\n',
    );
    await fs.chmod(registerScript, 0o755);

    await fs.writeFile(
      revokeScript,
      '#!/usr/bin/env bash\n'
      + 'echo "[OK] Revoked"\n',
    );
    await fs.chmod(revokeScript, 0o755);

    process.env.TUNNEL_REGISTER_SCRIPT = registerScript;
    process.env.TUNNEL_REVOKE_SCRIPT = revokeScript;
    process.env.TUNNEL_REGISTRY_FILE = registryFile;
    process.env.TUNNEL_BASTION_HOST = 'ops.example.org';
    process.env.TUNNEL_BASTION_PORT = '443';
    process.env.TUNNEL_BASTION_HOST_KEY = 'ops.example.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockHostKey';
  });

  afterEach(async () => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    });
    Object.entries(originalEnv).forEach(([key, value]) => {
      process.env[key] = value;
    });
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('enrolls device and parses mapping from script output', async () => {
    const result = await service.enrollDeviceTunnel({
      deviceId: 'AM_R24FA',
      tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
    });

    expect(result.REMOTE_TUNNEL_BASTION_HOST).toBe('ops.example.org');
    expect(result.REMOTE_TUNNEL_BASTION_USER).toBe('rt-am_r24fa');
    expect(result.REMOTE_TUNNEL_REMOTE_PORT).toBe(22501);
    expect(result.REMOTE_TUNNEL_BASTION_HOST_KEY).toContain('ssh-ed25519');
  });

  it('classifies collision errors from script output', async () => {
    await fs.writeFile(
      registerScript,
      '#!/usr/bin/env bash\n'
      + 'echo \"[FAILED] Remote port already assigned in registry: 22501\" >&2\n'
      + 'exit 1\n',
    );
    await fs.chmod(registerScript, 0o755);

    await expect(
      service.enrollDeviceTunnel({
        deviceId: 'AM_R24FA',
        tunnelPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockPublicKeyValue sender@device',
      }),
    ).rejects.toMatchObject({
      name: 'TunnelEnrollmentError',
      code: 'COLLISION',
    });
  });

  it('lists active mappings from registry CSV', async () => {
    await fs.writeFile(
      registryFile,
      [
        'device_id,bastion_user,remote_port,status,key_fingerprint,created_at,revoked_at',
        'AM_R24FA,rt-am_r24fa,22501,active,SHA256:aaa,2026-03-09T00:00:00Z,',
        'AM_R24FB,rt-am_r24fb,22502,revoked,SHA256:bbb,2026-03-09T00:00:00Z,2026-03-10T00:00:00Z',
      ].join('\n'),
    );

    const mappings = await service.listActiveMappings();
    expect(mappings).toHaveLength(1);
    expect(mappings[0].deviceId).toBe('AM_R24FA');
    expect(mappings[0].remotePort).toBe(22501);
  });
});
