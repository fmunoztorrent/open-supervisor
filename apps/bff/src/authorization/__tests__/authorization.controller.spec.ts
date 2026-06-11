import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, Logger } from '@nestjs/common';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Observable, of, throwError } from 'rxjs';
import { AuthorizationController } from '../authorization.controller';
import { AuthorizationService } from '../authorization.service';

// Suppress NestJS Logger output during tests — intentional error
// status codes (404, 409, 500, 400) from the upstream auth-service
// produce ERROR logs that look misleading in CI output.
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

function mockHttpPost(status: number, body: unknown = {}) {
  if (status >= 200 && status < 300) {
    return of({ data: body, status });
  }
  return throwError(() => ({ response: { status, data: body } }));
}

function mockHttpGet(body: unknown = {}) {
  return of({ data: body, status: 200 });
}

interface MockHttpService {
  get: jest.Mock;
  post: jest.Mock;
}

async function setupApp(
  postObs?: Observable<unknown>,
  getObs?: Observable<unknown>,
): Promise<{ app: INestApplication; httpMock: MockHttpService }> {
  const httpMock: MockHttpService = {
    get: jest.fn().mockReturnValue(getObs ?? mockHttpGet({})),
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
  return { app, httpMock };
}

afterEach(async () => {
  // Logger mocks are restored in afterAll; only clean up app-level mocks here
});

describe('AuthorizationController (BFF)', () => {
  describe('POST /authorization/:id/resolve — propagación de errores HTTP', () => {
    it('propaga 404 cuando auth-service responde con 404', async () => {
      const { app } = await setupApp(mockHttpPost(404, { message: 'Not found' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-999/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
      await app.close();
    });

    it('propaga 409 cuando auth-service responde con 409', async () => {
      const { app } = await setupApp(mockHttpPost(409, { message: 'Already resolved' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CONFLICT);
      await app.close();
    });

    it('retorna 500 cuando auth-service responde con 500', async () => {
      const { app } = await setupApp(mockHttpPost(500, { message: 'Internal error' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-002/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      await app.close();
    });

    it('retorna 201 cuando la resolución es exitosa', async () => {
      const { app } = await setupApp(mockHttpPost(201, { id: 'req-001', status: 'APPROVED' }));

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CREATED);
      await app.close();
    });
  });

  // ─── FASE RED: Historial de autorizaciones (US-01) ─────────────────────────

  describe('GET /authorization/requests/history — propagación de filtros', () => {
    it('propaga storeId al authorization-service upstream', async () => {
      const mockHistory = [
        {
          store_id: 'store-42',
          pos_id: 'pos-1',
          correlation_id: 'corr-1',
          type: 'DISCOUNT',
          status: 'APPROVED',
          resolved_by: 'sup-1',
          created_at: '2026-06-10T10:00:00.000Z',
        },
      ];
      const { app, httpMock } = await setupApp(undefined, mockHttpGet(mockHistory));

      const response = await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(httpMock.get).toHaveBeenCalledWith(
        expect.stringContaining('/authorization/store/store-42/history'),
      );
      await app.close();
    });

    it('propaga status filter al authorization-service upstream', async () => {
      const { app, httpMock } = await setupApp(undefined, mockHttpGet([]));

      await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42&status=APPROVED',
      );

      expect(httpMock.get).toHaveBeenCalledWith(
        expect.stringContaining('status=APPROVED'),
      );
      await app.close();
    });

    // FASE RED — este test DEBE FALLAR porque el BFF controller no acepta
    // supervisorId como query param ni lo propaga al auth-service.
    it('propaga supervisorId al authorization-service upstream (FASE RED — DEBE FALLAR)', async () => {
      const { app, httpMock } = await setupApp(undefined, mockHttpGet([]));

      await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42&supervisorId=supervisor-A',
      );

      // ← ESTA ASERCIÓN ES LA QUE FALLA:
      // El BFF actual no incluye supervisorId en la URL upstream
      expect(httpMock.get).toHaveBeenCalledWith(
        expect.stringContaining('supervisorId=supervisor-A'),
      );
      await app.close();
    });

    // FASE RED — combinación de supervisorId + status
    it('propaga supervisorId y status combinados al upstream (FASE RED — DEBE FALLAR)', async () => {
      const { app, httpMock } = await setupApp(undefined, mockHttpGet([]));

      await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42&supervisorId=supervisor-A&status=APPROVED',
      );

      // ← FALLA: supervisorId no se propaga
      expect(httpMock.get).toHaveBeenCalledWith(
        expect.stringContaining('supervisorId=supervisor-A'),
      );
      expect(httpMock.get).toHaveBeenCalledWith(
        expect.stringContaining('status=APPROVED'),
      );
      await app.close();
    });

    it('retorna los datos del upstream sin modificar', async () => {
      const mockHistory = [
        {
          store_id: 'store-42',
          pos_id: 'pos-1',
          correlation_id: 'corr-1',
          type: 'DISCOUNT',
          status: 'APPROVED',
          resolved_by: 'sup-1',
          created_at: '2026-06-10T10:00:00.000Z',
        },
      ];
      const { app } = await setupApp(undefined, mockHttpGet(mockHistory));

      const response = await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual(mockHistory);
      await app.close();
    });

    it('propaga errores HTTP 400 desde auth-service (status inválido)', async () => {
      const errorObs = throwError(() => ({ response: { status: 400, data: { message: 'Invalid status' } } }));
      const { app } = await setupApp(undefined, errorObs);

      const response = await request(app.getHttpServer()).get(
        '/authorization/requests/history?storeId=store-42&status=INVALID',
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      await app.close();
    });
  });
});
