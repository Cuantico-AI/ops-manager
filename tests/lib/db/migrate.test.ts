import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import pg from 'pg';
import { describeIntegration as describe } from '../../helpers.js';
import { syncAppRolePassword } from '../../../src/lib/db/migrate.js';

const adminUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '';

/** Host/port/database to authenticate against, derived from the admin connection. */
function connTarget(): { host: string; port: number; database: string } {
  const u = new URL(adminUrl);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

/** Attempt a fresh login as user/password; true iff connect + a trivial query succeed. */
async function canAuthenticate(user: string, password: string): Promise<boolean> {
  const client = new pg.Client({
    ...connTarget(),
    user,
    password,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

describe('app login role password sync', () => {
  it('ops_app authenticates with the password configured in DATABASE_URL', async () => {
    // End state after global-setup ran runMigrations() on a fresh DB.
    const url = new URL(process.env.DATABASE_URL ?? '');
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);

    expect(user).toBeTruthy();
    expect(password).toBeTruthy();
    expect(await canAuthenticate(user, password)).toBe(true);
  });

  it('aligns a freshly-bootstrapped role with the password in its connection string', async () => {
    // Mirrors ops_app's lifecycle on a throwaway role so the real shared role is
    // never disturbed (keeps the test parallel-safe): a migration bootstraps the
    // role with a fixed placeholder password, then the sync step applies the
    // operator-configured password from the connection string.
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();

    const role = `ops_app_synctest_${randomBytes(6).toString('hex')}`;
    const bootstrapPassword = 'bootstrap_placeholder_pw';
    const configuredPassword = `configured_${randomBytes(8).toString('hex')}`;
    const { host, port, database } = connTarget();
    const configuredUrl = `postgres://${role}:${configuredPassword}@${host}:${port}/${database}`;

    let created = false;
    try {
      await admin.query(
        `CREATE ROLE ${pg.escapeIdentifier(role)} WITH LOGIN PASSWORD ${pg.escapeLiteral(
          bootstrapPassword,
        )}`,
      );
      created = true;
      await admin.query(
        `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(database)} TO ${pg.escapeIdentifier(role)}`,
      );

      // Before sync: only the bootstrap password works.
      expect(await canAuthenticate(role, configuredPassword)).toBe(false);
      expect(await canAuthenticate(role, bootstrapPassword)).toBe(true);

      // Run the exact step runMigrations() performs after applying migrations.
      await syncAppRolePassword(admin, configuredUrl);

      // After sync: the configured password works and the bootstrap one no longer does.
      expect(await canAuthenticate(role, configuredPassword)).toBe(true);
      expect(await canAuthenticate(role, bootstrapPassword)).toBe(false);
    } finally {
      if (created) {
        // DROP OWNED clears the CONNECT grant so the role can be dropped.
        await admin.query(`DROP OWNED BY ${pg.escapeIdentifier(role)}`).catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS ${pg.escapeIdentifier(role)}`).catch(() => {});
      }
      await admin.end();
    }
  });
});
