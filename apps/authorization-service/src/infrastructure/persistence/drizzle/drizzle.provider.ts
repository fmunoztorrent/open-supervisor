import { Module, Global, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/** Token de DI para acceder al cliente Drizzle desde adapters. */
export const DRIZZLE = 'DRIZZLE';
export type DrizzleDb = NodePgDatabase<typeof schema>;

const drizzleProvider = {
  provide: DRIZZLE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): { pool: Pool; db: DrizzleDb } => {
    const url = config.get<string>('DATABASE_URL');
    if (!url) {
      throw new Error('DATABASE_URL is not set. Check .env');
    }
    const pool = new Pool({ connectionString: url, max: 10 });
    const db = drizzle(pool, { schema });
    return { pool, db };
  },
};

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE],
})
export class DrizzleModule implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleModule.name);

  constructor(private readonly provider: { pool: Pool; db: DrizzleDb }) {}

  async onModuleDestroy(): Promise<void> {
    await this.provider.pool.end();
    this.logger.log('Postgres pool closed');
  }
}
