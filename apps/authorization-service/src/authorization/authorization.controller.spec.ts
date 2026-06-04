import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthorizationController } from './authorization.controller';
import { ResolveAuthorizationUseCase } from '../domain/use-cases/resolve-authorization.use-case';
import { AUTHORIZATION_REPOSITORY, IAuthorizationRepository } from '../domain/ports/authorization-repository.port';
import { AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { AuthorizationRequest } from '../domain/entities/authorization-request.entity';
import { NotFoundException } from '@nestjs/common';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeResolvedRequest(status: AuthorizationStatus): AuthorizationRequest {
  const dto = {
    store_id: 'store-001',
    pos_id: 'pos-01',
    correlation_id: 'corr-xyz',
    type: RequestType.DISCOUNT,
    created_at: new Date().toISOString(),
  };
  const req = AuthorizationRequest.fromDto(dto);
  if (status === AuthorizationStatus.APPROVED) {
    req.approve('sup-001');
  } else if (status === AuthorizationStatus.REJECTED) {
    req.reject('sup-001');
  }
  return req;
}

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockResolveUseCase: { execute: jest.Mock };
let mockRepository: jest.Mocked<IAuthorizationRepository>;
let app: INestApplication;

function makeRepository(
  pending: AuthorizationRequest[] = [],
): jest.Mocked<IAuthorizationRepository> {
  return {
    save: jest.fn(),
    findById: jest.fn(),
    findPendingByStore: jest.fn().mockResolvedValue(pending),
  } as unknown as jest.Mocked<IAuthorizationRepository>;
}

async function setupApp(
  resolveExecute: jest.Mock,
  pending: AuthorizationRequest[] = [],
) {
  mockRepository = makeRepository(pending);
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AuthorizationController],
    providers: [
      {
        provide: ResolveAuthorizationUseCase,
        useValue: { execute: resolveExecute },
      },
      {
        provide: AUTHORIZATION_REPOSITORY,
        useValue: mockRepository,
      },
    ],
  }).compile();

  app = module.createNestApplication();
  await app.init();
}

afterEach(async () => {
  if (app) await app.close();
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('AuthorizationController', () => {
  describe('GET /authorization/store/:storeId/pending — contrato del DTO (snake_case)', () => {
    it('devuelve los campos del request con nombres snake_case según AuthorizationRequestDto', async () => {
      const dto = {
        store_id: 'store-001',
        pos_id: 'pos-01',
        correlation_id: 'corr-001',
        type: RequestType.DISCOUNT,
        created_at: new Date().toISOString(),
      };
      const pending = [AuthorizationRequest.fromDto(dto)];

      await setupApp(jest.fn().mockResolvedValue(undefined), pending);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/pending',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      const item = response.body[0];
      // Campos snake_case esperados por la app móvil y el DTO compartido
      expect(item).toHaveProperty('store_id', 'store-001');
      expect(item).toHaveProperty('pos_id', 'pos-01');
      expect(item).toHaveProperty('correlation_id', 'corr-001');
      expect(item).toHaveProperty('type', RequestType.DISCOUNT);
      expect(item).toHaveProperty('created_at');
      expect(typeof item.created_at).toBe('string');
      // NO debe haber camelCase en la respuesta (regresión tras último fix)
      expect(item).not.toHaveProperty('storeId');
      expect(item).not.toHaveProperty('posId');
      expect(item).not.toHaveProperty('correlationId');
      expect(item).not.toHaveProperty('createdAt');
    });

    it('devuelve created_at como string ISO 8601 listo para new Date() en el cliente', async () => {
      const createdAt = '2026-06-03T10:30:00.000Z';
      const dto = {
        store_id: 'store-001',
        pos_id: 'pos-01',
        correlation_id: 'corr-002',
        type: RequestType.CANCEL,
        created_at: createdAt,
      };
      const pending = [AuthorizationRequest.fromDto(dto)];

      await setupApp(jest.fn().mockResolvedValue(undefined), pending);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/pending',
      );

      expect(response.body[0].created_at).toBe(createdAt);
      // Verifica que el cliente puede parsear la fecha sin obtener NaN
      const parsed = new Date(response.body[0].created_at);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });

    it('devuelve array vacío (no null/undefined) cuando no hay solicitudes pendientes', async () => {
      await setupApp(jest.fn().mockResolvedValue(undefined), []);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-999/pending',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual([]);
    });
  });

  describe('POST /authorization/:id/resolve — mapeo de errores de dominio', () => {
    it('devuelve HTTP 409 cuando assertPending lanza Error("already APPROVED")', async () => {
      const resolveExecute = jest.fn().mockRejectedValue(
        new Error('Authorization req-001 is already APPROVED'),
      );
      await setupApp(resolveExecute);

      const response = await request(app.getHttpServer())
        .post('/authorization/req-001/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CONFLICT);
    });

    it('devuelve HTTP 409 cuando assertPending lanza Error("already REJECTED")', async () => {
      const resolveExecute = jest.fn().mockRejectedValue(
        new Error('Authorization req-002 is already REJECTED'),
      );
      await setupApp(resolveExecute);

      const response = await request(app.getHttpServer())
        .post('/authorization/req-002/resolve')
        .send({ decision: 'REJECT', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CONFLICT);
    });

    it('devuelve HTTP 404 cuando el use-case lanza NotFoundException', async () => {
      const resolveExecute = jest.fn().mockRejectedValue(
        new NotFoundException('Authorization req-999 not found'),
      );
      await setupApp(resolveExecute);

      const response = await request(app.getHttpServer())
        .post('/authorization/req-999/resolve')
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('devuelve HTTP 200 y el resultado cuando la resolución es exitosa', async () => {
      const fakeRequest = makeResolvedRequest(AuthorizationStatus.APPROVED);
      const resolveExecute = jest.fn().mockResolvedValue(fakeRequest);
      await setupApp(resolveExecute);

      const response = await request(app.getHttpServer())
        .post(`/authorization/${fakeRequest.id}/resolve`)
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CREATED);
    });

    it('responde con snake_case (resolved_by, resolved_at) consistente con AuthorizationResponseDto', async () => {
      const fakeRequest = makeResolvedRequest(AuthorizationStatus.APPROVED);
      const resolveExecute = jest.fn().mockResolvedValue(fakeRequest);
      await setupApp(resolveExecute);

      const response = await request(app.getHttpServer())
        .post(`/authorization/${fakeRequest.id}/resolve`)
        .send({ decision: 'APPROVE', supervisor_id: 'sup-01' });

      expect(response.status).toBe(HttpStatus.CREATED);
      // Campos snake_case esperados
      expect(response.body).toHaveProperty('correlation_id');
      expect(response.body).toHaveProperty('resolved_by');
      expect(response.body).toHaveProperty('resolved_at');
      expect(response.body).toHaveProperty('store_id');
      expect(response.body).toHaveProperty('pos_id');
      // NO debe haber camelCase en la respuesta
      expect(response.body).not.toHaveProperty('resolvedBy');
      expect(response.body).not.toHaveProperty('resolvedAt');
      expect(response.body).not.toHaveProperty('storeId');
      expect(response.body).not.toHaveProperty('posId');
      expect(response.body).not.toHaveProperty('correlationId');
    });
  });
});
