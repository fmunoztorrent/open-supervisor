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
    findByCorrelationId: jest.fn(),
    findPendingByStore: jest.fn().mockResolvedValue(pending),
    findResolvedByStore: jest.fn().mockResolvedValue([]),
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

  // ─── FASE RED: Historial de autorizaciones (US-01, US-02) ──────────────────

  describe('GET /authorization/store/:storeId/history — historial de autorizaciones', () => {
    it('devuelve solicitudes resueltas para una tienda (sin filtros)', async () => {
      const resolved = [
        makeResolvedRequest(AuthorizationStatus.APPROVED),
        makeResolvedRequest(AuthorizationStatus.REJECTED),
      ];
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue(resolved);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      // Los campos snake_case deben estar presentes
      expect(response.body[0]).toHaveProperty('store_id');
      expect(response.body[0]).toHaveProperty('status');
      expect(response.body[0]).toHaveProperty('resolved_by');
      expect(response.body[0]).toHaveProperty('resolved_at');
      expect(mockRepository.findResolvedByStore).toHaveBeenCalledWith(
        'store-001',
        undefined,
        undefined,
      );
    });

    // FASE RED — este test DEBE FALLAR porque:
    // 1. El controller no tiene @Query('supervisorId')
    // 2. El controller no pasa supervisorId al repositorio
    // 3. El port findResolvedByStore no acepta supervisorId como parámetro
    it('filtra por supervisorId cuando se envía el query param (FASE RED — DEBE FALLAR)', async () => {
      const resolved = [makeResolvedRequest(AuthorizationStatus.APPROVED)];
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue(resolved);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history?supervisorId=supervisor-A',
      );

      // La respuesta HTTP en sí misma debería ser 200 OK (el mock retorna datos)
      // pero lo que fallará es la aserción de que supervisorId se pasó al repositorio
      expect(response.status).toBe(HttpStatus.OK);
      // ← ESTA ASERCIÓN ES LA QUE FALLA: el controller actual no pasa supervisorId
      expect(mockRepository.findResolvedByStore).toHaveBeenCalledWith(
        'store-001',
        undefined,
        'supervisor-A',
      );
    });

    it('retorna lista vacía cuando supervisorId no tiene solicitudes (200 OK)', async () => {
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue([]);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history?supervisorId=supervisor-C',
      );

      // El endpoint debe retornar 200 con array vacío, no 404
      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toEqual([]);
    });

    it('combina filtros supervisorId + status (AND logic)', async () => {
      const resolved = [
        makeResolvedRequest(AuthorizationStatus.APPROVED),
      ];
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue(resolved);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history?supervisorId=supervisor-A&status=APPROVED',
      );

      expect(response.status).toBe(HttpStatus.OK);
      // ← FALLA: el controller actual no pasa supervisorId al repositorio
      expect(mockRepository.findResolvedByStore).toHaveBeenCalledWith(
        'store-001',
        AuthorizationStatus.APPROVED,
        'supervisor-A',
      );
    });

    it('retorna 400 Bad Request cuando status es inválido', async () => {
      await setupApp(jest.fn().mockResolvedValue(undefined));

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history?status=INVALID_STATUS',
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('ignora supervisorId vacío (string vacía → sin filtro)', async () => {
      const resolved = [
        makeResolvedRequest(AuthorizationStatus.APPROVED),
        makeResolvedRequest(AuthorizationStatus.REJECTED),
      ];
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue(resolved);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history?supervisorId=',
      );

      expect(response.status).toBe(HttpStatus.OK);
      // supervisorId vacío debe ignorarse: se llama sin el tercer parámetro
      // o con undefined, no con string vacía
      expect(response.body).toHaveLength(2);
    });

    // FASE RED — verifica que los campos opcionales (product_id, original_price, etc.)
    // aparecen en la respuesta del historial cuando existen
    it('incluye campos opcionales de PRICE_CHANGE en la respuesta del historial', async () => {
      const priceChangeRequest = AuthorizationRequest.fromDto({
        store_id: 'store-001',
        pos_id: 'pos-01',
        correlation_id: 'corr-price',
        type: RequestType.PRICE_CHANGE,
        product_id: 'prod-99',
        original_price: 1000,
        requested_price: 600,
        created_at: new Date().toISOString(),
      });
      priceChangeRequest.approve('sup-001');

      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue([priceChangeRequest]);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body[0]).toHaveProperty('product_id', 'prod-99');
      expect(response.body[0]).toHaveProperty('original_price', 1000);
      expect(response.body[0]).toHaveProperty('requested_price', 600);
    });

    it('mantiene compatibilidad hacia atrás: sin supervisorId retorna todas las resueltas', async () => {
      const reqA = AuthorizationRequest.fromDto({
        store_id: 'store-001',
        pos_id: 'pos-01',
        correlation_id: 'corr-a',
        type: RequestType.DISCOUNT,
        created_at: new Date().toISOString(),
      });
      reqA.approve('supervisor-A');

      const reqB = AuthorizationRequest.fromDto({
        store_id: 'store-001',
        pos_id: 'pos-01',
        correlation_id: 'corr-b',
        type: RequestType.CANCEL,
        created_at: new Date().toISOString(),
      });
      reqB.reject('supervisor-B');

      const allResolved = [reqA, reqB];
      await setupApp(jest.fn().mockResolvedValue(undefined));
      mockRepository.findResolvedByStore = jest.fn().mockResolvedValue(allResolved);

      const response = await request(app.getHttpServer()).get(
        '/authorization/store/store-001/history',
      );

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toHaveLength(2);
      // Debe incluir solicitudes de ambos supervisores
      const resolvedBys = response.body.map((item: any) => item.resolved_by);
      expect(resolvedBys).toContain('supervisor-A');
      expect(resolvedBys).toContain('supervisor-B');
    });
  });
});
