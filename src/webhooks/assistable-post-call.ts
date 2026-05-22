import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  normalizeAssistablePostCallPayload,
  type AssistablePostCallPayload,
} from '../lib/qa/assistable-post-call.js';
import { evaluateAutoReviewPolicy } from '../lib/qa/review-policy.js';
import { enqueueQaAutoReview } from '../jobs/qa-auto-review.js';

function assertWebhookAuthorized(headers: Record<string, unknown>): void {
  const secret = process.env.ASSISTABLE_POST_CALL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return;
  }

  const headerSecret =
    (headers['x-ops-webhook-secret'] as string | undefined) ??
    (headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');

  if (headerSecret !== secret) {
    throw new ValidationError('Invalid webhook secret');
  }
}

export function registerAssistablePostCallWebhook(app: FastifyInstance): void {
  app.post('/webhooks/assistable/post-call', async (request, reply) => {
    try {
      assertWebhookAuthorized(request.headers as Record<string, unknown>);

      const payload = normalizeAssistablePostCallPayload(request.body);
      const decision = evaluateAutoReviewPolicy(payload);

      if (!decision.review) {
        return reply.send({
          ok: true,
          reviewed: false,
          reason: decision.reason,
        });
      }

      await enqueueQaAutoReview(payload, decision);

      return reply.send({
        ok: true,
        reviewed: true,
        queued: true,
        trigger: decision.trigger,
        flagged: decision.flagged,
      });
    } catch (err) {
      logger.error({ err }, 'Assistable post-call webhook failed');
      const statusCode = err instanceof ValidationError ? 400 : 500;
      return reply.status(statusCode).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export type { AssistablePostCallPayload };
