import { Inject, NotFoundException } from '@nestjs/common';
import { AuthorizationResponseDto } from '@open-supervisor/shared-types';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import {
  AUTHORIZATION_REPOSITORY,
  IAuthorizationRepository,
} from '../ports/authorization-repository.port';

export type ResolutionDecision = 'APPROVE' | 'REJECT';

export class ResolveAuthorizationUseCase {
  constructor(
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: IAuthorizationRepository,
    @Inject(MESSAGE_PUBLISHER)
    private readonly publisher: IMessagePublisher,
  ) {}

  async execute(
    id: string,
    decision: ResolutionDecision,
    supervisorId: string,
  ): Promise<AuthorizationRequest> {
    const request = await this.repository.findByCorrelationId(id);
    if (!request) throw new NotFoundException(`Authorization ${id} not found`);

    if (decision === 'APPROVE') {
      request.approve(supervisorId);
    } else {
      request.reject(supervisorId);
    }

    await this.repository.save(request);

    const responseTopic = `auth.response.${request.storeId}`;
    const payload: AuthorizationResponseDto = {
      store_id: request.storeId,
      pos_id: request.posId,
      correlation_id: request.correlationId,
      status: request.status,
      resolved_by: request.resolvedBy!,
      resolved_at: request.resolvedAt!.toISOString(),
      type: request.type,
    };

    await this.publisher.publish(responseTopic, payload);

    return request;
  }
}
