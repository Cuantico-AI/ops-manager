import type { App } from '@slack/bolt';
import { listStoredAccounts } from '../lib/accounts/google-sheet-roster.js';

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

    if (subcommand === 'accounts') {
      const accounts = await listStoredAccounts();
      const activeCount = accounts.filter((account) => account.status === 'active').length;
      const missingTokenCount = accounts.filter(
        (account) => account.pitTokenStatus === 'missing',
      ).length;

      await respond({
        response_type: 'ephemeral',
        text: [
          `Known accounts: ${accounts.length} (${activeCount} active)`,
          `GHL PIT tokens missing: ${missingTokenCount}`,
          '',
          ...accounts.slice(0, 20).map((account) => {
            const token = account.pitTokenStatus === 'stored' ? 'token stored' : 'token missing';
            return `• ${account.name} — ${account.status}, ${token}`;
          }),
          accounts.length > 20 ? `…and ${accounts.length - 20} more` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `Unknown subcommand: ${subcommand}. Try /ops ping or /ops accounts`,
    });
  });
}
