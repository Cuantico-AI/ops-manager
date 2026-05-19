import { App } from '@slack/bolt';
import { registerCommands } from './commands.js';

let boltApp: App | null = null;

export function createBoltApp(): App {
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

  registerCommands(app);
  return app;
}

export function getBoltApp(): App {
  if (!boltApp) {
    boltApp = createBoltApp();
  }
  return boltApp;
}

export async function startBoltApp(): Promise<void> {
  const app = getBoltApp();
  await app.start();
}

export async function stopBoltApp(): Promise<void> {
  if (boltApp) {
    await boltApp.stop();
    boltApp = null;
  }
}
