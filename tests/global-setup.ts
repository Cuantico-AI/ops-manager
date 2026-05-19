import 'dotenv/config';
import pg from 'pg';
import { runMigrations } from '../src/lib/db/migrate.js';

export default async function setup(): Promise<void> {
  process.env.DATABASE_ADMIN_URL ??=
    process.env.DATABASE_URL ??
    'postgres://ops:dev_admin_password@127.0.0.1:5432/opsmanager';
  process.env.DATABASE_URL ??=
    'postgres://ops_app:dev_password@127.0.0.1:5432/opsmanager';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
  process.env.BYPASS_APPROVAL ??= 'true';

  const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  try {
    await client.connect();
    await client.end();
    await runMigrations();
    process.env.SKIP_INTEGRATION = 'false';
  } catch {
    process.env.SKIP_INTEGRATION = 'true';
  }
}
