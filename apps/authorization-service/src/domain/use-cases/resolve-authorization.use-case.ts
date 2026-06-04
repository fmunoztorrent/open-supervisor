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
    correlationId: string,
    decision: ResolutionDecision,
    supervisorId: string,
  ): Promise<AuthorizationRequest> {
    // El parámetro es correlationId (ver spec: el :id del resolve corresponde
    // al correlation_id generado por el POS), no el id interno de la entidad.
    const request = await this.repository.findByCorrelationId(correlationId);
    if (!request) throw new NotFoundException(`Authorization ${correlationId} not found`);

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
