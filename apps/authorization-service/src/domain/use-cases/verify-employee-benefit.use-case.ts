import { Inject, Logger } from '@nestjs/common';
import { AuthorizationRequestDto, AuthorizationStatus } from '@open-supervisor/shared-types';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { IEventEmitter, EVENT_EMITTER } from '../ports/event-emitter.port';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../ports/authorization-repository.port';
import { ACTIVE_DIRECTORY, IActiveDirectoryPort } from '../ports/active-directory.port';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import { EmployeeNotFoundException, AdLookupException } from '../exceptions/active-directory.exceptions';

export class VerifyEmployeeBenefitUseCase {
  constructor(
    @Inject(ACTIVE_DIRECTORY)
    private readonly activeDirectory: IActiveDirectoryPort,
    @Inject(MESSAGE_PUBLISHER)
    private readonly publisher: IMessagePublisher,
    @Inject(EVENT_EMITTER)
    private readonly eventEmitter: IEventEmitter,
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: IAuthorizationRepository,
    private readonly logger: Logger,
  ) {}

  async execute(dto: AuthorizationRequestDto): Promise<void> {
    if (!dto.employee_id) {
      throw new Error('employee_id is required for EMPLOYEE_BENEFIT requests');
    }

    try {
      const adUser = await this.activeDirectory.lookupByEmployeeId(dto.employee_id);

      this.logger.log(
        `AD lookup successful for employee ${dto.employee_id}: associate=${adUser.associate}, accountEnabled=${adUser.accountEnabled}`,
      );

      const isAssociate = adUser.associate === true;
      const isAccountEnabled = adUser.accountEnabled === true;

      if (isAssociate && isAccountEnabled) {
        const request = AuthorizationRequest.fromDto(dto);
        await this.repository.save(request);

        await this.eventEmitter.emit(`store:${dto.store_id}:requests`, {
          correlationId: dto.correlation_id,
          type: dto.type,
          storeId: dto.store_id,
          posId: dto.pos_id,
          employeeId: dto.employee_id,
          displayName: adUser.displayName,
          jobTitle: adUser.jobTitle,
          department: adUser.department,
        });
        return;
      }

      const rejectionReason = !isAccountEnabled
        ? 'ACCOUNT_DISABLED'
        : 'EMPLOYEE_NOT_ACTIVE';

      await this.publisher.publish(`auth.response.${dto.store_id}`, {
        store_id: dto.store_id,
        pos_id: dto.pos_id,
        correlation_id: dto.correlation_id,
        status: AuthorizationStatus.REJECTED,
        resolved_by: 'SYSTEM',
        resolved_at: new Date().toISOString(),
        rejection_reason: rejectionReason,
      });
    } catch (error) {
      if (error instanceof EmployeeNotFoundException) {
        this.logger.warn(
          `Employee not found in AD: ${dto.employee_id}`,
        );
        await this.publisher.publish(`auth.response.${dto.store_id}`, {
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          correlation_id: dto.correlation_id,
          status: AuthorizationStatus.REJECTED,
          resolved_by: 'SYSTEM',
          resolved_at: new Date().toISOString(),
          rejection_reason: 'EMPLOYEE_NOT_FOUND',
        });
        return;
      }

      if (error instanceof AdLookupException) {
        this.logger.error(
          `AD lookup failed for employee ${dto.employee_id}: ${(error as Error).message}`,
        );
        await this.publisher.publish(`auth.response.${dto.store_id}`, {
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          correlation_id: dto.correlation_id,
          status: AuthorizationStatus.REJECTED,
          resolved_by: 'SYSTEM',
          resolved_at: new Date().toISOString(),
          rejection_reason: 'AD_LOOKUP_FAILED',
        });
        return;
      }

      // Re-throw unexpected errors
      throw error;
    }
  }
}
