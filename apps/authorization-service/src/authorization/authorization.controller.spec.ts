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
  return AuthorizationRequest.fromDto(dto);
}

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockResolveUseCase: { execute: jest.Mock };
let mockRepository: jest.Mocked<IAuthorizationRepository>;
let app: INestApplication;

async function setupApp(resolveExecute: jest.Mock) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AuthorizationController],
    providers: [
      {
        provide: ResolveAuthorizationUseCase,
        useValue: { execute: resolveExecute },
      },
      {
        provide: AUTHORIZATION_REPOSITORY,
        useValue: {
          save: jest.fn(),
          findById: jest.fn(),
      findByCorrelationId: jest.fn(),
          findPendingByStore: jest.fn().mockResolvedValue([]),
        },
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
  });
});
