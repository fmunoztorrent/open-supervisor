/**
 * validate-ecs-tasks.spec.ts
 * TDD tests for US-04: ECS Fargate Task Definitions.
 *
 * Phase RED: These tests fail because task definition files don't exist yet.
 * Phase GREEN: After creating the JSON files, these tests pass.
 *
 * Run: npx tsx --test scripts/aws/validate-ecs-tasks.spec.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

interface TaskDefinition {
  family?: string;
  networkMode?: string;
  requiresCompatibilities?: string[];
  cpu?: string;
  memory?: string;
  executionRoleArn?: string;
  taskRoleArn?: string;
  containerDefinitions?: ContainerDefinition[];
  tags?: Tag[];
}

interface ContainerDefinition {
  name?: string;
  image?: string;
  essential?: boolean;
  portMappings?: PortMapping[];
  healthCheck?: HealthCheck;
  environment?: EnvVar[];
  secrets?: Secret[];
  logConfiguration?: LogConfig;
}

interface PortMapping {
  containerPort?: number;
  protocol?: string;
}

interface HealthCheck {
  command?: string[];
  interval?: number;
  timeout?: number;
  retries?: number;
  startPeriod?: number;
}

interface EnvVar {
  name?: string;
  value?: string;
}

interface Secret {
  name?: string;
  valueFrom?: string;
}

interface LogConfig {
  logDriver?: string;
  options?: Record<string, string>;
}

interface Tag {
  key?: string;
  value?: string;
}

/**
 * Valid Fargate CPU/memory combinations.
 * CPU → list of valid memory values in MB.
 */
const FARGATE_COMBOS: Record<string, number[]> = {
  '256': [512, 1024, 2048],
  '512': [1024, 2048, 3072, 4096],
  '1024': [2048, 3072, 4096, 5120, 6144, 7168, 8192],
  '2048': [4096, 8192, 12288, 16384],
  '4096': [8192, 12288, 16384, 30720],
};

interface ServiceSpec {
  name: string;
  port: number;
  cpu: string;
  memory: number;
  logGroup: string;
}

const SERVICES: ServiceSpec[] = [
  { name: 'authorization-service', port: 3001, cpu: '512', memory: 1024, logGroup: '/ecs/authorization-service' },
  { name: 'sse-server', port: 3002, cpu: '256', memory: 512, logGroup: '/ecs/sse-server' },
  { name: 'bff', port: 3000, cpu: '256', memory: 512, logGroup: '/ecs/bff' },
];

/**
 * Load and parse a task definition JSON file.
 */
function loadTaskDefinition(serviceName: string): TaskDefinition {
  const filePath = resolve(REPO_ROOT, 'infra/ecs/task-definitions', `${serviceName}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as TaskDefinition;
}

/**
 * Check if a string looks like a hardcoded AWS account ID (12 digits).
 */
function hasHardcodedAccountId(value: string): boolean {
  const matches = value.match(/\b(\d{12})\b/g) || [];
  return matches.some(m => m !== '000000000000');
}

// ─── Phase RED: pre-condition — files must exist ─────────────────────────────

describe('US-04 ECS Task Definitions: pre-condition — files exist', () => {
  for (const svc of SERVICES) {
    it(`infra/ecs/task-definitions/${svc.name}.json exists`, () => {
      const filePath = resolve(REPO_ROOT, 'infra/ecs/task-definitions', `${svc.name}.json`);
      assert.ok(
        existsSync(filePath),
        `Task definition ${svc.name}.json must exist to run tests`
      );
    });
  }

  it('infra/ecs/ecs-services.yaml exists', () => {
    const filePath = resolve(REPO_ROOT, 'infra/ecs/ecs-services.yaml');
    assert.ok(
      existsSync(filePath),
      'ecs-services.yaml must exist to run tests'
    );
  });
});

// ─── Phase GREEN: Validate task definition structure ─────────────────────────

// Determine if all task definition files exist
const allFilesExist = SERVICES.every(svc => {
  return existsSync(resolve(REPO_ROOT, 'infra/ecs/task-definitions', `${svc.name}.json`));
});
const greenDescribe = allFilesExist ? describe : describe.skip;

greenDescribe('US-04 ECS Task Definitions: GREEN phase — structure', () => {
  const taskDefs: Record<string, TaskDefinition> = {};

  before(() => {
    for (const svc of SERVICES) {
      taskDefs[svc.name] = loadTaskDefinition(svc.name);
    }
  });

  // ── Family naming ────────────────────────────────────────────────────────────
  it('family names use open-supervisor prefix', () => {
    for (const svc of SERVICES) {
      const td = taskDefs[svc.name];
      assert.ok(td.family, `${svc.name}: family is required`);
      assert.ok(
        td.family!.startsWith('open-supervisor-'),
        `${svc.name}: family should start with "open-supervisor-", got: "${td.family}"`
      );
    }
  });

  // ── Network mode ─────────────────────────────────────────────────────────────
  it('networkMode is awsvpc', () => {
    for (const svc of SERVICES) {
      assert.equal(
        taskDefs[svc.name].networkMode,
        'awsvpc',
        `${svc.name}: networkMode must be awsvpc`
      );
    }
  });

  // ── Fargate compatibility ────────────────────────────────────────────────────
  it('requiresCompatibilities includes FARGATE', () => {
    for (const svc of SERVICES) {
      const compat = taskDefs[svc.name].requiresCompatibilities || [];
      assert.ok(
        compat.includes('FARGATE'),
        `${svc.name}: requiresCompatibilities must include FARGATE, got: [${compat}]`
      );
    }
  });

  // ── CPU ──────────────────────────────────────────────────────────────────────
  it('cpu matches expected values', () => {
    for (const svc of SERVICES) {
      assert.equal(
        taskDefs[svc.name].cpu,
        svc.cpu,
        `${svc.name}: cpu should be ${svc.cpu}, got: ${taskDefs[svc.name].cpu}`
      );
    }
  });

  // ── Memory ───────────────────────────────────────────────────────────────────
  it('memory matches expected values', () => {
    for (const svc of SERVICES) {
      const mem = taskDefs[svc.name].memory;
      assert.equal(
        mem,
        String(svc.memory),
        `${svc.name}: memory should be ${svc.memory}, got: ${mem}`
      );
    }
  });

  // ── Valid Fargate CPU+memory combo ──────────────────────────────────────────
  it('CPU+memory is a valid Fargate combination', () => {
    for (const svc of SERVICES) {
      const cpu = taskDefs[svc.name].cpu!;
      const mem = Number(taskDefs[svc.name].memory);
      const validMems = FARGATE_COMBOS[cpu];
      assert.ok(validMems, `${svc.name}: cpu=${cpu} is not a valid Fargate CPU value`);
      assert.ok(
        validMems.includes(mem),
        `${svc.name}: memory=${mem} is not valid for CPU=${cpu}. Valid: [${validMems}]`
      );
    }
  });

  // ── Container definitions ────────────────────────────────────────────────────
  it('has exactly 1 container definition', () => {
    for (const svc of SERVICES) {
      const cds = taskDefs[svc.name].containerDefinitions || [];
      assert.equal(cds.length, 1, `${svc.name}: expected 1 container definition, got ${cds.length}`);
    }
  });

  it('container name matches service name', () => {
    for (const svc of SERVICES) {
      const name = taskDefs[svc.name].containerDefinitions![0].name;
      assert.equal(
        name,
        svc.name,
        `${svc.name}: container name should be "${svc.name}", got: "${name}"`
      );
    }
  });

  it('container is essential', () => {
    for (const svc of SERVICES) {
      assert.strictEqual(
        taskDefs[svc.name].containerDefinitions![0].essential,
        true,
        `${svc.name}: container must be essential`
      );
    }
  });

  // ── Image ────────────────────────────────────────────────────────────────────
  it('image uses <aws_account_id> placeholder', () => {
    for (const svc of SERVICES) {
      const image = taskDefs[svc.name].containerDefinitions![0].image || '';
      assert.ok(
        image.includes('<aws_account_id>'),
        `${svc.name}: image should use <aws_account_id> placeholder, got: "${image}"`
      );
      assert.ok(
        image.includes(svc.name),
        `${svc.name}: image should contain the service name, got: "${image}"`
      );
      assert.ok(
        image.includes('amazonaws.com'),
        `${svc.name}: image should be an ECR URL, got: "${image}"`
      );
    }
  });

  it('image does not contain hardcoded account IDs', () => {
    for (const svc of SERVICES) {
      const image = taskDefs[svc.name].containerDefinitions![0].image || '';
      assert.ok(
        !hasHardcodedAccountId(image),
        `${svc.name}: image contains hardcoded account ID: "${image}"`
      );
    }
  });

  // ── Port mapping ────────────────────────────────────────────────────────────
  it('port mapping matches expected port', () => {
    for (const svc of SERVICES) {
      const port = taskDefs[svc.name].containerDefinitions![0].portMappings![0];
      assert.ok(port, `${svc.name}: portMappings must exist`);
      assert.equal(
        port.containerPort,
        svc.port,
        `${svc.name}: containerPort should be ${svc.port}, got: ${port.containerPort}`
      );
      assert.equal(
        port.protocol,
        'tcp',
        `${svc.name}: protocol should be tcp, got: ${port.protocol}`
      );
    }
  });

  // ── Health check ────────────────────────────────────────────────────────────
  it('healthCheck uses CMD-SHELL curl to localhost:<port>/health', () => {
    for (const svc of SERVICES) {
      const hc = taskDefs[svc.name].containerDefinitions![0].healthCheck;
      assert.ok(hc, `${svc.name}: healthCheck is required`);
      assert.ok(
        hc!.command,
        `${svc.name}: healthCheck.command is required`
      );
      assert.ok(
        hc!.command!.some(cmd => cmd === 'CMD-SHELL'),
        `${svc.name}: healthCheck must use CMD-SHELL`
      );
      const curlCmd = hc!.command!.find(cmd => cmd.startsWith('curl'));
      assert.ok(curlCmd, `${svc.name}: healthCheck must include curl command`);
      assert.ok(
        curlCmd!.includes(`localhost:${svc.port}/health`),
        `${svc.name}: healthCheck should target port ${svc.port}, got: "${curlCmd}"`
      );
    }
  });

  it('healthCheck interval=30, timeout=5, retries=3, startPeriod=60', () => {
    for (const svc of SERVICES) {
      const hc = taskDefs[svc.name].containerDefinitions![0].healthCheck!;
      assert.equal(hc.interval, 30, `${svc.name}: healthCheck.interval should be 30`);
      assert.equal(hc.timeout, 5, `${svc.name}: healthCheck.timeout should be 5`);
      assert.equal(hc.retries, 3, `${svc.name}: healthCheck.retries should be 3`);
      assert.equal(hc.startPeriod, 60, `${svc.name}: healthCheck.startPeriod should be 60`);
    }
  });

  // ── Log configuration ───────────────────────────────────────────────────────
  it('logConfiguration uses awslogs driver', () => {
    for (const svc of SERVICES) {
      const logConfig = taskDefs[svc.name].containerDefinitions![0].logConfiguration;
      assert.ok(logConfig, `${svc.name}: logConfiguration is required`);
      assert.equal(
        logConfig!.logDriver,
        'awslogs',
        `${svc.name}: logDriver should be awslogs, got: ${logConfig!.logDriver}`
      );
    }
  });

  it('logConfiguration has awslogs-group = /ecs/<service-name>', () => {
    for (const svc of SERVICES) {
      const options = taskDefs[svc.name].containerDefinitions![0].logConfiguration!.options!;
      assert.equal(
        options['awslogs-group'],
        svc.logGroup,
        `${svc.name}: awslogs-group should be ${svc.logGroup}, got: ${options['awslogs-group']}`
      );
    }
  });

  it('logConfiguration has awslogs-region and awslogs-stream-prefix', () => {
    for (const svc of SERVICES) {
      const options = taskDefs[svc.name].containerDefinitions![0].logConfiguration!.options!;
      assert.ok(
        options['awslogs-region'],
        `${svc.name}: awslogs-region is required`
      );
      assert.ok(
        options['awslogs-stream-prefix'],
        `${svc.name}: awslogs-stream-prefix is required`
      );
    }
  });

  // ── IAM roles ───────────────────────────────────────────────────────────────
  it('executionRoleArn references ecs-task-execution with placeholder', () => {
    for (const svc of SERVICES) {
      const role = taskDefs[svc.name].executionRoleArn || '';
      assert.ok(role.includes('<aws_account_id>'), `${svc.name}: executionRoleArn should use <aws_account_id>`);
      assert.ok(
        role.includes('ecs-task-execution'),
        `${svc.name}: executionRoleArn should reference ecs-task-execution role, got: "${role}"`
      );
    }
  });

  it('taskRoleArn is defined with placeholder', () => {
    for (const svc of SERVICES) {
      const role = taskDefs[svc.name].taskRoleArn || '';
      assert.ok(
        role.includes('<aws_account_id>'),
        `${svc.name}: taskRoleArn should use <aws_account_id>`
      );
      assert.ok(
        role.length > 0,
        `${svc.name}: taskRoleArn must be defined`
      );
    }
  });

  // ── Secrets ─────────────────────────────────────────────────────────────────
  it('authorization-service has secrets for Kafka, Redis, DB, Keycloak', () => {
    const secrets = taskDefs['authorization-service'].containerDefinitions![0].secrets || [];
    const secretNames = secrets.map(s => s.name || '');
    const expected = ['KAFKA_BROKER', 'REDIS_HOST', 'DATABASE_URL', 'KEYCLOAK_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'];
    for (const name of expected) {
      assert.ok(
        secretNames.includes(name),
        `authorization-service: missing secret "${name}"`
      );
    }
  });

  it('sse-server has secrets for Redis and SSE URL', () => {
    const secrets = taskDefs['sse-server'].containerDefinitions![0].secrets || [];
    const secretNames = secrets.map(s => s.name || '');
    assert.ok(secretNames.includes('REDIS_HOST'), 'sse-server: missing REDIS_HOST secret');
    assert.ok(secretNames.includes('REDIS_PORT'), 'sse-server: missing REDIS_PORT secret');
    assert.ok(secretNames.includes('SSE_SERVER_URL'), 'sse-server: missing SSE_SERVER_URL secret');
  });

  it('bff has secrets for SSE URL, Auth URL, and Keycloak', () => {
    const secrets = taskDefs['bff'].containerDefinitions![0].secrets || [];
    const secretNames = secrets.map(s => s.name || '');
    const expected = ['SSE_SERVER_URL', 'AUTH_SERVICE_URL', 'KEYCLOAK_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET'];
    for (const name of expected) {
      assert.ok(
        secretNames.includes(name),
        `bff: missing secret "${name}"`
      );
    }
  });

  it('secrets reference the /open-supervisor/ hierarchy', () => {
    for (const svc of SERVICES) {
      const secrets = taskDefs[svc.name].containerDefinitions![0].secrets || [];
      for (const secret of secrets) {
        assert.ok(
          secret.valueFrom!.includes('/open-supervisor/'),
          `${svc.name}: secret "${secret.name}" valueFrom should reference /open-supervisor/ hierarchy, got: "${secret.valueFrom}"`
        );
      }
    }
  });

  it('secrets do not contain hardcoded account IDs', () => {
    for (const svc of SERVICES) {
      const secrets = taskDefs[svc.name].containerDefinitions![0].secrets || [];
      for (const secret of secrets) {
        const vf = secret.valueFrom || '';
        assert.ok(
          !hasHardcodedAccountId(vf),
          `${svc.name}: secret "${secret.name}" valueFrom contains hardcoded account ID: "${vf}"`
        );
      }
    }
  });

  // ── Environment variables ────────────────────────────────────────────────────
  it('every service has NODE_ENV=production and PORT env vars', () => {
    for (const svc of SERVICES) {
      const env = taskDefs[svc.name].containerDefinitions![0].environment || [];
      const envMap = new Map(env.map(e => [e.name!, e.value!]));
      assert.equal(envMap.get('NODE_ENV'), 'production', `${svc.name}: NODE_ENV should be production`);
      assert.equal(envMap.get('PORT'), String(svc.port), `${svc.name}: PORT should be ${svc.port}`);
    }
  });

  // ── Tags ────────────────────────────────────────────────────────────────────
  it('has tags with Name, Environment, and Project', () => {
    for (const svc of SERVICES) {
      const tags = taskDefs[svc.name].tags || [];
      const tagMap = new Map(tags.map(t => [t.key!, t.value!]));
      assert.ok(tagMap.has('Name'), `${svc.name}: missing Name tag`);
      assert.ok(tagMap.has('Environment'), `${svc.name}: missing Environment tag`);
      assert.equal(tagMap.get('Project'), 'open-supervisor', `${svc.name}: Project tag should be open-supervisor`);
    }
  });

  // ── JSON is valid (parseability already verified by loadTaskDefinition) ──────
  it('task definition parses without errors', () => {
    // Already verified in loadTaskDefinition — this is a placeholder assertion
    assert.ok(true, 'All task definitions parsed successfully');
  });
});

// ─── Integration: jq structural validation ───────────────────────────────────
greenDescribe('US-04 ECS Task Definitions: jq structural checks', () => {
  // Skip if jq is not available
  let hasJq = false;
  before(() => {
    try {
      execSync('which jq', { encoding: 'utf-8', stdio: 'ignore' });
      hasJq = true;
    } catch {
      console.warn('⚠ jq not installed — skipping jq-based validations');
    }
  });

  it('each JSON file validates against a minimal structural schema', () => {
    if (!hasJq) return; // skip silently

    for (const svc of SERVICES) {
      const filePath = resolve(REPO_ROOT, 'infra/ecs/task-definitions', `${svc.name}.json`);
      const checks = [
        // Check family is non-empty string
        `jq -e '.family | length > 0' "${filePath}" > /dev/null`,
        // Check containerDefinitions is non-empty array
        `jq -e '.containerDefinitions | length > 0' "${filePath}" > /dev/null`,
        // Check networkMode is awsvpc
        `jq -e '.networkMode == "awsvpc"' "${filePath}" > /dev/null`,
        // Check requiresCompatibilities includes FARGATE
        `jq -e '.requiresCompatibilities | index("FARGATE") >= 0' "${filePath}" > /dev/null`,
        // Check cpu and memory are non-empty strings
        `jq -e '.cpu | length > 0' "${filePath}" > /dev/null`,
        `jq -e '.memory | length > 0' "${filePath}" > /dev/null`,
        // Check executionRoleArn is non-empty
        `jq -e '.executionRoleArn | length > 0' "${filePath}" > /dev/null`,
        // Check port mapping exists
        `jq -e '.containerDefinitions[0].portMappings[0].containerPort > 0' "${filePath}" > /dev/null`,
        // Check health check exists
        `jq -e '.containerDefinitions[0].healthCheck.command | length > 0' "${filePath}" > /dev/null`,
        // Check log configuration exists
        `jq -e '.containerDefinitions[0].logConfiguration.logDriver == "awslogs"' "${filePath}" > /dev/null`,
      ];

      for (const check of checks) {
        try {
          execSync(check, { encoding: 'utf-8', stdio: 'ignore' });
        } catch {
          assert.fail(`${svc.name}: jq structural check failed: ${check}`);
        }
      }
    }
  });

  it('no 12-digit numbers that look like hardcoded AWS account IDs', () => {
    if (!hasJq) return;

    for (const svc of SERVICES) {
      const filePath = resolve(REPO_ROOT, 'infra/ecs/task-definitions', `${svc.name}.json`);
      const raw = readFileSync(filePath, 'utf-8');
      // Find all 12-digit numbers, exclude 000000000000
      const matches = raw.match(/\b(\d{12})\b/g) || [];
      const nonZero = matches.filter(m => m !== '000000000000');
      assert.equal(
        nonZero.length,
        0,
        `${svc.name}: found potential hardcoded account IDs: [${nonZero}]`
      );
    }
  });
});

// ─── Integration: ECS Services YAML ──────────────────────────────────────────
greenDescribe('US-04 ECS Services YAML: structure', () => {
  const yamlPath = resolve(REPO_ROOT, 'infra/ecs/ecs-services.yaml');

  it('ecs-services.yaml exists', () => {
    assert.ok(existsSync(yamlPath), 'ecs-services.yaml must exist');
  });

  it('ecs-services.yaml has a cluster field', () => {
    const raw = readFileSync(yamlPath, 'utf-8');
    assert.ok(raw.includes('cluster:'), 'ecs-services.yaml must have a cluster field');
  });

  it('ecs-services.yaml defines at least 3 services', () => {
    const raw = readFileSync(yamlPath, 'utf-8');
    // Count service entries
    const serviceMatches = raw.match(/- name:/g) || [];
    assert.ok(
      serviceMatches.length >= 3,
      `Expected at least 3 services, found ${serviceMatches.length}`
    );
  });

  it('ecs-services.yaml references all 3 task definitions', () => {
    const raw = readFileSync(yamlPath, 'utf-8');
    for (const svc of SERVICES) {
      assert.ok(
        raw.includes(svc.name),
        `ecs-services.yaml should reference task definition "${svc.name}"`
      );
    }
  });

  it('ecs-services.yaml has assignPublicIp: DISABLED', () => {
    const raw = readFileSync(yamlPath, 'utf-8');
    assert.ok(
      raw.includes('assignPublicIp: "DISABLED"'),
      'ecs-services.yaml must have assignPublicIp: DISABLED'
    );
  });
});
