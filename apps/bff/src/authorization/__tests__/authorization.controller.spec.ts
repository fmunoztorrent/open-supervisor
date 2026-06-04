import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AuthorizationController } from '../authorization.controller';
import { AuthorizationService } from '../authorization.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// ─── setup ───────────────────────────────────────────────────────────────────

async function setupApp(): Promise<INestApplication> {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AuthorizationController],
    providers: [
      AuthorizationService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn().mockReturnValue('http://localhost:3001'),
        },
      },
    ],
  }).compile();

  const app = module.createNestApplication();
  await app.init();
  return app;
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('AuthorizationController (BFF)', () => {
  describe('POST /authorization/:id/resolve — propagación de errores HTTP', () => {
    it('propaga 404 cuando auth-service responde con 404 (anteriormente se convertía a 500)', async () => {
      mockFetch(404, { message: 'Not found' });
      const app = await setupApp();

      const response = await request(app.getHttpServer())
        .post('/authorization/req-999/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      await app.close();
    });

    it('propaga 409 cuando auth-service responde con 409 (anteriormente se convertía a 500)', async () => {
      mockFetch(409, { message: 'Already resolved' });
      const app = await setupApp();

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CONFLICT);
      await app.close();
    });

    it('retorna 500 cuando auth-service responde con 500', async () => {
      mockFetch(500, { message: 'Internal error' });
      const app = await setupApp();

      const response = await request(app.getHttpServer())
        .post('/authorization/req-002/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      await app.close();
    });

    it('retorna 201 cuando la resolución es exitosa', async () => {
      mockFetch(201, { id: 'req-001', status: 'APPROVED' });
      const app = await setupApp();

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CREATED);
      await app.close();
    });
  });
});
