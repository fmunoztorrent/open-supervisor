import { Inject, NotFoundException } from '@nestjs/common';
import { AuthorizationResponseDto } from '@open-supervisor/shared-types';
import { IUnitOfWork, UNIT_OF_WORK } from '../ports/unit-of-work.port';
import { OutboxEntry } from '../ports/outbox-repository.port';

export type ResolutionDecision = 'APPROVE' | 'REJECT';

/**
 * Resuelve una solicitud de autorización (APPROVE/REJECT) del supervisor.
 *
 * CAMBIO ARQUITECTURAL: ya no llama a `IMessagePublisher.publish()`
 * directamente. En su lugar, persiste la decisión y encola la respuesta
 * al outbox en una sola transacción SQL (vía IUnitOfWork). La publicación
 * a Kafka la hace el `OutboxPublisherService` de forma asíncrona.
 *
 * Beneficios:
 * - El supervisor no espera el acknowledge de Kafka
 * - Si Kafka está caído, la decisión queda durable en el outbox
 * - El response al controller es sincrónico (201)
 *
 * Spec: spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-01).
 */
export class ResolveAuthorizationUseCase {
  constructor(
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: IUnitOfWork,
  ) {}

  async execute(
    correlationId: string,
    decision: ResolutionDecision,
    supervisorId: string,
  ) {
    return this.unitOfWork.transaction(async (ctx) => {
      const request = await ctx.authorizationRepository.findByCorrelationId(correlationId);
      if (!request) {
        throw new NotFoundException(`Authorization ${correlationId} not found`);
      }

      if (decision === 'APPROVE') {
        request.approve(supervisorId);
      } else {
        request.reject(supervisorId);
      }

      await ctx.authorizationRepository.save(request);

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

      const outboxEntry: OutboxEntry = {
        id: '',
        correlationId: request.correlationId,
        topic: responseTopic,
        payload,
        status: 'PENDING',
        attempts: 0,
        createdAt: new Date(),
        publishedAt: null,
        lastError: null,
      };
      await ctx.outboxRepository.save(outboxEntry);

      return request;
    });
  }
}
