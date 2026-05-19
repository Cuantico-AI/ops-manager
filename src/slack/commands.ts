import type { App } from '@slack/bolt';

const startTime = Date.now();

export function registerCommands(app: App): void {
  app.command('/ops', async ({ command, ack, respond }) => {
    await ack();

    const subcommand = command.text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

    if (subcommand === 'ping' || subcommand === '') {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      await respond({
        response_type: 'ephemeral',
        text: `pong — uptime: ${uptimeSeconds}s`,
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `Unknown subcommand: ${subcommand}. Try /ops ping`,
    });
  });
}
