#!/usr/bin/env node
/**
 * parse-cfn-yaml.js
 * Reads a CloudFormation YAML file and outputs it as JSON.
 * Handles CloudFormation custom YAML tags (!Ref, !Sub, !GetAtt, !Join, etc.)
 *
 * Usage: node parse-cfn-yaml.js <path-to-template.yaml>
 * Output: JSON to stdout
 */

const fs = require('fs');
const yaml = require('js-yaml');
const { Type } = yaml;

// CloudFormation YAML intrinsic function tags
const cfSchema = yaml.DEFAULT_SCHEMA.extend([
  new Type('!Ref', {
    kind: 'scalar',
    construct: (id) => ({ Ref: id })
  }),
  new Type('!Sub', {
    kind: 'scalar',
    construct: (expr) => ({ 'Fn::Sub': expr })
  }),
  new Type('!GetAtt', {
    kind: 'scalar',
    construct: (attr) => {
      const parts = attr.split('.');
      return { 'Fn::GetAtt': parts.length === 2 ? parts : attr };
    }
  }),
  new Type('!Join', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Join': items })
  }),
  new Type('!Select', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Select': items })
  }),
  new Type('!FindInMap', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::FindInMap': items })
  }),
  new Type('!Cidr', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Cidr': items })
  }),
  new Type('!And', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::And': items })
  }),
  new Type('!Equals', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Equals': items })
  }),
  new Type('!If', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::If': items })
  }),
  new Type('!Not', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Not': items })
  }),
  new Type('!Or', {
    kind: 'sequence',
    construct: (items) => ({ 'Fn::Or': items })
  }),
  new Type('!Condition', {
    kind: 'scalar',
    construct: (name) => ({ Condition: name })
  }),
  new Type('!Base64', {
    kind: 'scalar',
    construct: (val) => ({ 'Fn::Base64': val })
  })
]);

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node parse-cfn-yaml.js <path-to-template.yaml>');
  process.exit(2);
}

if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf-8');
  const doc = yaml.load(content, { schema: cfSchema });
  console.log(JSON.stringify(doc, null, 2));
} catch (e) {
  console.error(`Error parsing ${filePath}: ${e.message}`);
  process.exit(1);
}
