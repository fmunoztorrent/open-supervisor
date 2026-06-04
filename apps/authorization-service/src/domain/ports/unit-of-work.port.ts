/**
 * Puerto del Unit of Work.
 *
 * Coordina transacciones ACID entre múltiples repositorios. En el contexto
 * del outbox pattern, se usa para garantizar que la persistencia de la
 * decisión del supervisor y la escritura al outbox sean atómicas — si una
 * falla, ambas hacen rollback.
 *
 * Ver spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-01).
 */
import { IAuthorizationRepository } from './authorization-repository.port';
import { IOutboxRepository } from './outbox-repository.port';

export interface UnitOfWorkContext {
  /** Repositorio de solicitudes de autorización (Drizzle-bound en la TX). */
  authorizationRepository: IAuthorizationRepository;
  /** Repositorio del outbox (Drizzle-bound en la TX). */
  outboxRepository: IOutboxRepository;
}

export const UNIT_OF_WORK = 'UNIT_OF_WORK';

export interface IUnitOfWork {
  /**
   * Ejecuta `work` dentro de una transacción SQL. Si `work` lanza, la TX
   * hace ROLLBACK automáticamente. Si retorna OK, hace COMMIT.
   *
   * El `ctx` recibido por `work` contiene repositorios bound a la TX —
   * sus operaciones SQL usan el mismo cliente/conexión de Postgres.
   */
  transaction<T>(work: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T>;
}
