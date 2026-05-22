import 'dotenv/config';
import Fastify from 'fastify';
import { auditLogger } from './lib/audit/log.js';
import { closePool, getPool } from './lib/db/client.js';
import { runMigrations } from './lib/db/migrate.js';
import { logger } from './lib/logger.js';
import { closeQueue } from './lib/queue/client.js';
import { registerScheduledJobs, stopScheduledJobs } from './jobs/_registry.js';
import { assistableCheckOAuthStatusSkill } from './skills/assistable/check-oauth-status.js';
import { ghlCheckPitTokenSkill } from './skills/ghl/check-pit-token.js';
import { ghlInventorySkill } from './skills/ghl/inventory.js';
import { ghlListCustomFieldsSkill } from './skills/ghl/list-custom-fields.js';
import { ghlListOpportunitiesSkill } from './skills/ghl/list-opportunities.js';
import { ghlListPipelinesSkill } from './skills/ghl/list-pipelines.js';
import { ghlListWorkflowsSkill } from './skills/ghl/list-workflows.js';
import { ghlListAccountsSkill } from './skills/ghl/list-accounts.js';
import { ghlSnapshotSkill } from './skills/ghl/snapshot.js';
import { slackPostMessageSkill } from './skills/slack/post-message.js';
import { SkillRegistry } from './skills/_registry.js';
import { startBoltApp, stopBoltApp } from './slack/bot.js';

const startTime = Date.now();
const version = process.env.APP_VERSION ?? '0.1.0';
const port = Number(process.env.PORT ?? 3000);

const registry = new SkillRegistry();
registry.register(slackPostMessageSkill);
registry.register(ghlListAccountsSkill);
registry.register(ghlCheckPitTokenSkill);
registry.register(assistableCheckOAuthStatusSkill);
registry.register(ghlListPipelinesSkill);
registry.register(ghlListOpportunitiesSkill);
registry.register(ghlListWorkflowsSkill);
registry.register(ghlListCustomFieldsSkill);
registry.register(ghlSnapshotSkill);
registry.register(ghlInventorySkill);

let fastify: ReturnType<typeof Fastify> | null = null;

async function main(): Promise<void> {
  await runMigrations();
  getPool();

  fastify = Fastify({ logger: false });
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version,
  }));

  await fastify.listen({ port, host: '0.0.0.0' });
  logger.info({ port, version }, 'HTTP server listening');

  await startBoltApp();
  logger.info('Slack Bolt app started (Socket Mode)');

  await registerScheduledJobs(registry);
  logger.info('Job scheduler started');

  void auditLogger;
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
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
