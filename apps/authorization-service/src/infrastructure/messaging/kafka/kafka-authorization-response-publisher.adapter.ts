import { Inject, Injectable } from '@nestjs/common';
import { AuthorizationRequestDto, AuthorizationStatus, RejectionReason } from '@open-supervisor/shared-types';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { IAuthorizationResponsePublisher } from '../../../domain/ports/authorization-response-publisher.port';

@Injectable()
export class KafkaAuthorizationResponsePublisher implements IAuthorizationResponsePublisher {
  constructor(
    @Inject(MESSAGE_PUBLISHER)
    private readonly publisher: IMessagePublisher,
  ) {}

  async reject(dto: AuthorizationRequestDto, reason: RejectionReason): Promise<void> {
    await this.publisher.publish(`auth.response.${dto.store_id}`, {
      store_id: dto.store_id,
      pos_id: dto.pos_id,
      correlation_id: dto.correlation_id,
      status: AuthorizationStatus.REJECTED,
      resolved_by: 'SYSTEM',
      resolved_at: new Date().toISOString(),
      rejection_reason: reason,
    });
  }
}
