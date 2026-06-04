import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';
import { IAuthorizationRepository } from '../ports/authorization-repository.port';
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

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockRepository: jest.Mocked<IAuthorizationRepository>;
let mockPublisher: jest.Mocked<IMessagePublisher>;
let useCase: ResolveAuthorizationUseCase;

beforeEach(() => {
  mockRepository = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
      findByCorrelationId: jest.fn(),
    findPendingByStore: jest.fn(),
  };
  mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) };

  useCase = new ResolveAuthorizationUseCase(mockRepository, mockPublisher);
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('ResolveAuthorizationUseCase', () => {
  describe('Resolución de DISCOUNT — flujo base (no regresión)', () => {
    it('publica en Kafka con status APPROVED cuando decision es APPROVE', async () => {
      const entity = makeRequestEntity(RequestType.DISCOUNT);
      mockRepository.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `auth.response.${entity.storeId}`,
        expect.objectContaining({
          status: AuthorizationStatus.APPROVED,
          correlation_id: entity.correlationId,
        }),
      );
    });

    it('lanza NotFoundException cuando la solicitud no existe', async () => {
      mockRepository.findByCorrelationId.mockResolvedValue(null);

      await expect(useCase.execute('not-found-corr-id', 'APPROVE', 'sup-01')).rejects.toThrow();
    });
  });

  describe('PRICE_CHANGE — el payload Kafka incluye type: PRICE_CHANGE', () => {
    it('incluye type: PRICE_CHANGE en el payload publicado cuando se aprueba', async () => {
      const entity = makeRequestEntity(RequestType.PRICE_CHANGE, {
        product_id: 'prod-xyz',
        original_price: 1000,
        requested_price: 700,
      });
      mockRepository.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `auth.response.${entity.storeId}`,
        expect.objectContaining({
          type: RequestType.PRICE_CHANGE,
          status: AuthorizationStatus.APPROVED,
          correlation_id: entity.correlationId,
        }),
      );
    });

    it('incluye type: PRICE_CHANGE en el payload publicado cuando se rechaza', async () => {
      const entity = makeRequestEntity(RequestType.PRICE_CHANGE, {
        product_id: 'prod-xyz',
        original_price: 1000,
        requested_price: 700,
      });
      mockRepository.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'REJECT', 'sup-01');

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `auth.response.${entity.storeId}`,
        expect.objectContaining({
          type: RequestType.PRICE_CHANGE,
          status: AuthorizationStatus.REJECTED,
        }),
      );
    });
  });

  describe('Otros tipos — el payload Kafka también incluye el type correspondiente', () => {
    it.each([
      [RequestType.DISCOUNT],
      [RequestType.CANCEL],
      [RequestType.SUSPEND],
    ])('incluye type: %s en el payload cuando se resuelve', async (type) => {
      const entity = makeRequestEntity(type);
      mockRepository.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type }),
      );
    });
  });

  describe('Persistencia — la solicitud queda guardada con resolved_at', () => {
    it('llama a repository.save después de resolver la solicitud', async () => {
      const entity = makeRequestEntity(RequestType.PRICE_CHANGE, {
        product_id: 'prod-1',
        original_price: 1000,
        requested_price: 700,
      });
      mockRepository.findByCorrelationId.mockResolvedValue(entity);

      await useCase.execute(entity.correlationId, 'APPROVE', 'sup-01');

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      const saved = (mockRepository.save as jest.Mock).mock.calls[0][0] as AuthorizationRequest;
      expect(saved.resolvedAt).toBeDefined();
    });
  });
});
