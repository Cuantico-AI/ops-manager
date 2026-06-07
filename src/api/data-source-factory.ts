import { logger } from '../lib/logger.js';
import type { ReadApiDataSource } from './data-source.js';
import { MockReadApiDataSource } from './mock-data-source.js';
import { PostgresReadApiDataSource } from './postgres-data-source.js';

/**
 * Selects the read-API data source from `DASHBOARD_API_SOURCE`:
 *   - `mock` (default) — the in-memory dataset; the dashboard works end-to-end
 *     with zero database setup.
 *   - `postgres` — real Postgres reads where the schema supports them, falling
 *     back to mock for the not-yet-modeled fields (see PostgresReadApiDataSource).
 */
export function createReadApiDataSource(): ReadApiDataSource {
  const configured = (process.env.DASHBOARD_API_SOURCE ?? 'mock').trim().toLowerCase();

  if (configured === 'postgres' || configured === 'db') {
    return new PostgresReadApiDataSource();
  }

  if (configured !== 'mock') {
    logger.warn({ configured }, 'Unknown DASHBOARD_API_SOURCE; defaulting to mock');
  }

  return new MockReadApiDataSource();
}
