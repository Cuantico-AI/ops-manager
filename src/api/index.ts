import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  API_BASE_PATH,
  resolveApprovalBodySchema,
  resolveQaFlagBodySchema,
} from '@cuantico/contracts';
import { AppError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { ReadApiDataSource } from './data-source.js';
import { createReadApiDataSource } from './data-source-factory.js';

const DEFAULT_OPERATOR = 'A. Reyes (you)';

function resolveOperator(request: FastifyRequest): string {
  const header = request.headers['x-ops-operator'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return process.env.DASHBOARD_DEFAULT_OPERATOR?.trim() || DEFAULT_OPERATOR;
}

function applyCors(reply: FastifyReply): void {
  const origin = process.env.DASHBOARD_ORIGIN?.trim() || '*';
  reply.header('access-control-allow-origin', origin);
  reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
  reply.header('access-control-allow-headers', 'content-type,x-ops-operator');
}

async function handle<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    if (statusCode >= 500) {
      logger.error({ err }, 'Read API request failed');
    }
    await reply.status(statusCode).send({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Registers the dashboard read API under {@link API_BASE_PATH} (`/api`). All
 * endpoints delegate to a {@link ReadApiDataSource} so the data backing them
 * (mock vs. Postgres) can be swapped without touching the routes or the
 * contract the dashboard consumes.
 */
export function registerReadApi(app: FastifyInstance, dataSource?: ReadApiDataSource): void {
  const source = dataSource ?? createReadApiDataSource();
  const base = API_BASE_PATH;

  logger.info({ source: source.label, base }, 'Read API registered');

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith(base)) {
      applyCors(reply);
    }
  });

  // CORS preflight for the cross-origin dashboard dev server.
  app.options(`${base}/*`, (_request, reply) => {
    applyCors(reply);
    return reply.status(204).send();
  });

  app.get(`${base}/meta`, async () => ({ source: source.label, base }));

  app.get(`${base}/fleet`, (_request, reply) => handle(reply, () => source.getFleet()));

  app.get<{ Params: { id: string } }>(`${base}/accounts/:id`, (request, reply) =>
    handle(reply, () => source.getAccountDetail(request.params.id)),
  );

  app.get(`${base}/requests`, (_request, reply) => handle(reply, () => source.getRequests()));

  app.get(`${base}/approvals`, (_request, reply) => handle(reply, () => source.getApprovals()));

  app.post<{ Params: { id: string } }>(`${base}/approvals/:id/resolve`, (request, reply) =>
    handle(reply, () => {
      const parsed = resolveApprovalBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Body must be { decision: "approve" | "reject" }');
      }
      return source.resolveApproval(request.params.id, parsed.data.decision, resolveOperator(request));
    }),
  );

  app.get(`${base}/qa/flags`, (_request, reply) => handle(reply, () => source.getQaFlags()));

  app.get(`${base}/qa/health`, (_request, reply) => handle(reply, () => source.getQaHealth()));

  app.post<{ Params: { id: string } }>(`${base}/qa/flags/:id/resolve`, (request, reply) =>
    handle(reply, () => {
      const parsed = resolveQaFlagBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Body must be { decision: "confirm" | "dismiss" }');
      }
      return source.resolveQaFlag(request.params.id, parsed.data.decision, resolveOperator(request));
    }),
  );

  app.get(`${base}/audit`, (_request, reply) => handle(reply, () => source.getAudit()));
}
