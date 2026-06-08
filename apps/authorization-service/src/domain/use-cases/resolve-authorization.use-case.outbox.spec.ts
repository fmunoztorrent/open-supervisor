import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { IAuthorizationRepository } from '../ports/authorization-repository.port';
import { IOutboxRepository, OutboxEntry } from '../ports/outbox-repository.port';
import { IUnitOfWork, UnitOfWorkContext } from '../ports/unit-of-work.port';
import { ResolveAuthorizationUseCase } from './resolve-authorization.use-case';
import { AuthorizationRequest } from '../entities/authorization-request.entity';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeRequestEntity(type: RequestType, overrides: Partial<AuthorizationRequestDto> = {}): AuthorizationRequest {
  const dto: AuthorizationRequestDto = {
    store_id: 'store-42',
    pos_id: 'pos-01',
    correlation_id: 'corr-abc',
    type,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  return AuthorizationRequest.fromDto(dto);
}

function makeOutboxEntryFromRequest(entity: AuthorizationRequest): OutboxEntry {
  return {
    id: `outbox-${entity.id}`,
    correlationId: entity.correlationId,
    topic: `auth.response.${entity.storeId}`,
    payload: expect.objectContaining({
      correlation_id: entity.correlationId,
      status: entity.status,
    }) as unknown,
    status: 'PENDING',
    attempts: 0,
    createdAt: new Date(),
    publishedAt: null,
    lastError: null,
  };
}

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockAuthRepo: jest.Mocked<IAuthorizationRepository>;
let mockOutboxRepo: jest.Mocked<IOutboxRepository>;
let mockUnitOfWork: jest.Mocked<IUnitOfWork>;
let useCase: ResolveAuthorizationUseCase;
let txCtx: UnitOfWorkContext;

beforeEach(() => {
  mockAuthRepo = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByCorrelationId: jest.fn(),
    findPendingByStore: jest.fn(),
    findResolvedByStore: jest.fn(),
  };
  mockOutboxRepo = {
    save: jest.fn().mockResolvedValue(undefined),
    findPending: jest.fn(),
    markPublished: jest.fn(),
    incrementAttempts: jest.fn(),
    getStats: jest.fn(),
  };
  txCtx = {
    authorizationRepository: mockAuthRepo,
    outboxRepository: mockOutboxRepo,
  };
  mockUnitOfWork = {
    transaction: jest.fn().mockImplementation(async (work) => work(txCtx)),
  };

  // El use-case toma el IUnitOfWork, NO el publisher directo
  useCase = new ResolveAuthorizationUseCase(mockUnitOfWork);
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('ResolveAuthorizationUseCase con outbox (US-01)', () => {
  describe('Persistencia + encolado en una sola TX', () => {
    it('ejecuta la resolución dentro de uow.transaction()', async () => {
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockUnitOfWork.transaction).toHaveBeenCalledTimes(1);
    });

    it('la TX persiste la request y encola el outbox entry con shape AuthorizationResponseDto', async () => {
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockAuthRepo.save).toHaveBeenCalledTimes(1);
      expect(mockOutboxRepo.save).toHaveBeenCalledTimes(1);
      const outboxEntry = (mockOutboxRepo.save as jest.Mock).mock.calls[0][0] as OutboxEntry;
      expect(outboxEntry.topic).toBe(`auth.response.${entity.storeId}`);
      expect(outboxEntry.status).toBe('PENDING');
      expect(outboxEntry.correlationId).toBe(entity.correlationId);
      expect(outboxEntry.payload).toEqual(
        expect.objectContaining({
          store_id: entity.storeId,
          pos_id: entity.posId,
          correlation_id: entity.correlationId,
          status: AuthorizationStatus.APPROVED,
          resolved_by: 'sup-01',
          type: RequestType.DISCOUNT,
        }),
      );
    });

    it('el payload del outbox es snake_case (1:1 con AuthorizationResponseDto)', async () => {
      const entity = makeRequestEntity(RequestType.PRICE_CHANGE, {
        product_id: 'prod-xyz',
        original_price: 1000,
        requested_price: 700,
      });
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      const outboxEntry = (mockOutboxRepo.save as jest.Mock).mock.calls[0][0] as OutboxEntry;
      const payload = outboxEntry.payload as Record<string, unknown>;
      expect(payload).toHaveProperty('store_id');
      expect(payload).toHaveProperty('pos_id');
      expect(payload).toHaveProperty('correlation_id');
      expect(payload).toHaveProperty('resolved_by');
      expect(payload).toHaveProperty('resolved_at');
      expect(payload).toHaveProperty('type');
      expect(payload).not.toHaveProperty('storeId');
      expect(payload).not.toHaveProperty('correlationId');
    });
  });

  describe('Aislamiento: el use-case NO llama publisher.publish() directamente', () => {
    it('el constructor del use-case NO acepta un IMessagePublisher', () => {
      // El use-case debe depender SOLO del IUnitOfWork
      const useCaseParams = useCase as unknown as Record<string, unknown>;
      // No debe haber un publisher en las props del use-case
      expect(useCaseParams).not.toHaveProperty('publisher');
    });

    it('el constructor acepta solo el IUnitOfWork', () => {
      // Verificar firma: 1 parámetro obligatorio (uow)
      expect(ResolveAuthorizationUseCase.length).toBe(1);
    });
  });

  describe('Atomicidad: si outbox.save() falla, la TX rollbackea (la request no queda persistida)', () => {
    it('cuando outbox.save lanza, el error se propaga al controller (que retornará 500)', async () => {
      // Arrange
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);
      const outboxError = new Error('Outbox constraint violation');
      mockOutboxRepo.save.mockRejectedValue(outboxError);

      // Act + Assert
      // En la realidad, la TX hace rollback automático. Aquí el mock simula que
      // el UoW no commitea (porque la work function lanzó).
      await expect(useCase.execute(entity.correlationId, 'APPROVE', 'sup-01')).rejects.toThrow('Outbox constraint violation');
    });

    it('cuando auth.save lanza, outbox.save NO se llama', async () => {
      // Arrange
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);
      mockAuthRepo.save.mockRejectedValue(new Error('Auth save failed'));

      // Act + Assert
      await expect(useCase.execute(entity.correlationId, 'APPROVE', 'sup-01')).rejects.toThrow('Auth save failed');
      expect(mockOutboxRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Idempotencia — ya resuelto', () => {
    it('lanza error si la solicitud ya está APPROVED', async () => {
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      entity.approve('other-sup'); // ya no está PENDING
      mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);

      await expect(useCase.execute(entity.correlationId, 'APPROVE', 'sup-01')).rejects.toThrow();
      expect(mockOutboxRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Payload del outbox según tipo de decisión', () => {
    it.each([
      [RequestType.DISCOUNT, 'APPROVE', AuthorizationStatus.APPROVED],
      [RequestType.DISCOUNT, 'REJECT', AuthorizationStatus.REJECTED],
      [RequestType.CANCEL, 'APPROVE', AuthorizationStatus.APPROVED],
      [RequestType.SUSPEND, 'REJECT', AuthorizationStatus.REJECTED],
      [RequestType.PRICE_CHANGE, 'APPROVE', AuthorizationStatus.APPROVED],
      [RequestType.EMPLOYEE_BENEFIT, 'APPROVE', AuthorizationStatus.APPROVED],
    ])(
      'incluye el status %s cuando la decisión es %s en type %s',
      async (type, decision, expectedStatus) => {
        const entity = makeRequestEntity(type as RequestType);
        mockAuthRepo.findByCorrelationId.mockResolvedValue(entity);

        await useCase.execute(entity.correlationId, decision as 'APPROVE' | 'REJECT', 'sup-01');

        const outboxEntry = (mockOutboxRepo.save as jest.Mock).mock.calls[0][0] as OutboxEntry;
        expect(outboxEntry.payload).toEqual(
          expect.objectContaining({
            type: type as RequestType,
            status: expectedStatus,
          }),
        );
      },
    );
  });
});
