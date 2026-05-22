import { App } from '@slack/bolt';
import type { SkillRegistry } from '../skills/_registry.js';
import { registerActions } from './actions.js';
import { registerCommands } from './commands.js';

let boltApp: App | null = null;

export function createBoltApp(registry: SkillRegistry): App {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const token = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!signingSecret || !token) {
    throw new Error('SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN are required');
  }

  const app = new App({
    signingSecret,
    token,
    socketMode: Boolean(appToken),
    appToken: appToken ?? undefined,
  });

  registerCommands(app, registry);
  registerActions(app, registry);
  return app;
}

export function getBoltApp(registry: SkillRegistry): App {
  if (!boltApp) {
    boltApp = createBoltApp(registry);
  }
  return boltApp;
}

export async function startBoltApp(registry: SkillRegistry): Promise<void> {
  const app = getBoltApp(registry);
  await app.start();
}

export async function stopBoltApp(): Promise<void> {
  if (boltApp) {
    await boltApp.stop();
    boltApp = null;
  }
}
