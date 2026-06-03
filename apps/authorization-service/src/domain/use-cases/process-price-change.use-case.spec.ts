import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { IMessagePublisher } from '@open-supervisor/shared-messaging';
import { IAuthorizationRepository } from '../ports/authorization-repository.port';
import { IEventEmitter } from '../ports/event-emitter.port';
import { ProcessPriceChangeUseCase } from './process-price-change.use-case';
import { MinimumPriceViolationError, InvalidPriceError } from '../services/price-change-classifier';

// ─── helper ──────────────────────────────────────────────────────────────────

function makePriceChangeDto(
  overrides: Partial<AuthorizationRequestDto> = {},
): AuthorizationRequestDto {
  return {
    store_id: 'store-42',
    pos_id: 'pos-01',
    correlation_id: 'corr-price-001',
    type: RequestType.PRICE_CHANGE,
    created_at: new Date().toISOString(),
    product_id: 'prod-999',
    original_price: 1000,
    requested_price: 600,
    ...overrides,
  };
}

// ─── mocks ───────────────────────────────────────────────────────────────────

let mockPublisher: jest.Mocked<IMessagePublisher>;
let mockRepository: jest.Mocked<IAuthorizationRepository>;
let mockEventEmitter: jest.Mocked<IEventEmitter>;
let useCase: ProcessPriceChangeUseCase;

beforeEach(() => {
  mockPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
  mockRepository = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findPendingByStore: jest.fn(),
  };
  mockEventEmitter = { emit: jest.fn().mockResolvedValue(undefined) };

  useCase = new ProcessPriceChangeUseCase(
    mockPublisher,
    mockRepository,
    mockEventEmitter,
  );
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('ProcessPriceChangeUseCase', () => {
  describe('Escenario EQUAL — precios iguales: auto-aprobación silenciosa', () => {
    it('publica APPROVED en Kafka con type PRICE_CHANGE', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 1000 });

      await useCase.execute(dto);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `auth.response.${dto.store_id}`,
        expect.objectContaining({
          correlation_id: dto.correlation_id,
          status: AuthorizationStatus.APPROVED,
          type: RequestType.PRICE_CHANGE,
        }),
      );
    });

    it('NO llama a repository.save cuando los precios son iguales', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 1000 });

      await useCase.execute(dto);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('NO emite evento SSE cuando los precios son iguales', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 1000 });

      await useCase.execute(dto);

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('Escenario WITHIN_LIMIT — diferencia ≤ 50 %: flujo normal de autorización', () => {
    it('llama a repository.save con una solicitud en estado PENDING', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 600 });

      await useCase.execute(dto);

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      const savedRequest = (mockRepository.save as jest.Mock).mock.calls[0][0];
      expect(savedRequest.status).toBe(AuthorizationStatus.PENDING);
    });

    it('la solicitud guardada contiene los campos de precio', async () => {
      const dto = makePriceChangeDto({
        original_price: 1000,
        requested_price: 600,
        product_id: 'prod-abc',
      });

      await useCase.execute(dto);

      const savedRequest = (mockRepository.save as jest.Mock).mock.calls[0][0];
      expect(savedRequest.originalPrice).toBe(1000);
      expect(savedRequest.requestedPrice).toBe(600);
      expect(savedRequest.productId).toBe('prod-abc');
    });

    it('emite al canal store:{store_id}:requests con los campos de precio para la app', async () => {
      const dto = makePriceChangeDto({
        original_price: 1000,
        requested_price: 600,
        product_id: 'prod-999',
        store_id: 'store-42',
        pos_id: 'pos-01',
        correlation_id: 'corr-price-001',
      });

      await useCase.execute(dto);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        `store:${dto.store_id}:requests`,
        expect.objectContaining({
          storeId: dto.store_id,
          posId: dto.pos_id,
          correlationId: dto.correlation_id,
          type: RequestType.PRICE_CHANGE,
          productId: dto.product_id,
          originalPrice: dto.original_price,
          requestedPrice: dto.requested_price,
          status: AuthorizationStatus.PENDING,
        }),
      );
    });

    it('NO publica respuesta Kafka cuando la diferencia está dentro del límite', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 600 });

      await useCase.execute(dto);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('Escenario EXCEEDS_LIMIT — diferencia > 50 %: rechazo inmediato + presencia física', () => {
    it('publica REJECTED en Kafka con type PRICE_CHANGE', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 400 });

      await useCase.execute(dto);

      expect(mockPublisher.publish).toHaveBeenCalledWith(
        `auth.response.${dto.store_id}`,
        expect.objectContaining({
          correlation_id: dto.correlation_id,
          status: AuthorizationStatus.REJECTED,
          type: RequestType.PRICE_CHANGE,
        }),
      );
    });

    it('emite al canal store:{store_id}:dispatches un PhysicalPresenceDispatchDto', async () => {
      const dto = makePriceChangeDto({
        original_price: 1000,
        requested_price: 400,
        product_id: 'prod-999',
        pos_id: 'pos-01',
        store_id: 'store-42',
        correlation_id: 'corr-dispatch',
      });

      await useCase.execute(dto);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        `store:${dto.store_id}:dispatches`,
        expect.objectContaining({
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          correlation_id: dto.correlation_id,
          product_id: dto.product_id,
          original_price: dto.original_price,
          requested_price: dto.requested_price,
        }),
      );
    });

    it('NO llama a repository.save cuando la diferencia excede el límite', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 400 });

      await useCase.execute(dto);

      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Propagación de errores de dominio — sin efectos secundarios', () => {
    it('propaga MinimumPriceViolationError sin llamar a publisher, repository ni eventEmitter', async () => {
      const dto = makePriceChangeDto({ original_price: 1000, requested_price: 149 });

      await expect(useCase.execute(dto)).rejects.toThrow(MinimumPriceViolationError);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('propaga InvalidPriceError sin llamar a publisher, repository ni eventEmitter', async () => {
      const dto = makePriceChangeDto({ original_price: 0, requested_price: 500 });

      await expect(useCase.execute(dto)).rejects.toThrow(InvalidPriceError);

      expect(mockPublisher.publish).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
