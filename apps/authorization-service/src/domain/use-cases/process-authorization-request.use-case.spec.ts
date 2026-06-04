import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { IEventEmitter, EVENT_EMITTER } from '../ports/event-emitter.port';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../ports/authorization-repository.port';
import { IActiveDirectoryPort, ACTIVE_DIRECTORY } from '../ports/active-directory.port';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { ProcessAuthorizationRequestUseCase } from './process-authorization-request.use-case';
import { VerifyEmployeeBenefitUseCase } from './verify-employee-benefit.use-case';
import { ProcessPriceChangeUseCase } from './process-price-change.use-case';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDto(type: RequestType, overrides: Partial<AuthorizationRequestDto> = {}): AuthorizationRequestDto {
  return {
    store_id: 'store-001',
    pos_id: 'pos-01',
    correlation_id: 'corr-xyz',
    type,
    created_at: new Date().toISOString(),
    employee_id: type === RequestType.EMPLOYEE_BENEFIT ? '12345678-9' : undefined,
    ...overrides,
  };
}

// ─── mocks ──────────────────────────────────────────────────────────────────

let mockRepository: jest.Mocked<IAuthorizationRepository>;
let mockEventEmitter: jest.Mocked<IEventEmitter>;
let mockVerifyEmployeeBenefit: jest.Mocked<Pick<VerifyEmployeeBenefitUseCase, 'execute'>>;
let mockProcessPriceChange: jest.Mocked<Pick<ProcessPriceChangeUseCase, 'execute'>>;
let useCase: ProcessAuthorizationRequestUseCase;

beforeEach(() => {
  mockRepository = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByCorrelationId: jest.fn(),
    findPendingByStore: jest.fn(),
  };
  mockEventEmitter = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  mockVerifyEmployeeBenefit = {
    execute: jest.fn().mockResolvedValue(undefined),
  };
  mockProcessPriceChange = {
    execute: jest.fn().mockResolvedValue(undefined),
  };

  useCase = new ProcessAuthorizationRequestUseCase(
    mockRepository,
    mockEventEmitter,
    mockVerifyEmployeeBenefit as unknown as VerifyEmployeeBenefitUseCase,
    mockProcessPriceChange as unknown as ProcessPriceChangeUseCase,
  );
});

// ─── scenarios ──────────────────────────────────────────────────────────────

describe('ProcessAuthorizationRequestUseCase — dispatch por tipo', () => {
  describe('Cuando el tipo es EMPLOYEE_BENEFIT', () => {
    it('delega completamente en VerifyEmployeeBenefitUseCase', async () => {
      const dto = makeDto(RequestType.EMPLOYEE_BENEFIT);

      await useCase.execute(dto);

      expect(mockVerifyEmployeeBenefit.execute).toHaveBeenCalledWith(dto);
    });

    it('NO guarda en repositorio ni emite evento directamente', async () => {
      const dto = makeDto(RequestType.EMPLOYEE_BENEFIT);

      await useCase.execute(dto);

      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('Cuando el tipo es PRICE_CHANGE', () => {
    it('delega completamente en ProcessPriceChangeUseCase', async () => {
      const dto = makeDto(RequestType.PRICE_CHANGE, {
        product_id: 'prod-123',
        original_price: 1000,
        requested_price: 600,
      });

      await useCase.execute(dto);

      expect(mockProcessPriceChange.execute).toHaveBeenCalledWith(dto);
    });

    it('NO guarda en repositorio ni emite evento directamente', async () => {
      const dto = makeDto(RequestType.PRICE_CHANGE, {
        product_id: 'prod-123',
        original_price: 1000,
        requested_price: 600,
      });

      await useCase.execute(dto);

      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('NO invoca VerifyEmployeeBenefitUseCase', async () => {
      const dto = makeDto(RequestType.PRICE_CHANGE, {
        product_id: 'prod-123',
        original_price: 1000,
        requested_price: 600,
      });

      await useCase.execute(dto);

      expect(mockVerifyEmployeeBenefit.execute).not.toHaveBeenCalled();
    });
  });

  describe.each([
    [RequestType.DISCOUNT],
    [RequestType.CANCEL],
    [RequestType.SUSPEND],
  ])('Cuando el tipo es %s (no es EMPLOYEE_BENEFIT)', (type) => {
    it('NO invoca VerifyEmployeeBenefitUseCase', async () => {
      const dto = makeDto(type);

      await useCase.execute(dto);

      expect(mockVerifyEmployeeBenefit.execute).not.toHaveBeenCalled();
    });

    it('guarda en repositorio y emite el evento hacia el supervisor con canal y payload correctos', async () => {
      const dto = makeDto(type);

      await useCase.execute(dto);

      expect(mockRepository.save).toHaveBeenCalledTimes(1);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        `store:${dto.store_id}:requests`,
        expect.objectContaining({
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          correlation_id: dto.correlation_id,
          type: dto.type,
          status: AuthorizationStatus.PENDING,
          created_at: dto.created_at,
        }),
      );
    });
  });
});
