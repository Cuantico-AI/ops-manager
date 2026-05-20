import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../../migrations');

function getAdminConnectionString(): string {
  return process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '';
}

export async function runMigrations(): Promise<void> {
  const connectionString = getAdminConnectionString();
  if (!connectionString) {
    throw new Error('DATABASE_ADMIN_URL or DATABASE_URL must be set for migrations');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM _migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      logger.info({ migration: file }, 'Applying migration');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    // The app authenticates as the login role named in DATABASE_URL (ops_app).
    // Migration 002 bootstraps that role with a placeholder password so a fresh DB
    // initializes cleanly; this step then re-aligns the role's password with the
    // operator-supplied value baked into DATABASE_URL (POSTGRES_APP_PASSWORD). It is
    // idempotent, so it also self-heals if that password is later rotated.
    await syncAppRolePassword(client);

    logger.info('Migrations complete');
  } finally {
    await client.end();
  }
}

/**
 * Sets the password of the login role named in `databaseUrl` to the password in
 * that same URL, so the role the app connects as always has a matching password.
 * Idempotent and safe to run on every startup. Must be run over a connection with
 * privileges to ALTER the role (the admin/superuser `ops` connection).
 *
 * This is what lets a strong, env-driven POSTGRES_APP_PASSWORD work without editing
 * the committed migration: migration 002's `CREATE ROLE ops_app ... PASSWORD` keeps a
 * fixed placeholder for clean first-run bootstrap, and the real password is applied
 * here from DATABASE_URL.
 */
export async function syncAppRolePassword(
  client: pg.Client,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<void> {
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set; skipping app role password sync');
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    logger.warn('DATABASE_URL is not a valid URL; skipping app role password sync');
    return;
  }

  const role = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (!role || !password) {
    logger.warn('DATABASE_URL has no user or password; skipping app role password sync');
    return;
  }

  await client.query(
    `ALTER ROLE ${pg.escapeIdentifier(role)} WITH PASSWORD ${pg.escapeLiteral(password)}`,
  );
  logger.info({ role }, 'Synced app login role password to match DATABASE_URL');
}
