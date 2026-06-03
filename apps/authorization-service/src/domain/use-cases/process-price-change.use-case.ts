import { Inject } from '@nestjs/common';
import { AuthorizationRequestDto, AuthorizationStatus, RequestType } from '@open-supervisor/shared-types';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { IAuthorizationRepository, AUTHORIZATION_REPOSITORY } from '../ports/authorization-repository.port';
import { IEventEmitter, EVENT_EMITTER } from '../ports/event-emitter.port';
import { AuthorizationRequest } from '../entities/authorization-request.entity';
import { PriceChangeClassifier } from '../services/price-change-classifier';

export class ProcessPriceChangeUseCase {
  constructor(
    @Inject(MESSAGE_PUBLISHER)
    private readonly publisher: IMessagePublisher,
    @Inject(AUTHORIZATION_REPOSITORY)
    private readonly repository: IAuthorizationRepository,
    @Inject(EVENT_EMITTER)
    private readonly eventEmitter: IEventEmitter,
  ) {}

  async execute(dto: AuthorizationRequestDto): Promise<void> {
    const originalPrice = dto.original_price!;
    const requestedPrice = dto.requested_price!;

    const classification = PriceChangeClassifier.classify(originalPrice, requestedPrice);

    if (classification === 'EQUAL') {
      await this.publisher.publish(`auth.response.${dto.store_id}`, {
        store_id: dto.store_id,
        pos_id: dto.pos_id,
        correlation_id: dto.correlation_id,
        status: AuthorizationStatus.APPROVED,
        type: RequestType.PRICE_CHANGE,
        resolved_by: 'SYSTEM',
        resolved_at: new Date().toISOString(),
      });
      return;
    }

    if (classification === 'WITHIN_LIMIT') {
      const request = AuthorizationRequest.fromDto(dto);
      await this.repository.save(request);
      await this.eventEmitter.emit(`store:${dto.store_id}:requests`, {
        id: request.id,
        storeId: request.storeId,
        posId: request.posId,
        correlationId: request.correlationId,
        type: request.type,
        productId: request.productId,
        originalPrice: request.originalPrice,
        requestedPrice: request.requestedPrice,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
      });
      return;
    }

    // EXCEEDS_LIMIT
    await this.publisher.publish(`auth.response.${dto.store_id}`, {
      store_id: dto.store_id,
      pos_id: dto.pos_id,
      correlation_id: dto.correlation_id,
      status: AuthorizationStatus.REJECTED,
      type: RequestType.PRICE_CHANGE,
      resolved_by: 'SYSTEM',
      resolved_at: new Date().toISOString(),
    });

    await this.eventEmitter.emit(`store:${dto.store_id}:dispatches`, {
      store_id: dto.store_id,
      pos_id: dto.pos_id,
      correlation_id: dto.correlation_id,
      product_id: dto.product_id,
      original_price: dto.original_price,
      requested_price: dto.requested_price,
    });
  }
}
