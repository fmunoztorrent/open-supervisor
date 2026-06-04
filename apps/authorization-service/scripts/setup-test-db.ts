/**
 * Helper para setup de la DB de tests.
 *
 * Crea la DB `open_supervisor_test` si no existe, conectándose primero
 * a la DB `postgres` por defecto (que siempre existe en Postgres).
 *
 * Uso: `pnpm db:test:setup`
 *
 * Variables de entorno (con defaults):
 *   DATABASE_URL_ADMIN: URL a DB `postgres` (default: open_supervisor:dev_password@localhost:5432/postgres)
 *   DATABASE_URL_TEST:  URL a la DB de tests (default: open_supervisor:dev_password@localhost:5432/open_supervisor_test)
 *   PGUSER, PGPASSWORD, PGHOST, PGPORT: alternativa
 */
import { Client } from 'pg';

const ADMIN_URL =
  process.env.DATABASE_URL_ADMIN ||
  process.env.DATABASE_ADMIN_URL ||
  'postgresql://open_supervisor:dev_password@localhost:5432/postgres';

const TEST_URL =
  process.env.DATABASE_URL_TEST ||
  'postgresql://open_supervisor:dev_password@localhost:5432/open_supervisor_test';

function dbNameFromUrl(url: string): string {
  const u = new URL(url);
  return u.pathname.replace(/^\//, '');
}

async function main(): Promise<void> {
  const testDbName = dbNameFromUrl(TEST_URL);
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    const result = await admin.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [testDbName],
    );
    if (result.rows[0]?.exists) {
      console.log(`✔ DB "${testDbName}" ya existe`);
    } else {
      console.log(`+ Creando DB "${testDbName}"...`);
      await admin.query(`CREATE DATABASE "${testDbName}"`);
      console.log(`✔ DB "${testDbName}" creada`);
    }
  } finally {
    await admin.end();
  }
  console.log(`\nPróximo paso: pnpm db:migrate (aplicar migraciones a la DB de tests)`);
  console.log(`O usar DATABASE_URL=${TEST_URL} pnpm db:migrate`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
