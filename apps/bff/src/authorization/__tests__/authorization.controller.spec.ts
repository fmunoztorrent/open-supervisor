import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Observable, of, throwError } from 'rxjs';
import { AuthorizationController } from '../authorization.controller';
import { AuthorizationService } from '../authorization.service';

function mockHttpPost(status: number, body: unknown = {}) {
  if (status >= 200 && status < 300) {
    return of({ data: body, status });
  }
  return throwError(() => ({ response: { status, data: body } }));
}

async function setupApp(postObs?: Observable<unknown>): Promise<INestApplication> {
  const httpMock = {
    get: jest.fn().mockReturnValue(of({ data: {} })),
    post: jest.fn().mockReturnValue(postObs ?? of({ data: {} })),
  };

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
      {
        provide: HttpService,
        useValue: httpMock,
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

describe('AuthorizationController (BFF)', () => {
  describe('POST /authorization/:id/resolve — propagación de errores HTTP', () => {
    it('propaga 404 cuando auth-service responde con 404', async () => {
      const app = await setupApp(mockHttpPost(404, { message: 'Not found' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-999/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      await app.close();
    });

    it('propaga 409 cuando auth-service responde con 409', async () => {
      const app = await setupApp(mockHttpPost(409, { message: 'Already resolved' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CONFLICT);
      await app.close();
    });

    it('retorna 500 cuando auth-service responde con 500', async () => {
      const app = await setupApp(mockHttpPost(500, { message: 'Internal error' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-002/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      await app.close();
    });

    it('retorna 201 cuando la resolución es exitosa', async () => {
      const app = await setupApp(mockHttpPost(201, { id: 'req-001', status: 'APPROVED' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CREATED);
      await app.close();
    });
  });
});
