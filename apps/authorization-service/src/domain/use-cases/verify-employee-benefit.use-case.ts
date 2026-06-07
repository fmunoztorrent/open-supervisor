import { Inject, Logger } from '@nestjs/common';
import { AuthorizationRequestDto, RejectionReason } from '@open-supervisor/shared-types';
import { IEventEmitter, EVENT_EMITTER } from '../ports/event-emitter.port';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../ports/authorization-repository.port';
import { IAuthorizationResponsePublisher, AUTHORIZATION_RESPONSE_PUBLISHER } from '../ports/authorization-response-publisher.port';
import { ACTIVE_DIRECTORY, IActiveDirectoryPort } from '../ports/active-directory.port';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import { EmployeeNotFoundException, AdLookupException } from '../exceptions/active-directory.exceptions';

export class VerifyEmployeeBenefitUseCase {
  constructor(
    @Inject(ACTIVE_DIRECTORY)
    private readonly activeDirectory: IActiveDirectoryPort,
    @Inject(AUTHORIZATION_RESPONSE_PUBLISHER)
    private readonly responsePublisher: IAuthorizationResponsePublisher,
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
          correlation_id: dto.correlation_id,
          type: dto.type,
          store_id: dto.store_id,
          pos_id: dto.pos_id,
          employee_id: dto.employee_id,
          displayName: adUser.displayName,
          jobTitle: adUser.jobTitle,
          department: adUser.department,
        });
        return;
      }

      const reason = !isAccountEnabled
        ? RejectionReason.ACCOUNT_DISABLED
        : RejectionReason.EMPLOYEE_NOT_ACTIVE;

      await this.responsePublisher.reject(dto, reason);
    } catch (error) {
      if (error instanceof EmployeeNotFoundException) {
        this.logger.warn(
          `Employee not found in AD: ${dto.employee_id}`,
        );
        await this.responsePublisher.reject(dto, RejectionReason.EMPLOYEE_NOT_FOUND);
        return;
      }

      if (error instanceof AdLookupException) {
        this.logger.error(
          `AD lookup failed for employee ${dto.employee_id}: ${(error as Error).message}`,
        );
        await this.responsePublisher.reject(dto, RejectionReason.AD_LOOKUP_FAILED);
        return;
      }

      // Re-throw unexpected errors
      throw error;
    }
  }
}
