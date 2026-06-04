/**
 * Puerto del repositorio del outbox.
 *
 * El outbox desacopla la decisión del supervisor (persistencia inmediata)
 * de la publicación a Kafka (asíncrona, retryable). El dominio NO conoce
 * Drizzle ni SQL — solo esta interfaz.
 *
 * Ver spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-01, US-02).
 */
export type OutboxStatus = 'PENDING' | 'PUBLISHED';

export interface OutboxEntry {
  id: string;
  correlationId: string;
  topic: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  createdAt: Date;
  publishedAt: Date | null;
  lastError: string | null;
}

export interface OutboxStats {
  pendingCount: number;
  publishedCountLastHour: number;
  maxAttempts: number;
  oldestPendingAgeSeconds: number;
}

export const OUTBOX_REPOSITORY = 'OUTBOX_REPOSITORY';

export interface IOutboxRepository {
  /** Persiste un entry nuevo en el outbox. Llamado dentro de la TX del IUnitOfWork. */
  save(entry: OutboxEntry): Promise<void>;

  /**
   * Devuelve hasta `limit` entries PENDING. El adapter DEBE usar
   * `FOR UPDATE SKIP LOCKED` para soportar múltiples workers concurrentes
   * sin duplicar publicaciones.
   */
  findPending(limit: number): Promise<OutboxEntry[]>;

  /** Marca un entry como publicado. */
  markPublished(id: string, publishedAt: Date): Promise<void>;

  /** Incrementa el contador de intentos y guarda el último error. */
  incrementAttempts(id: string, error: Error): Promise<void>;

  /** Estadísticas para el endpoint /outbox/stats. */
  getStats(): Promise<OutboxStats>;
}
