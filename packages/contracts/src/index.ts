/**
 * @cuantico/contracts — shared read-API contract for ops-manager.
 *
 * Single source of truth for the read-model the dashboard renders and the
 * Fastify read API produces. Consumed by both `ops-manager` (src/api) and the
 * dashboard (apps/dashboard). A shape change here is a compile error on both
 * sides — that is the point.
 */
export * from './enums.js';
export * from './entities.js';
export * from './responses.js';

/** Base path the read API is mounted under. */
export const API_BASE_PATH = '/api';
