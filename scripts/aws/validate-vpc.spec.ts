/**
 * validate-vpc.spec.ts
 * TDD tests for US-05: VPC Networking CloudFormation template.
 *
 * Phase RED: These tests fail because infra/network/vpc.yaml does not exist yet.
 * Phase GREEN: After creating the template, these tests pass.
 *
 * Run: npx tsx --test scripts/aws/validate-vpc.spec.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const TEMPLATE_PATH = resolve(REPO_ROOT, 'infra/network/vpc.yaml');

interface CloudFormationTemplate {
  AWSTemplateFormatVersion?: string;
  Description?: string;
  Parameters?: Record<string, unknown>;
  Resources?: Record<string, Resource>;
  Outputs?: Record<string, Output>;
}

interface Resource {
  Type: string;
  Properties?: Record<string, unknown>;
}

interface Output {
  Value: unknown;
  Description?: string;
}

/**
 * Parse and load the CloudFormation template using parse-cfn-yaml.js helper.
 */
function loadTemplate(): CloudFormationTemplate {
  const result = execSync(
    `node scripts/aws/parse-cfn-yaml.js "${TEMPLATE_PATH}"`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(result.trim()) as CloudFormationTemplate;
}

// ─── Phase RED: Template file must exist for validation ─────────────────────

describe('US-05 VPC: pre-condition — template exists', () => {
  it('infra/network/vpc.yaml exists for validation', () => {
    assert.ok(
      existsSync(TEMPLATE_PATH),
      `Template ${TEMPLATE_PATH} must exist to run tests`
    );
  });
});

// ─── Phase GREEN: Validate template structure (skipped if file missing) ───────

const greenDescribe = existsSync(TEMPLATE_PATH) ? describe : describe.skip;

greenDescribe('US-05 VPC: GREEN phase — template structure', () => {
  let template: CloudFormationTemplate;

  before(() => {
    template = loadTemplate();
  });

  it('has AWSTemplateFormatVersion 2010-09-09', () => {
    assert.equal(template.AWSTemplateFormatVersion, '2010-09-09');
  });

  it('has a Description mentioning open-supervisor', () => {
    assert.ok(template.Description, 'Description is missing');
    assert.ok(
      template.Description!.toLowerCase().includes('open-supervisor'),
      `Description should mention "open-supervisor", got: "${template.Description}"`
    );
  });

  it('has a non-empty Parameters section', () => {
    assert.ok(template.Parameters, 'Parameters section is missing');
    assert.ok(Object.keys(template.Parameters!).length > 0, 'Parameters section is empty');
  });

  it('has at least one AWS::EC2::VPC resource', () => {
    const resources = template.Resources || {};
    const vpcs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::VPC');
    assert.ok(vpcs.length >= 1, 'No VPC resource found');
  });

  it('VPC has a CidrBlock defined (via parameter !Ref VpcCidr)', () => {
    const resources = template.Resources || {};
    const vpcs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::VPC');
    assert.ok(vpcs.length >= 1);
    const cidrBlock = (vpcs[0][1].Properties as Record<string, unknown>)?.CidrBlock;
    assert.ok(cidrBlock, 'VPC CidrBlock must be defined');

    // Check that the default value for VpcCidr parameter is 10.0.0.0/16
    const vpcCidrParam = (template.Parameters as Record<string, any>)?.VpcCidr;
    assert.ok(vpcCidrParam, 'VpcCidr parameter must exist');
    assert.equal(vpcCidrParam.Default, '10.0.0.0/16');
  });

  it('has at least 4 subnets (2 public + 2 private) with Type tags', () => {
    const resources = template.Resources || {};
    const subnets = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::Subnet');
    assert.ok(subnets.length >= 4, `Expected >=4 subnets, got ${subnets.length}`);

    // Check public/private tagging on subnets
    const publicSubnets = subnets.filter(([, s]) => {
      const tags = (s.Properties as Record<string, unknown>)?.Tags as Array<Record<string, unknown>> || [];
      return tags.some(t => (t.Key as string) === 'Type' && (t.Value as string) === 'public');
    });
    assert.ok(publicSubnets.length >= 2, `Expected >=2 public subnets, got ${publicSubnets.length}`);

    const privateSubnets = subnets.filter(([, s]) => {
      const tags = (s.Properties as Record<string, unknown>)?.Tags as Array<Record<string, unknown>> || [];
      return tags.some(t => (t.Key as string) === 'Type' && (t.Value as string) === 'private');
    });
    assert.ok(privateSubnets.length >= 2, `Expected >=2 private subnets, got ${privateSubnets.length}`);
  });

  it('has an Internet Gateway', () => {
    const resources = template.Resources || {};
    const igws = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::InternetGateway');
    assert.ok(igws.length >= 1, 'No InternetGateway found');
  });

  it('has a NAT Gateway with EIP', () => {
    const resources = template.Resources || {};
    const nats = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::NatGateway');
    assert.ok(nats.length >= 1, 'No NatGateway found');
    assert.ok(
      (nats[0][1].Properties as Record<string, unknown>)?.AllocationId,
      'NAT Gateway should reference an EIP AllocationId'
    );
  });

  it('has an Internet-facing ALB', () => {
    const resources = template.Resources || {};
    const albs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::ElasticLoadBalancingV2::LoadBalancer');
    assert.ok(albs.length >= 1, 'No ALB found');
    assert.equal(
      (albs[0][1].Properties as Record<string, unknown>)?.Scheme,
      'internet-facing',
      'ALB should be internet-facing'
    );
  });

  it('has a target group for BFF on port 3000 (target type: ip)', () => {
    const resources = template.Resources || {};
    const tgs = Object.entries(resources).filter(
      ([, r]) => r.Type === 'AWS::ElasticLoadBalancingV2::TargetGroup'
    );
    const bffTg = tgs.find(([, tg]) => (tg.Properties as Record<string, unknown>)?.Port === 3000);
    assert.ok(bffTg, 'No target group on port 3000 found');
    assert.equal(
      (bffTg[1].Properties as Record<string, unknown>)?.TargetType,
      'ip',
      'Target type should be "ip" for Fargate'
    );
  });

  it('has an ALB Listener on port 80', () => {
    const resources = template.Resources || {};
    const listeners = Object.entries(resources).filter(
      ([, r]) => r.Type === 'AWS::ElasticLoadBalancingV2::Listener'
    );
    assert.ok(listeners.length >= 1, 'No listener found');
    assert.equal(
      (listeners[0][1].Properties as Record<string, unknown>)?.Port,
      80,
      'Listener should be on port 80'
    );
  });

  it('has security group alb-sg allowing HTTP 80 from 0.0.0.0/0', () => {
    const resources = template.Resources || {};
    const sgs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::SecurityGroup');
    const albSg = sgs.find(([name]) => name.toLowerCase().includes('alb'));
    assert.ok(albSg, 'alb-sg not found');

    const ingress = (albSg[1].Properties as Record<string, unknown>)?.SecurityGroupIngress as Array<Record<string, unknown>>;
    assert.ok(ingress, 'alb-sg missing ingress rules');
    const http80 = ingress.find(
      (r) => r.IpProtocol === 'tcp' && r.FromPort === 80 && r.ToPort === 80
    );
    assert.ok(http80, 'alb-sg missing HTTP 80 ingress rule');
    assert.equal(http80.CidrIp, '0.0.0.0/0', 'HTTP 80 should allow from anywhere');
  });

  it('has security group bff-sg allowing inbound from alb-sg on port 3000', () => {
    const resources = template.Resources || {};
    const sgs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::SecurityGroup');
    const bffSg = sgs.find(([name]) => name.toLowerCase().includes('bff'));
    assert.ok(bffSg, 'bff-sg not found');

    const ingress = (bffSg[1].Properties as Record<string, unknown>)?.SecurityGroupIngress as Array<Record<string, unknown>>;
    assert.ok(ingress, 'bff-sg missing ingress rules');
    const port3000 = ingress.find(
      (r) => r.IpProtocol === 'tcp' && r.FromPort === 3000 && r.ToPort === 3000
    );
    assert.ok(port3000, 'bff-sg missing port 3000 ingress rule');
    assert.ok(port3000.SourceSecurityGroupId, 'bff-sg should reference alb-sg as source');
  });

  it('has security group sse-server-sg allowing inbound from bff-sg on port 3002', () => {
    const resources = template.Resources || {};
    const sgs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::SecurityGroup');
    const sseSg = sgs.find(([name]) => name.toLowerCase().includes('sse'));
    assert.ok(sseSg, 'sse-server-sg not found');

    const ingress = (sseSg[1].Properties as Record<string, unknown>)?.SecurityGroupIngress as Array<Record<string, unknown>>;
    assert.ok(ingress, 'sse-server-sg missing ingress rules');
    const port3002 = ingress.find(
      (r) => r.IpProtocol === 'tcp' && r.FromPort === 3002 && r.ToPort === 3002
    );
    assert.ok(port3002, 'sse-server-sg missing port 3002 ingress rule');
  });

  it('has security group auth-service-sg allowing inbound from bff-sg on port 3001', () => {
    const resources = template.Resources || {};
    const sgs = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::EC2::SecurityGroup');
    const authSg = sgs.find(([name]) => name.toLowerCase().includes('auth'));
    assert.ok(authSg, 'auth-service-sg not found');

    const ingress = (authSg[1].Properties as Record<string, unknown>)?.SecurityGroupIngress as Array<Record<string, unknown>>;
    assert.ok(ingress, 'auth-service-sg missing ingress rules');
    const port3001 = ingress.find(
      (r) => r.IpProtocol === 'tcp' && r.FromPort === 3001 && r.ToPort === 3001
    );
    assert.ok(port3001, 'auth-service-sg missing port 3001 ingress rule');
  });

  it('has IAM role ecs-task-execution with ECS trust policy', () => {
    const resources = template.Resources || {};
    const roles = Object.entries(resources).filter(([, r]) => r.Type === 'AWS::IAM::Role');
    const ecsRole = roles.find(
      ([name]) => name.toLowerCase().includes('ecs') || name.toLowerCase().includes('execution')
    );
    assert.ok(ecsRole, 'ecs-task-execution IAM role not found');

    const assumeRoleDoc = (ecsRole[1].Properties as Record<string, unknown>)?.AssumeRolePolicyDocument as Record<string, unknown>;
    const statements = (assumeRoleDoc?.Statement as Array<Record<string, unknown>>) || [];
    assert.ok(
      statements.some((s: Record<string, unknown>) =>
        (s.Principal as Record<string, unknown>)?.Service === 'ecs-tasks.amazonaws.com'
      ),
      'IAM role should trust ecs-tasks.amazonaws.com'
    );
  });

  it('has Outputs: VpcId, PublicSubnetIds, PrivateSubnetIds, AlbDnsName, AlbTargetGroupArn, SecurityGroupIds', () => {
    assert.ok(template.Outputs, 'Outputs section is missing');
    const required = ['VpcId', 'PublicSubnetIds', 'PrivateSubnetIds', 'AlbDnsName', 'AlbTargetGroupArn', 'SecurityGroupIds'];
    for (const out of required) {
      assert.ok(out in template.Outputs!, `Missing output: ${out}`);
    }
  });

  it('has no hardcoded AWS account IDs', () => {
    const raw = JSON.stringify(template);
    const matches = raw.match(/\b(\d{12})\b/g) || [];
    const filtered = matches.filter(m => m !== '000000000000');
    assert.equal(filtered.length, 0, `Found potential hardcoded account IDs: ${filtered}`);
  });

  it('structure passes all checks in validate-vpc-structure.js', () => {
    const result = execSync(
      `node scripts/aws/validate-vpc-structure.js "${TEMPLATE_PATH}"`,
      { encoding: 'utf-8' }
    );
    // Check that the summary line reports 0 failures
    const summaryLine = result.trim().split('\n').filter(l => l.includes('Failed')).pop() || '';
    assert.ok(summaryLine.includes('0'), `Validation should report 0 failures:\n${result}`);
  });
});

// ─── CloudFormation validate-template Integration ─────────────────────────────

describe('US-05 VPC: aws cloudformation validate-template', () => {
  it('passes AWS CloudFormation validation', () => {
    // Skip if template doesn't exist or AWS CLI is not installed
    try {
      execSync('which aws', { encoding: 'utf-8', stdio: 'ignore' });
    } catch {
      console.warn('⚠ AWS CLI not installed — skipping validate-template');
      return;
    }
    if (!existsSync(TEMPLATE_PATH)) {
      console.warn(`⚠ ${TEMPLATE_PATH} not found — skipping`);
      return;
    }

    try {
      const out = execSync(
        `aws cloudformation validate-template --template-body file://${TEMPLATE_PATH} --region us-east-1`,
        { encoding: 'utf-8' }
      );
      assert.ok(out.includes('Parameters') || out.includes('Description'),
        'CloudFormation validation response should include Parameters or Description');
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; status?: number };
      if (err.stderr?.includes('Unable to locate credentials') ||
          err.stderr?.includes('is not authorized') ||
          err.status === 255) {
        console.warn('⚠ AWS credentials not configured — skipping CloudFormation validation');
        return;
      }
      throw e;
    }
  });
});
