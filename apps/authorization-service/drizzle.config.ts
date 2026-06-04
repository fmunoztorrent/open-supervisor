import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env before running drizzle-kit.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/drizzle/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url,
  },
  verbose: true,
  strict: true,
});
