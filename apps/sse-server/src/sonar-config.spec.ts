import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('SonarQube configuration — sse-server', () => {
  const projectRoot = resolve(__dirname, '..');

  describe('sonar-project.properties', () => {
    const propsPath = resolve(projectRoot, 'sonar-project.properties');

    it('should exist', () => {
      expect(existsSync(propsPath)).toBe(true);
    });

    it('should have correct projectKey', () => {
      const content = readFileSync(propsPath, 'utf-8');
      expect(content).toContain('sonar.projectKey=open-supervisor-sse-server');
    });

    it('should have sonar.sources=src', () => {
      const content = readFileSync(propsPath, 'utf-8');
      expect(content).toContain('sonar.sources=src');
    });

    it('should have sonar.tests=src', () => {
      const content = readFileSync(propsPath, 'utf-8');
      expect(content).toContain('sonar.tests=src');
    });

    it('should include test files but exclude from CPD', () => {
      const content = readFileSync(propsPath, 'utf-8');
      expect(content).toContain('sonar.test.inclusions=**/*.spec.ts');
      expect(content).toContain('sonar.cpd.exclusions=**/*.spec.ts');
    });

    it('should point to lcov report path', () => {
      const content = readFileSync(propsPath, 'utf-8');
      expect(content).toContain('sonar.javascript.lcov.reportPaths=src/coverage/lcov.info');
    });
  });

  describe('Jest config (package.json)', () => {
    const pkg = require(resolve(projectRoot, 'package.json'));

    it('should have coverageDirectory set to "coverage"', () => {
      expect(pkg.jest.coverageDirectory).toBe('coverage');
    });

    it('should have coverageReporters including lcov and text', () => {
      expect(pkg.jest.coverageReporters).toContain('lcov');
      expect(pkg.jest.coverageReporters).toContain('text');
    });
  });
});
