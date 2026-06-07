import 'dotenv/config';
import Fastify from 'fastify';
import { auditLogger } from './lib/audit/log.js';
import { closePool, getPool } from './lib/db/client.js';
import { runMigrations } from './lib/db/migrate.js';
import { logger } from './lib/logger.js';
import { closeQueue } from './lib/queue/client.js';
import { registerScheduledJobs, stopScheduledJobs } from './jobs/_registry.js';
import { registerQaAutoReviewWorker, stopQaAutoReviewWorker } from './jobs/qa-auto-review.js';
import { n8nCheckWorkflowHealthSkill } from './skills/n8n/check-workflow-health.js';
import { assistableCheckOAuthStatusSkill } from './skills/assistable/check-oauth-status.js';
import { ghlCheckPitTokenSkill } from './skills/ghl/check-pit-token.js';
import { ghlInventorySkill } from './skills/ghl/inventory.js';
import { ghlListCustomFieldsSkill } from './skills/ghl/list-custom-fields.js';
import { ghlListOpportunitiesSkill } from './skills/ghl/list-opportunities.js';
import { ghlListPipelinesSkill } from './skills/ghl/list-pipelines.js';
import { ghlListWorkflowsSkill } from './skills/ghl/list-workflows.js';
import { ghlListAccountsSkill } from './skills/ghl/list-accounts.js';
import { ghlSnapshotSkill } from './skills/ghl/snapshot.js';
import { n8nTriggerWorkflowSkill } from './skills/n8n/trigger-workflow.js';
import { assistableRefreshOAuthSkill } from './skills/assistable/refresh-oauth.js';
import { ghlSetCustomValueSkill } from './skills/ghl/set-custom-value.js';
import { clientCheckinGetBriefSkill } from './skills/client-checkin/get-brief.js';
import { clientCheckinGenerateBriefSkill } from './skills/client-checkin/generate-brief.js';
import { clientCheckinListFleetRisksSkill } from './skills/client-checkin/list-fleet-risks.js';
import { clientCheckinListBriefsSkill } from './skills/client-checkin/list-briefs.js';
import { promptOpsGetReviewSkill } from './skills/prompt-ops/get-review.js';
import { promptOpsListFleetRisksSkill } from './skills/prompt-ops/list-fleet-risks.js';
import { promptOpsListReviewsSkill } from './skills/prompt-ops/list-reviews.js';
import { promptOpsReviewRequestSkill } from './skills/prompt-ops/review-request.js';
import { opsAccountAttentionRunSkill } from './skills/ops/account-attention-run.js';
import { opsAccountDigestSkill } from './skills/ops/account-digest.js';
import { opsFleetDigestSkill } from './skills/ops/fleet-digest.js';
import { qaGetReviewSkill } from './skills/qa/get-review.js';
import { qaListFleetFailuresSkill } from './skills/qa/list-fleet-failures.js';
import { qaListReviewsSkill } from './skills/qa/list-reviews.js';
import { qaReviewTranscriptSkill } from './skills/qa/review-transcript.js';
import { slackPostMessageSkill } from './skills/slack/post-message.js';
import { SkillRegistry } from './skills/_registry.js';
import { startBoltApp, stopBoltApp } from './slack/bot.js';
import { registerAssistablePostCallWebhook } from './webhooks/assistable-post-call.js';
import { registerReadApi } from './api/index.js';

const startTime = Date.now();
const version = process.env.APP_VERSION ?? '0.1.0';
const port = Number(process.env.PORT ?? 3000);

// API-only mode boots just the HTTP read API (for dashboard dev) and skips
// migrations, the Postgres pool warmup, Slack Socket Mode, and job workers — so
// the mock-data dashboard runs with zero infra.
const apiOnly = (process.env.DASHBOARD_API_ONLY ?? '').toLowerCase() === 'true';

const registry = new SkillRegistry();
registry.register(slackPostMessageSkill);
registry.register(ghlListAccountsSkill);
registry.register(ghlCheckPitTokenSkill);
registry.register(assistableCheckOAuthStatusSkill);
registry.register(n8nCheckWorkflowHealthSkill);
registry.register(ghlListPipelinesSkill);
registry.register(ghlListOpportunitiesSkill);
registry.register(ghlListWorkflowsSkill);
registry.register(ghlListCustomFieldsSkill);
registry.register(ghlSnapshotSkill);
registry.register(ghlInventorySkill);
registry.register(ghlSetCustomValueSkill);
registry.register(n8nTriggerWorkflowSkill);
registry.register(assistableRefreshOAuthSkill);
registry.register(qaReviewTranscriptSkill);
registry.register(qaListReviewsSkill);
registry.register(qaGetReviewSkill);
registry.register(qaListFleetFailuresSkill);
registry.register(clientCheckinGenerateBriefSkill);
registry.register(clientCheckinListBriefsSkill);
registry.register(clientCheckinGetBriefSkill);
registry.register(clientCheckinListFleetRisksSkill);
registry.register(promptOpsReviewRequestSkill);
registry.register(promptOpsListReviewsSkill);
registry.register(promptOpsGetReviewSkill);
registry.register(promptOpsListFleetRisksSkill);
registry.register(opsAccountAttentionRunSkill);
registry.register(opsAccountDigestSkill);
registry.register(opsFleetDigestSkill);

let fastify: ReturnType<typeof Fastify> | null = null;

async function main(): Promise<void> {
  if (apiOnly) {
    logger.warn(
      'DASHBOARD_API_ONLY=true — booting HTTP read API only (no migrations, Slack, or job workers)',
    );
  } else {
    await runMigrations();
    getPool();
  }

  fastify = Fastify({ logger: false });
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
  }));

  registerAssistablePostCallWebhook(fastify);
  registerReadApi(fastify);

  await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ port, version, apiOnly }, 'HTTP server listening');

  if (apiOnly) {
    return;
  }

  await startBoltApp(registry);
  logger.info('Slack Bolt app started (Socket Mode)');

  await registerScheduledJobs(registry);
  registerQaAutoReviewWorker(registry);
  logger.info('Job scheduler started');

  void auditLogger;
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await stopQaAutoReviewWorker();
  await stopScheduledJobs();
  await stopBoltApp();
  if (fastify) {
    await fastify.close();
  }
  await closeQueue();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
