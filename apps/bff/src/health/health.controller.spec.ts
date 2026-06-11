import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { HealthModule } from './health.module';

describe('HealthController — bff', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('returns HTTP 200 with status: "ok"', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('returns service name "bff"', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.body).toHaveProperty('service', 'bff');
    });

    it('returns timestamp as ISO 8601 string', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.body).toHaveProperty('timestamp');
      expect(typeof response.body.timestamp).toBe('string');
      const parsed = new Date(response.body.timestamp);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });

    it('responds quickly (<50ms)', async () => {
      const start = Date.now();
      await request(app.getHttpServer()).get('/health');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });
});
