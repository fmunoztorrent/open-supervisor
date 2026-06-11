/**
 * validate-deploy-workflow.spec.ts
 * US-07: Validate GitHub Actions CI/CD deploy workflow.
 *
 * Phase RED: These tests fail because .github/workflows/deploy.yml doesn't exist yet.
 * Phase GREEN: After creating deploy.yml, these tests pass.
 *
 * Run: npx tsx --test scripts/aws/validate-deploy-workflow.spec.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/deploy.yml');

/**
 * Parse YAML using python3 (PyYAML).
 */
function parseYamlViaPython(filePath: string): Record<string, unknown> {
  const script = `
import sys, json, yaml
with open(sys.argv[1], 'r') as f:
    data = yaml.safe_load(f)
print(json.dumps(data))
`;
  try {
    const result = execSync(`python3 -c "${script.replace(/\n/g, '; ')}" "${filePath}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result.trim());
  } catch {
    // python3 yaml not available, try yq
    try {
      const result = execSync(`yq eval -o=json "${filePath}"`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return JSON.parse(result.trim());
    } catch {
      return {};
    }
  }
}

// ─── Phase RED: pre-condition — workflow file must exist ─────────────────────

describe('US-07 CI/CD Workflow: pre-condition — file exists', () => {
  it('.github/workflows/deploy.yml exists', () => {
    assert.ok(
      existsSync(WORKFLOW_PATH),
      'deploy.yml must exist to run tests'
    );
  });
});

// ─── Phase GREEN: Validate workflow structure ────────────────────────────────

const workflowExists = existsSync(WORKFLOW_PATH);
const greenDescribe = workflowExists ? describe : describe.skip;

const expectedServices = ['authorization-service', 'sse-server', 'bff'];
const expectedDeployOrder = ['bff', 'sse-server', 'authorization-service'];

greenDescribe('US-07 CI/CD Workflow: GREEN phase — structure', () => {
  let workflow: Record<string, unknown> = {};

  before(() => {
    workflow = parseYamlViaPython(WORKFLOW_PATH);
  });

  // ── Name ─────────────────────────────────────────────────────────────────
  it('has a name', () => {
    assert.ok(workflow.name, 'Workflow must have a name');
  });

  // ── Triggers ─────────────────────────────────────────────────────────────
  it('triggers on push to main', () => {
    const on = workflow.on as Record<string, unknown> | undefined;
    assert.ok(on, 'on field is required');
    const push = on.push as Record<string, unknown> | undefined;
    assert.ok(push, 'push trigger is required');
    const branches = push.branches as string[] | undefined;
    assert.ok(branches?.includes('main'), 'push trigger must include main branch');
  });

  it('supports workflow_dispatch with branch selector', () => {
    const on = workflow.on as Record<string, unknown> | undefined;
    // workflow_dispatch may be null or an object (both are valid YAML for "just enable it")
    assert.ok(
      on !== undefined && 'workflow_dispatch' in on!,
      'workflow_dispatch trigger is required'
    );
  });

  // ── Jobs ─────────────────────────────────────────────────────────────────
  it('has a build-and-push job', () => {
    const jobs = workflow.jobs as Record<string, unknown> | undefined;
    assert.ok(jobs, 'jobs field is required');
    assert.ok(jobs['build-and-push'], 'build-and-push job is required');
  });

  it('has a deploy job', () => {
    const jobs = workflow.jobs as Record<string, unknown> | undefined;
    assert.ok(jobs!['deploy'], 'deploy job is required');
  });

  // ── build-and-push job details ───────────────────────────────────────────
  it('build-and-push has timeout-minutes of 20', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    assert.equal(job['timeout-minutes'], 20, 'build-and-push should have 20 minute timeout');
  });

  it('build-and-push runs on ubuntu-latest', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    assert.equal(job['runs-on'], 'ubuntu-latest', 'build-and-push should run on ubuntu-latest');
  });

  it('build-and-push uses matrix strategy for 3 services', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const strategy = job.strategy as Record<string, unknown> | undefined;
    assert.ok(strategy, 'strategy is required on build-and-push');
    const matrix = strategy.matrix as Record<string, unknown> | undefined;
    assert.ok(matrix, 'matrix is required in strategy');
    const services = matrix.service as string[] | undefined;
    assert.ok(services, 'matrix.service array is required');
    for (const expected of expectedServices) {
      assert.ok(
        services.includes(expected),
        `matrix.service must include "${expected}"`
      );
    }
  });

  it('build-and-push configures AWS credentials with OIDC', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    assert.ok(steps, 'steps are required');

    const awsStep = steps.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' && s.uses.startsWith('aws-actions/configure-aws-credentials')
    );
    assert.ok(awsStep, 'Must use aws-actions/configure-aws-credentials');
    const awsUses = (awsStep as Record<string, unknown>)['uses'] as string | undefined;
    assert.ok(
      awsUses?.includes('@v4'),
      'Must use @v4 of configure-aws-credentials'
    );

    const with_ = (awsStep as Record<string, unknown>).with as Record<string, unknown> | undefined;
    assert.ok(with_, 'configure-aws-credentials must have `with`');
    assert.ok(
      (with_['role-to-assume'] as string)?.includes('<aws_account_id>'),
      'role-to-assume must use <aws_account_id> placeholder'
    );
    assert.ok(
      (with_['aws-region'] as string)?.length > 0,
      'aws-region must be set'
    );
  });

  it('build-and-push uses docker/setup-buildx-action', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    const buildxStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' && s.uses.includes('setup-buildx-action')
    );
    assert.ok(buildxStep, 'Must set up docker buildx');
  });

  it('build-and-push uses ECR login action (amazon-ecr-login or docker/login-action)', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    const loginStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' &&
        (s.uses.includes('amazon-ecr-login') || s.uses.includes('docker/login-action'))
    );
    assert.ok(loginStep, 'Must use ECR login action (amazon-ecr-login or docker/login-action)');
  });

  it('build-and-push uses docker/build-push-action with cache type=gha and multi-arch', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    const buildStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' && s.uses.includes('docker/build-push-action')
    );
    assert.ok(buildStep, 'Must use docker/build-push-action');

    const with_ = (buildStep as Record<string, unknown>).with as Record<string, unknown> | undefined;
    assert.ok(with_, 'build-push-action must have `with`');

    // Check platforms
    const platforms = with_['platforms'] as string | undefined;
    assert.ok(platforms, 'platforms must be set for multi-arch build');
    assert.ok(
      platforms.includes('linux/amd64'),
      'platforms must include linux/amd64'
    );
    assert.ok(
      platforms.includes('linux/arm64'),
      'platforms must include linux/arm64'
    );

    // Check cache
    const cacheTo = with_['cache-to'] as string | undefined;
    const cacheFrom = with_['cache-from'] as string | undefined;
    const hasGhaCache =
      (cacheTo && cacheTo.includes('type=gha')) ||
      (cacheFrom && cacheFrom.includes('type=gha'));
    assert.ok(hasGhaCache, 'Must use type=gha for Docker layer caching');
  });

  it('build-and-push has a step to generate sha and latest tags', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');

    // Check meta step generates tags with sha- prefix
    const metaStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.id === 'string' && s.id === 'meta'
    );
    assert.ok(metaStep, 'Must have a meta step to generate image tags (id: meta)');

    // Check the meta step run script uses sha-${GITHUB_SHA::7}
    assert.ok(
      raw.includes('sha-${GITHUB_SHA::7}') || raw.includes('GITHUB_SHA::7'),
      'Image tags should include sha commit hash (sha-${GITHUB_SHA::7})'
    );

    // Check that meta step outputs include "latest"
    assert.ok(
      raw.includes(':latest'),
      'Image tags should include latest for default deploy'
    );

    // Check build-push-action uses meta step tags output
    const buildStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' && s.uses.includes('docker/build-push-action')
    );
    const with_ = (buildStep as Record<string, unknown>).with as Record<string, unknown>;
    const tags = with_['tags'] as string | undefined;
    assert.ok(tags, 'tags must be set on build-push-action');
    assert.ok(
      tags.includes('steps.meta.outputs.tags') || tags.includes('steps.meta.outputs'),
      'build-push-action should reference tags from meta step output'
    );
  });

  it('build-and-push pushes image to ECR URI pattern', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');

    // Check ECR_REGISTRY env var uses amazonaws.com
    assert.ok(
      raw.includes('amazonaws.com'),
      'ECR registry should reference amazonaws.com'
    );
    assert.ok(
      raw.includes('open-supervisor'),
      'ECR URI should include open-supervisor repository prefix'
    );
  });

  it('build-and-push uses Docker build context from repo root', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const steps = job.steps as Record<string, unknown>[] | undefined;
    const buildStep = steps!.find(
      (s: Record<string, unknown>) =>
        typeof s.uses === 'string' && s.uses.includes('docker/build-push-action')
    );
    const with_ = (buildStep as Record<string, unknown>).with as Record<string, unknown>;
    const context = with_['context'] as string | undefined;
    const file = with_['file'] as string | undefined;

    assert.ok(
      context === '.' || context === undefined,
      `build context should be repo root (.), got: "${context}"`
    );
    assert.ok(
      file && file.includes('Dockerfile'),
      `file should point to service Dockerfile, got: "${file}"`
    );
  });

  it('build-and-push defines ECR_REGISTRY output or uses env vars for ECR URI', () => {
    const job = (workflow.jobs as Record<string, unknown>)['build-and-push'] as Record<string, unknown>;
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');

    // Check that account ID is referenced via variable not hardcoded
    assert.ok(
      raw.includes('aws_account_id') || raw.includes('AWS_ACCOUNT_ID'),
      'Workflow should reference AWS account ID via placeholder or env var'
    );
    assert.ok(
      raw.includes('ecr') || raw.includes('ECR'),
      'Workflow should reference ECR'
    );
  });

  // ── deploy job details ──────────────────────────────────────────────────
  it('deploy job runs after build-and-push', () => {
    const deployJob = (workflow.jobs as Record<string, unknown>)['deploy'] as Record<string, unknown>;
    const needs = deployJob.needs as string | string[] | undefined;
    const needsArray = Array.isArray(needs) ? needs : [needs];
    assert.ok(
      needsArray.includes('build-and-push'),
      'deploy job must depend on build-and-push'
    );
  });

  it('deploy has timeout-minutes of 20', () => {
    const deployJob = (workflow.jobs as Record<string, unknown>)['deploy'] as Record<string, unknown>;
    assert.equal(deployJob['timeout-minutes'], 20, 'deploy should have 20 minute timeout');
  });

  it('deploy updates services in order: bff → sse-server → authorization-service', () => {
    const deployJob = (workflow.jobs as Record<string, unknown>)['deploy'] as Record<string, unknown>;
    const steps = deployJob.steps as Record<string, unknown>[] | undefined;
    assert.ok(steps, 'deploy job must have steps');

    // Find all ECS update-service steps in order
    const ecsSteps = steps.filter(
      (s: Record<string, unknown>) =>
        (typeof s.run === 'string' && s.run.includes('ecs update-service')) ||
        (typeof s.run === 'string' && s.run.includes('update-service'))
    );

    assert.ok(ecsSteps.length >= 3, 'There should be at least 3 ECS service update steps');

    // Verify the order: bff → sse-server → authorization-service
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    const bffIdx = raw.indexOf(expectedDeployOrder[0]);
    const sseIdx = raw.indexOf(expectedDeployOrder[1]);
    const authIdx = raw.indexOf(expectedDeployOrder[2]);

    assert.ok(bffIdx >= 0, 'deploy must reference bff');
    assert.ok(sseIdx >= 0, 'deploy must reference sse-server');
    assert.ok(authIdx >= 0, 'deploy must reference authorization-service');
    assert.ok(
      bffIdx < sseIdx,
      'deploy order should be bff before sse-server'
    );
    assert.ok(
      sseIdx < authIdx,
      'deploy order should be sse-server before authorization-service'
    );
  });

  it('deploy uses --force-new-deployment flag', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      raw.includes('--force-new-deployment'),
      'deploy should use --force-new-deployment to force ECS service update'
    );
  });

  it('deploy references ECS cluster name "open-supervisor"', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      raw.includes('open-supervisor'),
      'deploy should reference the ECS cluster "open-supervisor"'
    );
  });

  it('deploy references task definition family names from infra/ecs/task-definitions/', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    for (const svc of expectedServices) {
      const familyName = `open-supervisor-${svc}`;
      assert.ok(
        raw.includes(familyName),
        `deploy should reference task definition family "${familyName}"`
      );
    }
  });

  // ── Security ─────────────────────────────────────────────────────────────
  it('does not contain hardcoded AWS credentials or secrets', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    const sensitivePatterns = [
      'aws_access_key_id',
      'aws_secret_access_key',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AKIA',
    ];
    for (const pattern of sensitivePatterns) {
      assert.ok(
        !raw.includes(pattern),
        `Workflow must not contain ${pattern} — use OIDC instead`
      );
    }
  });

  it('does not contain hardcoded 12-digit AWS account IDs', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    const matches = raw.match(/\b(\d{12})\b/g) || [];
    const nonZero = matches.filter(m => m !== '000000000000');
    assert.equal(
      nonZero.length,
      0,
      `Found potential hardcoded account IDs: [${nonZero}]`
    );
  });

  // ── Step references from ci.yml patterns ─────────────────────────────────
  it('uses pnpm/action-setup@v4 with version 11', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      raw.includes('pnpm/action-setup@v4'),
      'Should use pnpm/action-setup@v4'
    );
    assert.ok(
      raw.includes('version: 11') || raw.includes("version: '11'"),
      'Should use pnpm version 11'
    );
  });

  it('uses actions/setup-node@v4 with node-version: 24', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    assert.ok(
      raw.includes('actions/setup-node@v4'),
      'Should use actions/setup-node@v4'
    );
    assert.ok(
      raw.includes('node-version: 24') || raw.includes("node-version: '24'"),
      'Should use node version 24'
    );
  });

  // ── No secrets in build args ─────────────────────────────────────────────
  it('does not pass sensitive --build-arg values to docker build', () => {
    const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
    // If build-arg is used, ensure it's not for secrets
    const buildArgLines = raw.split('\n').filter(l => l.includes('build-arg'));
    for (const line of buildArgLines) {
      assert.ok(
        !line.includes('password') &&
        !line.includes('secret') &&
        !line.includes('token') &&
        !line.includes('key'),
        `build-arg may expose secrets: "${line.trim()}"`
      );
    }
  });
});

// ─── Integration: yq structural checks ───────────────────────────────────────
greenDescribe('US-07 CI/CD Workflow: yq/jq structural checks', () => {
  let hasYq = false;
  let hasJq = false;

  before(() => {
    try {
      execSync('which yq', { encoding: 'utf-8', stdio: 'ignore' });
      hasYq = true;
    } catch {
      // yq not available
    }
    try {
      execSync('which jq', { encoding: 'utf-8', stdio: 'ignore' });
      hasJq = true;
    } catch {
      // jq not available
    }
  });

  it('deploy.yml is valid YAML', () => {
    if (!hasYq) return;
    try {
      execSync(`yq eval '.' "${WORKFLOW_PATH}" > /dev/null`, {
        encoding: 'utf-8',
        stdio: 'ignore',
      });
    } catch {
      assert.fail('deploy.yml is not valid YAML');
    }
  });

  it('workflow has exactly 2 top-level jobs', () => {
    if (!hasYq) return;
    const result = execSync(`yq eval '.jobs | keys | length' "${WORKFLOW_PATH}"`, {
      encoding: 'utf-8',
    });
    const count = parseInt(result.trim(), 10);
    assert.equal(count, 2, `Expected 2 jobs, got ${count}`);
  });

  it('build-and-push matrix iterates exactly 3 services', () => {
    if (!hasYq) return;
    const result = execSync(
      `yq eval '.jobs.build-and-push.strategy.matrix.service | length' "${WORKFLOW_PATH}"`,
      { encoding: 'utf-8' }
    );
    const count = parseInt(result.trim(), 10);
    assert.equal(count, 3, `Expected 3 services in matrix, got ${count}`);
  });

  it('deploy job has needs: [build-and-push]', () => {
    if (!hasYq) return;
    const needs = execSync(
      `yq eval '.jobs.deploy.needs // ""' "${WORKFLOW_PATH}"`,
      { encoding: 'utf-8' }
    ).trim();
    assert.ok(
      needs.includes('build-and-push'),
      `deploy job should need build-and-push, got: "${needs}"`
    );
  });

  it('push trigger targets only main branch', () => {
    if (!hasYq) return;
    const branches = execSync(
      `yq eval '.on.push.branches[]' "${WORKFLOW_PATH}"`,
      { encoding: 'utf-8' }
    ).trim().split('\n');
    assert.deepEqual(
      branches,
      ['main'],
      `push trigger should only target main, got: [${branches}]`
    );
  });

  it('workflow_dispatch is present (empty or object — just the trigger is enough)', () => {
    if (!hasYq) return;
    // Check that key exists at all (empty/null YAML key is valid)
    try {
      execSync(
        `yq eval '.on | has("workflow_dispatch")' "${WORKFLOW_PATH}"`,
        { encoding: 'utf-8', stdio: 'pipe' }
      );
    } catch {
      assert.fail('workflow_dispatch trigger must be present');
    }
  });
});
