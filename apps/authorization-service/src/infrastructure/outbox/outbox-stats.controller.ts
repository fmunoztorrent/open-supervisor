import { Controller, Get, Inject } from '@nestjs/common';
import { IOutboxRepository, OUTBOX_REPOSITORY } from '../../domain/ports/outbox-repository.port';

/**
 * Endpoint de estadísticas del outbox. NO expone payloads — solo metadatos
 * agregados. Útil para que operaciones detecte problemas antes de que el
 * POS se queje.
 *
 * Wire format: snake_case (consistente con el resto del BFF y authorization-service).
 *
 * Spec: spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-04).
 */
@Controller('outbox')
export class OutboxStatsController {
  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outboxRepo: IOutboxRepository,
  ) {}

  @Get('stats')
  async getStats(): Promise<{
    pending_count: number;
    published_count_last_hour: number;
    max_attempts: number;
    oldest_pending_age_seconds: number;
  }> {
    const stats = await this.outboxRepo.getStats();
    return {
      pending_count: stats.pendingCount,
      published_count_last_hour: stats.publishedCountLastHour,
      max_attempts: stats.maxAttempts,
      oldest_pending_age_seconds: stats.oldestPendingAgeSeconds,
    };
  }
}
