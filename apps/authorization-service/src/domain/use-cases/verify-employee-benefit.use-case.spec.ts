import { Logger } from '@nestjs/common';
import { AuthorizationRequestDto, AuthorizationStatus, RequestType, RejectionReason } from '@open-supervisor/shared-types';
import { IEventEmitter, EVENT_EMITTER } from '../ports/event-emitter.port';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../ports/authorization-repository.port';
import { IAuthorizationResponsePublisher, AUTHORIZATION_RESPONSE_PUBLISHER } from '../ports/authorization-response-publisher.port';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import {
  ACTIVE_DIRECTORY,
  IActiveDirectoryPort,
} from '../ports/active-directory.port';
import { ActiveDirectoryUser } from '../entities/active-directory-user.entity';
import { VerifyEmployeeBenefitUseCase } from './verify-employee-benefit.use-case';
import {
  EmployeeNotFoundException,
  AdLookupException,
} from '../exceptions/active-directory.exceptions';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDto(overrides: Partial<AuthorizationRequestDto> = {}): AuthorizationRequestDto {
  return {
    store_id: 'store-001',
    pos_id: 'pos-01',
    correlation_id: 'corr-abc',
    type: RequestType.EMPLOYEE_BENEFIT,
    employee_id: '12345678-9',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSavedRequest(dto: AuthorizationRequestDto): AuthorizationRequest {
  return AuthorizationRequest.fromDto(dto);
}

function makeAdUser(overrides: Partial<ActiveDirectoryUser> = {}): ActiveDirectoryUser {
  return {
    displayName: 'Juan Pérez',
    jobTitle: 'Cajero',
    department: 'Caja',
    associate: true,
    accountEnabled: true,
    ...overrides,
  };
}

// ─── mocks ──────────────────────────────────────────────────────────────────

let mockAd: jest.Mocked<IActiveDirectoryPort>;
let mockResponsePublisher: jest.Mocked<IAuthorizationResponsePublisher>;
let mockEventEmitter: jest.Mocked<IEventEmitter>;
let mockRepository: jest.Mocked<IAuthorizationRepository>;
let mockLogger: jest.Mocked<Logger>;
let useCase: VerifyEmployeeBenefitUseCase;

beforeEach(() => {
  mockAd = { lookupByEmployeeId: jest.fn() };
  mockResponsePublisher = { reject: jest.fn().mockResolvedValue(undefined) };
  mockEventEmitter = { emit: jest.fn().mockResolvedValue(undefined) };
  mockRepository = {
    save: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    findByCorrelationId: jest.fn(),
    findPendingByStore: jest.fn(),
  };
  mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as jest.Mocked<Logger>;

  useCase = new VerifyEmployeeBenefitUseCase(
    mockAd,
    mockResponsePublisher,
    mockEventEmitter,
    mockRepository,
    mockLogger,
  );
});

// ─── scenarios ──────────────────────────────────────────────────────────────

describe('VerifyEmployeeBenefitUseCase', () => {
  describe('Escenario 1 — empleado activo y asociado: flujo normal hacia el supervisor', () => {
    it('consulta AD, guarda la solicitud, emite el evento con datos del empleado y NO publica rechazo en Kafka', async () => {
      const dto = makeDto();
      const adUser = makeAdUser();
      mockAd.lookupByEmployeeId.mockResolvedValue(adUser);

      await useCase.execute(dto);

      expect(mockAd.lookupByEmployeeId).toHaveBeenCalledWith(dto.employee_id);
      expect(mockRepository.save).toHaveBeenCalledTimes(1);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        `store:${dto.store_id}:requests`,
        expect.objectContaining({
          correlation_id: dto.correlation_id,
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          employee_id: dto.employee_id,
          type: RequestType.EMPLOYEE_BENEFIT,
          displayName: adUser.displayName,
          jobTitle: adUser.jobTitle,
          department: adUser.department,
        }),
      );

      expect(mockResponsePublisher.reject).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 2 — associate: false: rechazo automático EMPLOYEE_NOT_ACTIVE', () => {
    it('publica rechazo con rejection_reason EMPLOYEE_NOT_ACTIVE via responsePublisher.reject', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockResolvedValue(makeAdUser({ associate: false }));

      await useCase.execute(dto);

      expect(mockResponsePublisher.reject).toHaveBeenCalledWith(dto, RejectionReason.EMPLOYEE_NOT_ACTIVE);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 3 — accountEnabled: false: rechazo automático ACCOUNT_DISABLED', () => {
    it('llama a reject con RejectionReason.ACCOUNT_DISABLED', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockResolvedValue(makeAdUser({ accountEnabled: false }));

      await useCase.execute(dto);

      expect(mockResponsePublisher.reject).toHaveBeenCalledWith(dto, RejectionReason.ACCOUNT_DISABLED);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 4 — AD responde 404: rechazo EMPLOYEE_NOT_FOUND', () => {
    it('cuando el port lanza EmployeeNotFoundException, llama a reject con RejectionReason.EMPLOYEE_NOT_FOUND', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockRejectedValue(new EmployeeNotFoundException(dto.employee_id!));

      await useCase.execute(dto);

      expect(mockResponsePublisher.reject).toHaveBeenCalledWith(dto, RejectionReason.EMPLOYEE_NOT_FOUND);
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 5 — AD falla (5xx/timeout/401/403): rechazo AD_LOOKUP_FAILED', () => {
    it('cuando el port lanza AdLookupException, llama a reject con RejectionReason.AD_LOOKUP_FAILED', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockRejectedValue(new AdLookupException('timeout'));

      await useCase.execute(dto);

      expect(mockResponsePublisher.reject).toHaveBeenCalledWith(dto, RejectionReason.AD_LOOKUP_FAILED);
    });
  });

  describe('Escenario 6 — auditoría: el resultado AD se registra en log', () => {
    it('llama al logger después de la consulta AD exitosa', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockResolvedValue(makeAdUser());

      await useCase.execute(dto);

      expect(mockLogger.log).toHaveBeenCalled();
    });

    it('llama al logger (error o warn) cuando AD falla', async () => {
      const dto = makeDto();
      mockAd.lookupByEmployeeId.mockRejectedValue(new AdLookupException('500'));

      await useCase.execute(dto);

      const loggerCalled = (mockLogger.log as jest.Mock).mock.calls.length > 0
        || (mockLogger.error as jest.Mock).mock.calls.length > 0
        || (mockLogger.warn as jest.Mock).mock.calls.length > 0;

      expect(loggerCalled).toBe(true);
    });
  });

  describe('Escenario 7 — employee_id ausente: error de validación antes de llamar al AD', () => {
    it('lanza un error de validación y nunca llama al port AD', async () => {
      const dto = makeDto({ employee_id: undefined });

      await expect(useCase.execute(dto)).rejects.toThrow();

      expect(mockAd.lookupByEmployeeId).not.toHaveBeenCalled();
    });
  });

  describe('Escenario 8 — respuesta AD sin campo associate: tratado como associate: false', () => {
    it('llama a reject con EMPLOYEE_NOT_ACTIVE cuando la respuesta AD no incluye el campo associate', async () => {
      const dto = makeDto();
      const adUserWithoutAssociate = {
        displayName: 'Desconocido',
        jobTitle: '',
        department: '',
        accountEnabled: true,
        // associate ausente intencionalmente
      } as unknown as ActiveDirectoryUser;
      mockAd.lookupByEmployeeId.mockResolvedValue(adUserWithoutAssociate);

      await useCase.execute(dto);

      expect(mockResponsePublisher.reject).toHaveBeenCalledWith(dto, RejectionReason.EMPLOYEE_NOT_ACTIVE);
    });
  });
});
