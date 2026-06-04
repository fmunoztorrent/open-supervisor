import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, gte, isNull, desc } from 'drizzle-orm';
import { DrizzleDb, DRIZZLE } from './drizzle.provider';
import { outbox, OutboxRow, OutboxInsert } from './schema';
import {
  IOutboxRepository,
  OutboxEntry,
  OutboxStats,
} from '../../../domain/ports/outbox-repository.port';

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    correlationId: row.correlationId,
    topic: row.topic,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    lastError: row.lastError,
  };
}

function toInsert(entry: OutboxEntry): OutboxInsert {
  return {
    id: entry.id || undefined,
    correlationId: entry.correlationId,
    topic: entry.topic,
    payload: entry.payload as object,
    status: entry.status,
    attempts: entry.attempts,
    lastError: entry.lastError,
    createdAt: entry.createdAt,
    publishedAt: entry.publishedAt,
  };
}

@Injectable()
export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async save(entry: OutboxEntry): Promise<void> {
    await this.db.insert(outbox).values(toInsert(entry));
  }

  /**
   * MVP single-instance: SELECT simple (sin FOR UPDATE SKIP LOCKED).
   *
   * Para multi-instancia segura, este método debe ejecutarse dentro de
   * una transacción y la query debe agregar `FOR UPDATE SKIP LOCKED`.
   * El OutboxPublisherService actual (single-instance) no lo necesita.
   *
   * Spec: spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-02).
   */
  async findPending(limit: number): Promise<OutboxEntry[]> {
    const rows = await this.db
      .select()
      .from(outbox)
      .where(eq(outbox.status, 'PENDING'))
      .orderBy(outbox.createdAt)
      .limit(limit);
    return rows.map(toEntry);
  }

  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.db
      .update(outbox)
      .set({ status: 'PUBLISHED', publishedAt })
      .where(eq(outbox.id, id));
  }

  async incrementAttempts(id: string, error: Error): Promise<void> {
    await this.db
      .update(outbox)
      .set({
        attempts: sql`${outbox.attempts} + 1`,
        lastError: error.message.slice(0, 500),
      })
      .where(eq(outbox.id, id));
  }

  async getStats(): Promise<OutboxStats> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [pendingRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(outbox)
      .where(eq(outbox.status, 'PENDING'));

    const [publishedRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(outbox)
      .where(and(eq(outbox.status, 'PUBLISHED'), gte(outbox.publishedAt, oneHourAgo)));

    const [attemptsRow] = await this.db
      .select({ max: sql<number>`coalesce(max(${outbox.attempts}), 0)::int` })
      .from(outbox);

    const [oldestRow] = await this.db
      .select({ age: sql<number>`coalesce(extract(epoch from (now() - min(${outbox.createdAt})))::int, 0)` })
      .from(outbox)
      .where(eq(outbox.status, 'PENDING'));

    return {
      pendingCount: pendingRow?.count ?? 0,
      publishedCountLastHour: publishedRow?.count ?? 0,
      maxAttempts: attemptsRow?.max ?? 0,
      oldestPendingAgeSeconds: oldestRow?.age ?? 0,
    };
  }
}
