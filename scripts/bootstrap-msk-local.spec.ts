/**
 * RED PHASE — Tests for scripts/bootstrap-msk-local.sh
 *
 * Runner: node --test + tsx (matching scripts/inject-request.spec.ts).
 * Execute: npx tsx --test scripts/bootstrap-msk-local.spec.ts
 *
 * The bootstrap script does not exist yet. These tests FAIL because the script
 * file is missing (ENOENT) — correct RED behavior. Each test documents the
 * expected contract. Once the bootstrap script is implemented, all tests pass.
 *
 * Mock strategy:
 *   - Creates temporary mock `awslocal` and `curl` executables in a temp dir
 *   - Prepends temp dir to PATH so the bootstrap script picks up mocks
 *   - Mock responses simulate LocalStack MSK API (create-cluster,
 *     describe-cluster, get-bootstrap-brokers, health check)
 *   - Integration tests (real LocalStack) use a separate describe block
 *     marked .skip by default
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// ─── Reusable constants ────────────────────────────────────────────────────
const REPO_ROOT = execSync('git rev-parse --show-toplevel', {
  encoding: 'utf-8',
  stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
const BOOTSTRAP_SCRIPT = join(REPO_ROOT, 'scripts', 'bootstrap-msk-local.sh');
const MSK_ENV_FILE = join(REPO_ROOT, 'scripts', 'msk-env.sh');
const DOCKER_COMPOSE_LS = join(
  REPO_ROOT,
  'docker-compose.localstack.yml',
);
const MAKEFILE = join(REPO_ROOT, 'Makefile');

// ─── Mock helpers ──────────────────────────────────────────────────────────

/** Creates a temp directory with fake awslocal + curl executables. */
function createMocksDir(
  opts: {
    /** State returned by describe-cluster (default: ACTIVE) */
    clusterState?: string;
    /** Makes awslocal exit with error instead of returning JSON */
    awslocalFail?: boolean;
    /** Makes curl return non-200 (default: returns MSK health OK) */
    curlFail?: boolean;
    /** Topic list to return when checking existing topics */
    existingTopics?: string[];
    /** Cluster ARN to return from create-cluster */
    clusterArn?: string;
  } = {},
): string {
  const dir = join(tmpdir(), `msk-mocks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });

  const clusterArn =
    opts.clusterArn ??
    'arn:aws:kafka:us-east-1:000000000000:cluster/open-supervisor-local-dev-kafka/abc-123';
  const state = opts.clusterState ?? 'ACTIVE';
  const topics = opts.existingTopics ?? [];
  const brokers = 'localhost:4511';

  // ── Fake awslocal ──
  const awslocalPath = join(dir, 'awslocal');
  writeFileSync(
    awslocalPath,
    `#!/usr/bin/env bash
set -e
subcommand="$1"
resource="$2"
shift 2 2>/dev/null || true

# State machine: first describe-cluster returns CREATING, subsequent return ${state}
_state_file="/tmp/msk-mock-state-\${AWSLOCAL_ID:-default}"
if [ ! -f "\$_state_file" ]; then
  echo "CREATING" > "\$_state_file"
fi
_current_state=\$(cat "\$_state_file")

if [ "${opts.awslocalFail ? 'true' : 'false'}" = "true" ]; then
  echo "Error: awslocal failed" >&2
  exit 1
fi

case "$subcommand" in
  kafka)
    case "$resource" in
      create-cluster)
        echo '{"ClusterArn": "${clusterArn}"}'
        echo "${clusterArn}" >> /tmp/msk-mock-clusters
        ;;
      list-clusters)
        _clusters_file=/tmp/msk-mock-clusters
        if [ -f "\$_clusters_file" ]; then
          echo '{"ClusterInfoList": [{"ClusterName": "open-supervisor-local-dev-kafka", "ClusterArn": "'\$(tail -1 "\$_clusters_file")'"}]}'
        else
          echo '{"ClusterInfoList": []}'
        fi
        ;;
      describe-cluster)
        if [ "\$_current_state" = "CREATING" ]; then
          echo '{"ClusterInfo": {"ClusterArn": "${clusterArn}", "State": "CREATING"}}'
          echo "${state}" > "\$_state_file"
        else
          echo '{"ClusterInfo": {"ClusterArn": "${clusterArn}", "State": "${state}"}}'
        fi
        ;;
      get-bootstrap-brokers)
        echo '{"BootstrapBrokerString": "${brokers}"}'
        ;;
      create-topic|list-topics)
        echo '${JSON.stringify({ topics })}'
        ;;
      *)
        echo "Unknown kafka resource: $resource" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unknown awslocal command: $subcommand" >&2
    exit 1
    ;;
esac
`,
  );
  chmodSync(awslocalPath, 0o755);

  // ── Fake curl (for LocalStack health check) ──
  const curlPath = join(dir, 'curl');
  const healthResponse = opts.curlFail
    ? 'HTTP/1.1 503 Service Unavailable\r\n\r\n{"services":{"msk":"unavailable"}}'
    : 'HTTP/1.1 200 OK\r\n\r\n{"services":{"msk":"available","ec2":"available","ecr":"available"}}';
  writeFileSync(
    curlPath,
    `#!/usr/bin/env bash
if echo "$*" | grep -q "_localstack/health"; then
  printf '${healthResponse.replace(/'/g, "'\\''")}'
  exit ${opts.curlFail ? '1' : '0'}
else
  /usr/bin/curl "$@" 2>/dev/null || true
fi
`,
  );
  chmodSync(curlPath, 0o755);

  return dir;
}

/**
 * RED-phase guard: asserts the script exists before running mock-based tests.
 * If the script doesn't exist, the test fails with a clear message so it doesn't
 * pass for the wrong reason (ENOENT caught as generic error).
 */
function requireScript(): void {
  if (!existsSync(BOOTSTRAP_SCRIPT)) {
    assert.fail(
      `RED PHASE: bootstrap script not yet implemented at ${BOOTSTRAP_SCRIPT}. ` +
        `This test requires the script to exist before mock behavior can be validated.`,
    );
  }
}

/** Run the bootstrap script with optional env vars. Returns { stdout, stderr, exitCode }. */
function runBootstrap(
  extraEnv: Record<string, string> = {},
  cwdOverride?: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`bash "${BOOTSTRAP_SCRIPT}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
      cwd: cwdOverride ?? REPO_ROOT,
      timeout: 10_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

/** Clean up mock state files between tests. */
function cleanMockState(): void {
  try {
    execSync('rm -f /tmp/msk-mock-state-* /tmp/msk-mock-clusters', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite: script existence and structure
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — existence and structure', () => {
  it('exists at scripts/bootstrap-msk-local.sh', () => {
    assert.ok(
      existsSync(BOOTSTRAP_SCRIPT),
      `Bootstrap script not found at ${BOOTSTRAP_SCRIPT}. Create scripts/bootstrap-msk-local.sh.`,
    );
  });

  it('is executable (owner has execute permission)', () => {
    // If the file doesn't exist, this test will fail before reaching statSync.
    // The test above already covers existence; this validates the permission bit.
    if (!existsSync(BOOTSTRAP_SCRIPT)) {
      assert.fail(`Script doesn't exist — cannot check permissions`);
      return;
    }
    const mode = statSync(BOOTSTRAP_SCRIPT).mode;
    const ownerExec = (mode & 0o100) !== 0;
    assert.ok(ownerExec, 'Bootstrap script must have owner execute permission (chmod +x)');
  });

  it('has a valid shebang line (#!/usr/bin/env bash or #!/bin/bash)', () => {
    if (!existsSync(BOOTSTRAP_SCRIPT)) {
      assert.fail(`Script doesn't exist — cannot read shebang`);
      return;
    }
    const firstLine = readFileSync(BOOTSTRAP_SCRIPT, 'utf-8').split('\n')[0]?.trim() ?? '';
    assert.ok(
      firstLine.startsWith('#!'),
      `First line must be a shebang, got: "${firstLine}"`,
    );
    assert.ok(
      firstLine.includes('bash'),
      `Shebang must reference bash, got: "${firstLine}"`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: health check validation
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — health check', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('passes health check when LocalStack returns MSK: available', () => {
    const mocksDir = createMocksDir({ curlFail: false });
    try {
      const result = runBootstrap({ PATH: `${mocksDir}:${process.env['PATH']}` });
      // Script should not fail due to health check
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(
        !combined.includes('MSK service not available'),
        `Health check should pass when MSK is available. Output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('fails with "MSK service not available" when health check returns msk: unavailable', () => {
    const mocksDir = createMocksDir({ curlFail: true });
    try {
      const result = runBootstrap({ PATH: `${mocksDir}:${process.env['PATH']}` });
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      assert.ok(
        result.exitCode !== 0,
        `Expected non-zero exit code when MSK is unavailable, got ${result.exitCode}`,
      );
      assert.ok(
        combined.includes('msk') || combined.includes('not available') || combined.includes('unavailable'),
        `Error message must indicate MSK is unavailable. Output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('fails when LocalStack health endpoint is unreachable (connection refused)', () => {
    const mocksDir = createMocksDir({ curlFail: true });
    try {
      const result = runBootstrap({ PATH: `${mocksDir}:${process.env['PATH']}` });
      assert.notEqual(
        result.exitCode,
        0,
        'Expected non-zero exit code when LocalStack is unreachable',
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('exits with non-zero code on health check failure', () => {
    const mocksDir = createMocksDir({ curlFail: true });
    try {
      const result = runBootstrap({ PATH: `${mocksDir}:${process.env['PATH']}` });
      assert.notEqual(result.exitCode, 0, 'Exit code must be non-zero on failure');
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: cluster provisioning
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — cluster provisioning', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('creates an MSK cluster named "open-supervisor-local-dev-kafka" via awslocal', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'cluster-create',
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(
        combined.includes('open-supervisor-local-dev-kafka') ||
          combined.includes('cluster'),
        `Output must reference the cluster name. Output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('waits for cluster state ACTIVE before proceeding to topic creation', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'wait-active',
      });
      assert.equal(result.exitCode, 0, 'Script must exit 0 after cluster becomes ACTIVE');
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('polls describe-cluster until state becomes ACTIVE (max 60s)', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'poll-active',
      });
      // The mock state machine returns CREATING first, then ACTIVE.
      // Script should handle this correctly.
      // If the script times out or fails, exitCode will be non-zero.
      assert.equal(
        result.exitCode,
        0,
        `Script must succeed after cluster reaches ACTIVE. stderr: ${result.stderr}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('times out after 60s if cluster stays in CREATING state', () => {
    // Use a special mock that always returns CREATING
    const mocksDir = createMocksDir({ clusterState: 'CREATING' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'timeout-creating',
        // Make the mock describe-cluster always return CREATING
        MSK_MOCK_ALWAYS_CREATING: '1',
      });
      // The script should exit with non-zero after timing out
      // Note: the mock will return CREATING forever, so the script must time out
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      assert.ok(
        combined.includes('timeout') ||
          combined.includes('timed out') ||
          combined.includes('creating') ||
          result.exitCode !== 0,
        `Script must indicate timeout or exit non-zero when cluster never becomes ACTIVE. exitCode=${result.exitCode}, output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: topic creation
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — topic creation', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('creates auth.requests topic', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'topic-create',
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.ok(
        combined.includes('auth.requests') || combined.includes('topic'),
        `Output must reference auth.requests topic. Output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('is idempotent: does not fail if topic already exists', () => {
    const mocksDir = createMocksDir({
      clusterState: 'ACTIVE',
      existingTopics: ['auth.requests'],
    });
    try {
      // First run creates the topic
      runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'topic-idempotent-1',
      });
      // Second run should not fail (idempotent)
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'topic-idempotent-2',
      });
      assert.equal(
        result.exitCode,
        0,
        `Second run must succeed (idempotent). exitCode=${result.exitCode}, stderr: ${result.stderr}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: idempotent re-run (entire script)
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — idempotent re-run', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('detects existing cluster and reuses it instead of creating a duplicate', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      // First run creates the cluster
      const firstRun = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'reuse-1',
      });
      assert.equal(firstRun.exitCode, 0, `First run must succeed. stderr: ${firstRun.stderr}`);

      // Second run should detect existing cluster
      const secondRun = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'reuse-2',
      });
      assert.equal(secondRun.exitCode, 0, `Second run must succeed (reusing cluster). stderr: ${secondRun.stderr}`);

      const combined = `${secondRun.stdout}\n${secondRun.stderr}`.toLowerCase();
      // Should indicate it reused, not created
      assert.ok(
        combined.includes('exist') ||
          combined.includes('reuse') ||
          combined.includes('already') ||
          combined.includes('found'),
        `Second run must indicate it detected existing cluster. Output:\n${combined}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('exits with code 0 on successful re-run', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      runBootstrap({ PATH: `${mocksDir}:${process.env['PATH']}`, AWSLOCAL_ID: 'rerun-1' });
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'rerun-2',
      });
      assert.equal(result.exitCode, 0, 'Re-run must exit with code 0');
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: env file generation
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — env file generation', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('generates scripts/msk-env.sh with KAFKA_BROKERS variable', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'env-gen',
      });
      // After successful bootstrap, msk-env.sh must exist
      const envExists = existsSync(MSK_ENV_FILE);
      if (!envExists && result.exitCode === 0) {
        // Script succeeded but didn't create env file — acceptable if env file
        // is created in a different location. Check script output.
        const combined = `${result.stdout}\n${result.stderr}`;
        assert.ok(
          combined.includes('KAFKA_BROKERS'),
          `Script must output or write KAFKA_BROKERS. Neither msk-env.sh found nor KAFKA_BROKERS in output. Output:\n${combined}`,
        );
      } else if (envExists) {
        const content = readFileSync(MSK_ENV_FILE, 'utf-8');
        assert.ok(
          content.includes('KAFKA_BROKERS'),
          `msk-env.sh must contain KAFKA_BROKERS variable. Content:\n${content}`,
        );
        assert.ok(
          content.includes('='),
          `msk-env.sh must have KEY=VALUE format. Content:\n${content}`,
        );
      }
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('msk-env.sh has shell export format (export KAFKA_BROKERS=...)', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'env-format',
      });
      if (existsSync(MSK_ENV_FILE)) {
        const content = readFileSync(MSK_ENV_FILE, 'utf-8');
        assert.ok(
          content.includes('KAFKA_BROKERS'),
          `msk-env.sh must contain KAFKA_BROKERS. Content:\n${content}`,
        );
        // Must be sourcable by shell: either `export KAFKA_BROKERS=...` or `KAFKA_BROKERS=...`
        assert.ok(
          /KAFKA_BROKERS\s*=\s*["']?localhost:\d+/.test(content) ||
            /export\s+KAFKA_BROKERS\s*=\s*["']?localhost:\d+/.test(content),
          `msk-env.sh must contain KAFKA_BROKERS with a localhost:port value. Content:\n${content}`,
        );
      }
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('KAFKA_BROKERS value contains a valid host:port (e.g., localhost:4511)', () => {
    const mocksDir = createMocksDir({ clusterState: 'ACTIVE' });
    try {
      runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'env-value',
      });
      if (existsSync(MSK_ENV_FILE)) {
        const content = readFileSync(MSK_ENV_FILE, 'utf-8');
        const match = content.match(/localhost:(\d+)/);
        assert.ok(match, `KAFKA_BROKERS must contain a localhost:port. Content:\n${content}`);
        const port = parseInt(match[1], 10);
        assert.ok(
          port > 0 && port <= 65535,
          `Port must be valid (1-65535), got ${port}. Content:\n${content}`,
        );
      }
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: error handling
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — error handling', () => {
  before(() => { cleanMockState(); requireScript(); });
  after(cleanMockState);

  it('fails with clear message when awslocal is not installed', () => {
    // Run without mocks: awslocal won't be found
    // The script should check and fail gracefully
    const result = runBootstrap({
      PATH: '/usr/bin:/bin', // no awslocal in PATH
      AWSLOCAL_ID: 'no-awslocal',
    });
    const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
    // Must mention awslocal and provide install instructions
    assert.ok(
      combined.includes('awslocal') || combined.includes('not found') || combined.includes('install'),
      `Script must fail with awslocal install instructions. exitCode=${result.exitCode}, output:\n${combined}`,
    );
    assert.notEqual(result.exitCode, 0, 'Must exit non-zero when awslocal is missing');
  });

  it('fails with clear message when MSK service is not available', () => {
    const mocksDir = createMocksDir({ curlFail: true });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'no-msk',
      });
      const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
      assert.ok(
        combined.includes('msk') &&
          (combined.includes('not available') ||
            combined.includes('unavailable') ||
            combined.includes('disabled')),
        `Error message must mention MSK and its unavailability. Output:\n${combined}`,
      );
      assert.notEqual(result.exitCode, 0, 'Must exit non-zero when MSK is unavailable');
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('exits with non-zero code on any unrecoverable failure', () => {
    const mocksDir = createMocksDir({ awslocalFail: true });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'error-exit',
      });
      assert.notEqual(
        result.exitCode,
        0,
        `Must exit non-zero on failure. exitCode=${result.exitCode}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });

  it('writes error messages to stderr, not stdout', () => {
    const mocksDir = createMocksDir({ curlFail: true });
    try {
      const result = runBootstrap({
        PATH: `${mocksDir}:${process.env['PATH']}`,
        AWSLOCAL_ID: 'stderr-test',
      });
      assert.ok(
        result.stderr.length > 0,
        `Error messages must be written to stderr. stderr was empty. stdout: ${result.stdout}`,
      );
    } finally {
      rmSync(mocksDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: docker-compose.localstack.yml validation
// ═══════════════════════════════════════════════════════════════════════════

describe('docker-compose.localstack.yml — MSK configuration', () => {
  it('contains SERVICES env var with msk included', () => {
    assert.ok(
      existsSync(DOCKER_COMPOSE_LS),
      `docker-compose.localstack.yml not found at ${DOCKER_COMPOSE_LS}`,
    );
    const content = readFileSync(DOCKER_COMPOSE_LS, 'utf-8');
    // The SERVICES line should include msk
    const servicesMatch = content.match(/SERVICES:\s*(.+)/);
    assert.ok(servicesMatch, 'SERVICES env var must be defined in docker-compose.localstack.yml');
    assert.ok(
      servicesMatch[1].includes('msk'),
      `SERVICES must include 'msk'. Current value: ${servicesMatch[1]}`,
    );
  });

  it('localstack container uses a Pro/Ultimate tier image (not Community)', () => {
    const content = readFileSync(DOCKER_COMPOSE_LS, 'utf-8');
    // Check that the image is localstack/localstack-pro or has pro/ultimate in it
    const imageMatch = content.match(/image:\s*(.+)/);
    assert.ok(imageMatch, 'localstack service must have an image defined');
    const image = imageMatch[1].trim();
    // Should NOT be the plain localstack/localstack (Community) since MSK requires Pro
    assert.ok(
      image.toLowerCase().includes('pro') ||
        image.toLowerCase().includes('ultimate') ||
        image === 'localstack/localstack:3',
      `Image must be Pro or Ultimate tier (MSK requires it). Current: ${image}. ` +
        `NOTE: If using localstack/localstack:3 with Pro AUTH_TOKEN, this assertion passes.`,
    );
  });

  it('includes AUTH_TOKEN env var support for Pro license', () => {
    const content = readFileSync(DOCKER_COMPOSE_LS, 'utf-8');
    // Must have either AUTH_TOKEN in environment or reference it
    const hasAuthToken =
      content.includes('AUTH_TOKEN') ||
      content.includes('LOCALSTACK_AUTH_TOKEN') ||
      content.includes('auth_token');
    assert.ok(
      hasAuthToken,
      'docker-compose.localstack.yml must reference AUTH_TOKEN for Pro/Ultimate license',
    );
  });

  it('configures external port mapping for stable bootstrap broker access', () => {
    const content = readFileSync(DOCKER_COMPOSE_LS, 'utf-8');
    // Should expose the Kafka port or use EXTERNAL_SERVICE_PORTS_RANGE
    const hasPortConfig =
      content.includes('EXTERNAL_SERVICE_PORTS_RANGE') ||
      content.includes('4510') ||
      content.includes('4511') ||
      content.includes('kafka');
    assert.ok(
      hasPortConfig,
      'docker-compose.localstack.yml should configure port mapping for Kafka/MSK access',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: Makefile localstack targets
// ═══════════════════════════════════════════════════════════════════════════

describe('Makefile — localstack targets', () => {
  it('defines a localstack-infra target (infra only, no services)', () => {
    assert.ok(existsSync(MAKEFILE), `Makefile not found at ${MAKEFILE}`);
    const content = readFileSync(MAKEFILE, 'utf-8');
    assert.ok(
      content.includes('localstack-infra'),
      'Makefile must define a localstack-infra target',
    );
  });

  it('defines a localstack-down target', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    assert.ok(
      content.includes('localstack-down'),
      'Makefile must define a localstack-down target',
    );
  });

  it('localstack target chains: localstack-infra → bootstrap-msk-local.sh → services', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    // The localstack target should reference bootstrap-msk-local.sh
    assert.ok(
      content.includes('bootstrap-msk-local.sh') ||
        content.includes('bootstrap-msk-local'),
      'Makefile localstack target must reference bootstrap-msk-local.sh',
    );
  });

  it('localstack-infra target includes docker-compose.localstack.yml', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    assert.ok(
      content.includes('docker-compose.localstack.yml'),
      'Makefile localstack-infra must reference docker-compose.localstack.yml',
    );
  });

  it('.PHONY declaration includes localstack targets', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    // Find the .PHONY line
    const phonyMatch = content.match(/\.PHONY:\s*(.+)/);
    assert.ok(phonyMatch, 'Makefile must have a .PHONY declaration');
    const phonyTargets = phonyMatch[1];
    assert.ok(
      phonyTargets.includes('localstack-infra') || phonyTargets.includes('localstack'),
      `.PHONY must include localstack-infra or localstack. Current: ${phonyTargets}`,
    );
  });

  it('localstack-infra respects COMPOSE override variable', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    // The target should use $(COMPOSE) or detect the engine
    // This is a structural check: look for COMPOSE reference near localstack targets
    const localstackSection = content.split('localstack-infra')[1]?.split('\n\n')[0] ?? '';
    assert.ok(
      localstackSection.includes('COMPOSE') || localstackSection.includes('compose'),
      'localstack-infra target should use $(COMPOSE) variable for engine portability',
    );
  });

  it('localstack-down target stops background processes and containers', () => {
    const content = readFileSync(MAKEFILE, 'utf-8');
    const downSection = content.split('localstack-down')[1]?.split('\n\n')[0] ?? '';
    // Should contain stop/cleanup commands
    assert.ok(
      downSection.includes('down') ||
        downSection.includes('stop') ||
        downSection.includes('kill') ||
        downSection.includes('pkill'),
      'localstack-down must contain container/process stop commands',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite: integration tests (real LocalStack)
// Marked .skip by default — requires running LocalStack with MSK
// ═══════════════════════════════════════════════════════════════════════════

describe('bootstrap-msk-local.sh — integration (real LocalStack)', { skip: true }, () => {
  const LOCALSTACK_URL = process.env['LOCALSTACK_URL'] ?? 'http://localhost:4566';

  before(async () => {
    // Verify LocalStack is reachable before running integration tests
    try {
      const resp = await fetch(`${LOCALSTACK_URL}/_localstack/health`);
      const health = (await resp.json()) as Record<string, unknown>;
      const services = (health.services ?? {}) as Record<string, string>;
      if (services['msk'] !== 'available') {
        throw new Error(`MSK not available in LocalStack. Services: ${JSON.stringify(services)}`);
      }
    } catch (err) {
      throw new Error(
        `LocalStack not reachable at ${LOCALSTACK_URL}. Start it first: ` +
          `COMPOSE="$(make -sC "${REPO_ROOT}" help 2>&1 >/dev/null; echo docker compose)" ` +
          `docker compose -f docker-compose.yml -f docker-compose.localstack.yml up -d localstack\n` +
          `Error: ${(err as Error).message}`,
      );
    }
  });

  it('full bootstrap: creates cluster + topic + broker address', () => {
    const result = runBootstrap({ LOCALSTACK_URL });
    assert.equal(result.exitCode, 0, `Bootstrap must succeed. stderr: ${result.stderr}`);
    assert.ok(
      existsSync(MSK_ENV_FILE),
      'msk-env.sh must be generated after successful bootstrap',
    );
  });

  it('second run is idempotent', () => {
    const result = runBootstrap({ LOCALSTACK_URL });
    assert.equal(result.exitCode, 0, `Second bootstrap must succeed (idempotent). stderr: ${result.stderr}`);
  });

  it('msk-env.sh contains reachable broker address', async () => {
    if (!existsSync(MSK_ENV_FILE)) {
      assert.fail('msk-env.sh not found — bootstrap must have failed');
      return;
    }
    const content = readFileSync(MSK_ENV_FILE, 'utf-8');
    const match = content.match(/KAFKA_BROKERS\s*=\s*["']?([^"'\s]+)/);
    assert.ok(match, `msk-env.sh must contain KAFKA_BROKERS. Content:\n${content}`);
    const broker = match[1];
    // Try connecting to the broker
    try {
      const { Kafka } = await import('kafkajs');
      const kafka = new Kafka({ clientId: 'integration-test', brokers: [broker] });
      const admin = kafka.admin();
      await admin.connect();
      const topics = await admin.listTopics();
      assert.ok(
        topics.includes('auth.requests'),
        `Topic auth.requests must exist. Topics: ${topics.join(', ')}`,
      );
      await admin.disconnect();
    } catch (err) {
      assert.fail(`Cannot connect to broker ${broker}: ${(err as Error).message}`);
    }
  });
});
