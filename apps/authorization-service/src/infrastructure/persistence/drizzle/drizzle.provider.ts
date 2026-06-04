import { Module, Global, OnModuleDestroy, Logger, Inject } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/** Token de DI para acceder al cliente Drizzle desde adapters. */
export const DRIZZLE = 'DRIZZLE';
export type DrizzleDb = NodePgDatabase<typeof schema>;

const drizzleProvider = {
  provide: DRIZZLE,
  /**
   * Lee `DATABASE_URL` directamente de `process.env` en lugar de inyectar
   * `ConfigService`. Razón: `ConfigModule` se instancia vía `forRoot({isGlobal:true})`
   * en `AppModule`, pero un `useFactory` provider solo puede resolver sus
   * `inject` desde los `imports` de su propio módulo. Importar `ConfigModule`
   * aquí (sin `forRoot`) no registra providers y el factory queda sin
   * resolver. La lectura directa de `process.env` evita la dependencia
   * cruzada. Ver bugfix `e2e-outbox-fixes` (2026-06-04) — Bug 7.
   *
   * Además provee un objeto `{ db, pool }` en vez de solo la `db`,
   * para que `DrizzleModule.onModuleDestroy` pueda cerrar el pool.
   */
  useFactory: (): { db: DrizzleDb; pool: Pool } => {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      throw new Error('DATABASE_URL is not set. Check .env');
    }
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    return { db, pool };
  },
};

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE],
})
export class DrizzleModule implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleModule.name);

  constructor(@Inject(DRIZZLE) private readonly provider: { db: DrizzleDb; pool: Pool }) {}

  async onModuleDestroy(): Promise<void> {
    await this.provider.pool.end();
    this.logger.log('Postgres pool closed');
  }
}
