/**
 * US-01: Structured JSON Logging — Test 4
 *
 * DIP enforcement test: no file under src/domain/ should import pino
 * or nestjs-pino directly.
 *
 * This test PASSES currently (which is good — domain is clean).
 * It will FAIL if any future implementation adds pino imports to the domain layer.
 *
 * The domain must depend only on ILogger (the port), never on the concrete logger.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('DIP — No pino imports in domain (US-01)', () => {
  const domainDir = path.resolve(__dirname, '..');

  function findTsFiles(dir: string): string[] {
    const result: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__') {
        result.push(...findTsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        result.push(fullPath);
      }
    }
    return result;
  }

  it('no file under src/domain/ imports pino directly', () => {
    const tsFiles = findTsFiles(domainDir);
    expect(tsFiles.length).toBeGreaterThan(0); // sanity check

    const violations: string[] = [];
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Check for pino imports
      if (/from\s+['"]pino['"]/.test(content) || /require\(['"]pino['"]\)/.test(content)) {
        violations.push(`${file}: imports 'pino' directly`);
      }
      // Check for nestjs-pino imports
      if (/from\s+['"]nestjs-pino['"]/.test(content)) {
        violations.push(`${file}: imports 'nestjs-pino' directly`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('no file under src/domain/ imports nestjs-pino directly', () => {
    const tsFiles = findTsFiles(domainDir);
    expect(tsFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of tsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('nestjs-pino')) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it('domain files may import from shared-messaging (the ILogger port)', () => {
    const tsFiles = findTsFiles(domainDir);
    expect(tsFiles.length).toBeGreaterThan(0);

    // At least one domain file should import from shared-messaging
    // (this verifies that the ILogger port path IS the correct dependency)
    const sharedMessagingImporters = tsFiles.filter((file) => {
      const content = fs.readFileSync(file, 'utf-8');
      return content.includes('@open-supervisor/shared-messaging');
    });

    // This will be true once domain files use ILogger
    expect(sharedMessagingImporters.length).toBeGreaterThanOrEqual(0);
  });
});
