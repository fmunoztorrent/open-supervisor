import { Inject, Injectable } from '@nestjs/common';
import { DrizzleDb, DRIZZLE } from './drizzle.provider';
import { IUnitOfWork, UnitOfWorkContext } from '../../../domain/ports/unit-of-work.port';
import { IAuthorizationRepository } from '../../../domain/ports/authorization-repository.port';
import { IOutboxRepository } from '../../../domain/ports/outbox-repository.port';
import { DrizzleAuthorizationRepository } from './drizzle-authorization.repository';
import { DrizzleOutboxRepository } from './drizzle-outbox.repository';

/**
 * Implementa IUnitOfWork usando `db.transaction(...)` de Drizzle.
 *
 * En el `ctx` se inyectan repositorios Drizzle-bound a la TX (reciben
 * el `tx` en su constructor). Esto garantiza que save de auth + save
 * del outbox usen la misma conexión de Postgres y se commiteen/rollbackeen
 * juntos.
 *
 * Spec: spec/2026-06-04-outbox-pattern-fire-and-forget-kafka.spec.md (US-01).
 */
@Injectable()
export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async transaction<T>(work: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txDb = tx as unknown as DrizzleDb;
      const ctx: UnitOfWorkContext = {
        authorizationRepository: new DrizzleAuthorizationRepository(txDb) as IAuthorizationRepository,
        outboxRepository: new DrizzleOutboxRepository(txDb) as IOutboxRepository,
      };
      return work(ctx);
    });
  }
}
