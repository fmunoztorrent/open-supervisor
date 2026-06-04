import { Inject } from '@nestjs/common';
import { AuthorizationRequestDto, RequestType } from '@open-supervisor/shared-types';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import {
  AUTHORIZATION_REPOSITORY,
  IAuthorizationRepository,
} from '../ports/authorization-repository.port';
import { EVENT_EMITTER, IEventEmitter } from '../ports/event-emitter.port';
import { VerifyEmployeeBenefitUseCase } from './verify-employee-benefit.use-case';
import { ProcessPriceChangeUseCase } from './process-price-change.use-case';

export const VERIFY_EMPLOYEE_BENEFIT = 'VERIFY_EMPLOYEE_BENEFIT';
export const PROCESS_PRICE_CHANGE = 'PROCESS_PRICE_CHANGE';

export class ProcessAuthorizationRequestUseCase {
  constructor(
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: IAuthorizationRepository,
    @Inject(EVENT_EMITTER)
    private readonly eventEmitter: IEventEmitter,
    @Inject(VERIFY_EMPLOYEE_BENEFIT)
    private readonly verifyEmployeeBenefit: VerifyEmployeeBenefitUseCase,
    @Inject(PROCESS_PRICE_CHANGE)
    private readonly processPriceChange: ProcessPriceChangeUseCase,
  ) {}

  async execute(dto: AuthorizationRequestDto): Promise<void> {
    if (dto.type === RequestType.EMPLOYEE_BENEFIT) {
      await this.verifyEmployeeBenefit.execute(dto);
      return;
    }

    if (dto.type === RequestType.PRICE_CHANGE) {
      await this.processPriceChange.execute(dto);
      return;
    }

    const request = AuthorizationRequest.fromDto(dto);
    await this.repository.save(request);

    await this.eventEmitter.emit(`store:${request.storeId}:requests`, {
      id: request.id,
      store_id: request.storeId,
      pos_id: request.posId,
      correlation_id: request.correlationId,
      type: request.type,
      amount: request.amount,
      employee_id: request.employeeId,
      status: request.status,
      created_at: request.createdAt.toISOString(),
    });
  }
}
