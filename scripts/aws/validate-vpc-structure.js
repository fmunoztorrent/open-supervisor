#!/usr/bin/env node
/**
 * validate-vpc-structure.js
 * Structural validation of infra/network/vpc.yaml CloudFormation template.
 *
 * Run via: node scripts/aws/validate-vpc-structure.js <path-to-vpc.yaml>
 *
 * Exits with:
 *   0 if all checks pass
 *   1 if any check fails
 *   2 if template file is not found or invalid
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const templatePath = process.argv[2];
if (!templatePath) {
  console.error('Usage: node validate-vpc-structure.js <path-to-vpc.yaml>');
  process.exit(2);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function check(name, condition, detail) {
  const passed = !!condition;
  const icon = passed ? '\x1b[32m\u2713' : '\x1b[31m\u2717';
  const reset = '\x1b[0m';
  console.log(`${icon} ${name}${reset}${passed ? '' : ': ' + (detail || '')}`);
  if (passed) passCount++; else failCount++;
}

function findResources(template, type) {
  return Object.entries(template.Resources || {}).filter(([, r]) => r.Type === type);
}

function findSG(securityGroups, namePattern) {
  return securityGroups.find(([n]) => n.toLowerCase().includes(namePattern));
}

/**
 * Extract a human-readable string from a CFN-resolved value.
 * Tags like !Ref, !Sub produce objects like { Ref: 'X' }, { 'Fn::Sub': '...' }.
 * This helper flattens them to strings for pattern matching.
 */
function resolveValue(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (v.Ref) return v.Ref;
    if (v['Fn::Sub']) return v['Fn::Sub'];
    if (v['Fn::GetAtt']) return Array.isArray(v['Fn::GetAtt']) ? v['Fn::GetAtt'].join('.') : v['Fn::GetAtt'];
    if (v['Fn::Join']) return JSON.stringify(v['Fn::Join']);
    return JSON.stringify(v);
  }
  return String(v);
}

/**
 * Check if a value (possibly CFN-resolved) contains a substring.
 */
function containsValue(v, substr) {
  const s = resolveValue(v);
  return s.toLowerCase().includes(substr.toLowerCase());
}

function printSummary() {
  console.log('');
  console.log(`\x1b[1m\u2501\u2501\u2501 Summary \u2501\u2501\u2501\x1b[0m`);
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
}

// ── Load template ────────────────────────────────────────────────────────────

if (!fs.existsSync(templatePath)) {
  check('Template file exists', false, `File not found: ${templatePath}`);
  printSummary();
  process.exit(1);
}

let t;
try {
  const parserScript = path.join(path.dirname(process.argv[1]), 'parse-cfn-yaml.js');
  const result = execSync(`node "${parserScript}" "${templatePath}"`, { encoding: 'utf-8' });
  t = JSON.parse(result.trim());
  check('YAML parse successful', true);
} catch (e) {
  check('YAML parse successful', false, e.message.split('\n')[0]);
  printSummary();
  process.exit(1);
}

// ── Structure checks ─────────────────────────────────────────────────────────

check('AWSTemplateFormatVersion is 2010-09-09',
  t.AWSTemplateFormatVersion === '2010-09-09',
  `Got: ${t.AWSTemplateFormatVersion}`);

check('Description mentions open-supervisor',
  t.Description && containsValue(t.Description, 'open-supervisor'),
  `Got: ${resolveValue(t.Description)}`);

check('Parameters section exists',
  t.Parameters && Object.keys(t.Parameters).length > 0,
  'Parameters missing or empty');

// ── Resource checks ──────────────────────────────────────────────────────────

const vpcs = findResources(t, 'AWS::EC2::VPC');
check('AWS::EC2::VPC exists', vpcs.length >= 1);
if (vpcs.length >= 1) {
  const [, vpc] = vpcs[0];
  const tags = vpc.Properties?.Tags || [];
  const nameTag = tags.find(t => t.Key === 'Name');
  check('VPC Name tag contains "open-supervisor"',
    nameTag && nameTag.Value && containsValue(nameTag.Value, 'open-supervisor'),
    `Tags: ${JSON.stringify(tags)}`);

  check('VPC has a CidrBlock defined',
    !!vpc.Properties?.CidrBlock,
    `Got: ${resolveValue(vpc.Properties?.CidrBlock)}`);

  check('VPC has EnableDnsSupport: true',
    vpc.Properties?.EnableDnsSupport !== false);
  check('VPC has EnableDnsHostnames: true',
    vpc.Properties?.EnableDnsHostnames !== false);
}

const subnets = findResources(t, 'AWS::EC2::Subnet');
check('At least 4 subnets (2 public + 2 private)', subnets.length >= 4,
  `Found ${subnets.length} subnets`);
if (subnets.length >= 4) {
  const cidrs = subnets.map(([, s]) => s.Properties?.CidrBlock);
  check('Subnets have unique CIDR blocks',
    new Set(cidrs.map(c => resolveValue(c))).size >= 4,
    `Got: ${JSON.stringify(cidrs.map(c => resolveValue(c)))}`);
  // Check for public/private tagging on subnets
  const publicCount = subnets.filter(([, s]) => {
    const tags = s.Properties?.Tags || [];
    return tags.some(t => resolveValue(t.Key) === 'Type' && resolveValue(t.Value) === 'public');
  }).length;
  check('At least 2 public subnets (tagged Type=public)', publicCount >= 2,
    `Found ${publicCount} public subnets`);
  const privateCount = subnets.filter(([, s]) => {
    const tags = s.Properties?.Tags || [];
    return tags.some(t => resolveValue(t.Key) === 'Type' && resolveValue(t.Value) === 'private');
  }).length;
  check('At least 2 private subnets (tagged Type=private)', privateCount >= 2,
    `Found ${privateCount} private subnets`);
}

const igws = findResources(t, 'AWS::EC2::InternetGateway');
check('AWS::EC2::InternetGateway exists', igws.length >= 1);

const vpcAttachments = findResources(t, 'AWS::EC2::VPCGatewayAttachment');
check('AWS::EC2::VPCGatewayAttachment exists', vpcAttachments.length >= 1);

const eips = findResources(t, 'AWS::EC2::EIP');
check('AWS::EC2::EIP exists (for NAT Gateway)', eips.length >= 1);

const nats = findResources(t, 'AWS::EC2::NatGateway');
check('AWS::EC2::NatGateway exists', nats.length >= 1);
if (nats.length >= 1) {
  const [, nat] = nats[0];
  check('NAT Gateway has AllocationId (references EIP)',
    !!nat.Properties?.AllocationId,
    `Properties: ${JSON.stringify(nat.Properties)}`);
}

// Route tables
const routeTables = findResources(t, 'AWS::EC2::RouteTable');
check('Route tables exist', routeTables.length >= 1);
const publicRt = routeTables.find(([n]) => n.toLowerCase().includes('public'));
const privateRt = routeTables.find(([n]) => n.toLowerCase().includes('private'));
check('Public route table exists', !!publicRt);
check('Private route table exists', !!privateRt);

// Standalone AWS::EC2::Route resources for 0.0.0.0/0 routes
// In CloudFormation, routes are separate resources, not inline in RouteTable
const standaloneRoutes = findResources(t, 'AWS::EC2::Route');
const publicRouteRes = standaloneRoutes.find(([n]) => n.toLowerCase().includes('public'));
const privateRouteRes = standaloneRoutes.find(([n]) => n.toLowerCase().includes('private'));
if (publicRouteRes) {
  const [, route] = publicRouteRes;
  check('Public route resource: 0.0.0.0/0 -> IGW',
    resolveValue(route.Properties?.DestinationCidrBlock) === '0.0.0.0/0' && route.Properties?.GatewayId,
    `Dest: ${resolveValue(route.Properties?.DestinationCidrBlock)}, GatewayId: ${!!route.Properties?.GatewayId}`);
}
if (privateRouteRes) {
  const [, route] = privateRouteRes;
  check('Private route resource: 0.0.0.0/0 -> NAT',
    resolveValue(route.Properties?.DestinationCidrBlock) === '0.0.0.0/0' && route.Properties?.NatGatewayId,
    `Dest: ${resolveValue(route.Properties?.DestinationCidrBlock)}, NatGatewayId: ${!!route.Properties?.NatGatewayId}`);
}

const rtAssocs = findResources(t, 'AWS::EC2::SubnetRouteTableAssociation');
check('Subnet route table associations exist', rtAssocs.length >= 1);

// ALB
const albs = findResources(t, 'AWS::ElasticLoadBalancingV2::LoadBalancer');
check('AWS::ElasticLoadBalancingV2::LoadBalancer (ALB) exists', albs.length >= 1);
if (albs.length >= 1) {
  const [, alb] = albs[0];
  check('ALB Scheme is internet-facing',
    alb.Properties?.Scheme === 'internet-facing',
    `Got: ${alb.Properties?.Scheme}`);
  check('ALB has security groups (references alb-sg)',
    alb.Properties?.SecurityGroups && alb.Properties.SecurityGroups.length > 0);
}

// Target groups
const tgs = findResources(t, 'AWS::ElasticLoadBalancingV2::TargetGroup');
check('At least 1 target group exists', tgs.length >= 1);
check('Target group on port 3000 (BFF) exists',
  tgs.some(([, tg]) => tg.Properties?.Port === 3000));
check('Target group uses target type "ip"',
  tgs.some(([, tg]) => tg.Properties?.TargetType === 'ip'));

// ALB Listener
const listeners = findResources(t, 'AWS::ElasticLoadBalancingV2::Listener');
check('ALB Listener exists', listeners.length >= 1);
if (listeners.length >= 1) {
  const [, listener] = listeners[0];
  check('ALB Listener on port 80',
    listener.Properties?.Port === 80,
    `Got port: ${listener.Properties?.Port}`);
  check('ALB Listener default action forwards to target group',
    listener.Properties?.DefaultActions &&
    listener.Properties.DefaultActions.some(a => a.Type === 'forward' && a.TargetGroupArn));
}

// ── Security Groups ──────────────────────────────────────────────────────────

const allSgs = findResources(t, 'AWS::EC2::SecurityGroup');
check('At least 4 security groups', allSgs.length >= 4,
  `Found ${allSgs.length}`);

const albSg = findSG(allSgs, 'alb');
check('Security Group "alb-sg" exists', !!albSg);
if (albSg) {
  const [, sg] = albSg;
  const ingress = sg.Properties?.SecurityGroupIngress || [];
  check('alb-sg: TCP port 80 from 0.0.0.0/0',
    ingress.some(r => r.IpProtocol === 'tcp' && r.FromPort === 80 && r.ToPort === 80 && r.CidrIp === '0.0.0.0/0'),
    `Ingress: ${JSON.stringify(ingress)}`);
}

const bffSg = findSG(allSgs, 'bff');
check('Security Group "bff-sg" exists', !!bffSg);
if (bffSg) {
  const [, sg] = bffSg;
  const ingress = sg.Properties?.SecurityGroupIngress || [];
  check('bff-sg: TCP port 3000 from alb-sg',
    ingress.some(r => r.IpProtocol === 'tcp' && r.FromPort === 3000 && r.ToPort === 3000 && r.SourceSecurityGroupId),
    `Ingress: ${JSON.stringify(ingress)}`);
  const egress = sg.Properties?.SecurityGroupEgress || [];
  check('bff-sg: all outbound traffic allowed',
    egress.some(r => r.CidrIp === '0.0.0.0/0'),
    `Egress: ${JSON.stringify(egress)}`);
}

const sseSg = findSG(allSgs, 'sse');
check('Security Group "sse-server-sg" exists', !!sseSg);
if (sseSg) {
  const [, sg] = sseSg;
  const ingress = sg.Properties?.SecurityGroupIngress || [];
  check('sse-server-sg: TCP port 3002 from bff-sg',
    ingress.some(r => r.IpProtocol === 'tcp' && r.FromPort === 3002 && r.ToPort === 3002 && r.SourceSecurityGroupId),
    `Ingress: ${JSON.stringify(ingress)}`);
}

const authSg = findSG(allSgs, 'auth');
check('Security Group "auth-service-sg" exists', !!authSg);
if (authSg) {
  const [, sg] = authSg;
  const ingress = sg.Properties?.SecurityGroupIngress || [];
  check('auth-service-sg: TCP port 3001 from bff-sg',
    ingress.some(r => r.IpProtocol === 'tcp' && r.FromPort === 3001 && r.ToPort === 3001 && r.SourceSecurityGroupId),
    `Ingress: ${JSON.stringify(ingress)}`);
}

// ── IAM ──────────────────────────────────────────────────────────────────────

const roles = findResources(t, 'AWS::IAM::Role');
check('At least 1 IAM role exists', roles.length >= 1);
const ecsRole = roles.find(([n]) =>
  n.toLowerCase().includes('ecs') || n.toLowerCase().includes('execution'));
check('IAM role "ecs-task-execution" exists', !!ecsRole);
if (ecsRole) {
  const [, role] = ecsRole;
  const statements = role.Properties?.AssumeRolePolicyDocument?.Statement || [];
  check('ecs-task-execution: AssumeRole for ecs-tasks.amazonaws.com',
    statements.some(s => s.Principal?.Service === 'ecs-tasks.amazonaws.com'),
    `Statements: ${JSON.stringify(statements)}`);
}

const policies = findResources(t, 'AWS::IAM::Policy');
check('At least 1 IAM policy exists', policies.length >= 1);

// Find managed policies
const managedPolicies = findResources(t, 'AWS::IAM::ManagedPolicy');
// Use policy or managed policy for ECS
const ecsPolicy = policies.find(([n]) => n.toLowerCase().includes('ecs'));
const ecsManagedPolicy = managedPolicies.find(([n]) => n.toLowerCase().includes('ecs'));
if (ecsPolicy || ecsManagedPolicy) {
  const [, policy] = ecsPolicy || ecsManagedPolicy;
  const statements = (policy.Properties?.PolicyDocument?.Statement || []);
  const actions = statements.flatMap(s => {
    if (Array.isArray(s.Action)) return s.Action;
    if (typeof s.Action === 'string') return [s.Action];
    return [];
  });
  check('ECS policy includes ecr:GetDownloadUrlForLayer or ecr:BatchGetImage',
    actions.some(a => a.includes('GetDownloadUrlForLayer') || a.includes('BatchGetImage') || a.includes('ecr:*')),
    `Actions: ${JSON.stringify(actions.slice(0, 10))}`);
  check('ECS policy includes logs:CreateLogStream or logs:PutLogEvents',
    actions.some(a => a.includes('CreateLogStream') || a.includes('PutLogEvents') || a.includes('logs:*')),
    `Actions: ${JSON.stringify(actions.slice(0, 10))}`);
  check('ECS policy includes ssm:GetParameters',
    actions.some(a => a.includes('GetParameters') || a.includes('ssm:*')),
    `Actions: ${JSON.stringify(actions.slice(0, 10))}`);
}

// ── Outputs ──────────────────────────────────────────────────────────────────

const outs = t.Outputs || {};
const requiredOutputs = [
  'VpcId', 'PublicSubnetIds', 'PrivateSubnetIds',
  'AlbDnsName', 'AlbTargetGroupArn', 'SecurityGroupIds'
];
for (const outName of requiredOutputs) {
  check(`Output "${outName}" exists`, outName in outs,
    `Available: ${Object.keys(outs).join(', ')}`);
}

for (const outName of Object.keys(outs)) {
  check(`Output "${outName}" has a Value`, !!outs[outName].Value);
  check(`Output "${outName}" has a Description`,
    !!outs[outName].Description,
    `Best practice: all outputs should have a Description`);
}

// ── Security: No hardcoded account IDs ───────────────────────────────────────

const raw = JSON.stringify(t);
const accountIdMatches = raw.match(/\b(\d{12})\b/g) || [];
const filtered = accountIdMatches.filter(m => m !== '000000000000');
check('No hardcoded AWS account IDs (use AWS::AccountId)',
  filtered.length === 0,
  `Found potential hardcoded IDs: ${filtered.join(', ')}`);

// ── Summary ───────────────────────────────────────────────────────────────────

printSummary();
process.exit(failCount > 0 ? 1 : 0);
