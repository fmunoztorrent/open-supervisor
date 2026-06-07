import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { IMessagePublisher, MESSAGE_PUBLISHER } from '@open-supervisor/shared-messaging';
import { IOutboxRepository, OutboxEntry, OUTBOX_REPOSITORY } from '../../domain/ports/outbox-repository.port';

const OUTBOX_TICK_INTERVAL_MS = parseInt(process.env.OUTBOX_TICK_INTERVAL_MS ?? '1000', 10);

/**
 * Worker que toma entries PENDING del outbox y los publica a Kafka.
 *
 * Ciclo de vida:
 * - `@Interval()` programa la ejecución periódica de `tick()` con el
 *   intervalo configurable por `OUTBOX_TICK_INTERVAL_MS` (default 1000ms).
 * - `tick()` toma hasta `OUTBOX_BATCH_SIZE` entries PENDING (default 50),
 *   intenta publicarlos uno a uno, y los marca PUBLISHED o incrementa
 *   `attempts` según el resultado.
 *
 * Garantías:
 * - At-least-once: si Kafka está caído, el entry queda PENDING y el
 *   próximo tick lo reintenta. Si el proceso se cae, los entries siguen
 *   en Postgres.
 * - Fire-and-forget: el controller NO espera este worker. La respuesta
 *   al supervisor es inmediata.
 *
 * Spec: spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-02, US-03, US-04).
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outboxRepo: IOutboxRepository,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: IMessagePublisher,
    private readonly config: ConfigService,
  ) {}

  private get batchSize(): number {
    return this.config.get<number>('OUTBOX_BATCH_SIZE', 50);
  }

  /**
   * Toma hasta `batchSize` entries PENDING y los publica a Kafka.
   * Diseñado para ser tolerante a fallos: si una publicación lanza, las
   * restantes se intentan de todas formas. Si `findPending` lanza (DB
   * caída), el error se loguea y se retorna sin crashear.
   */
  @Interval('outbox-tick', OUTBOX_TICK_INTERVAL_MS)
  async tick(): Promise<{ pending: number; published: number; failed: number; durationMs: number }> {
    const start = Date.now();
    let entries: OutboxEntry[] = [];
    try {
      entries = await this.outboxRepo.findPending(this.batchSize);
    } catch (err) {
      this.logger.error(
        `findPending failed (DB down?): ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return { pending: 0, published: 0, failed: 0, durationMs: Date.now() - start };
    }

    let published = 0;
    let failed = 0;
    for (const entry of entries) {
      try {
        await this.publisher.publish(entry.topic, entry.payload);
        await this.outboxRepo.markPublished(entry.id, new Date());
        published++;
        this.logger.debug(
          `Published outbox entry ${entry.id} (correlation_id=${entry.correlationId}, topic=${entry.topic})`,
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        try {
          await this.outboxRepo.incrementAttempts(entry.id, error);
        } catch (innerErr) {
          this.logger.error(
            `Failed to increment attempts for ${entry.id}: ${innerErr instanceof Error ? innerErr.message : 'unknown'}`,
          );
        }
        failed++;
        this.logger.warn(
          `Failed to publish outbox entry ${entry.id} (correlation_id=${entry.correlationId}, attempts=${entry.attempts + 1}): ${error.message}`,
        );
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `Outbox tick: pending=${entries.length}, published=${published}, failed=${failed}, duration=${durationMs}ms`,
    );
    return { pending: entries.length, published, failed, durationMs };
  }
}
