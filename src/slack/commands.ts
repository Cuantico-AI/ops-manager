import type { App } from '@slack/bolt';
import {
  listStoredAccounts,
  syncGoogleSheetRoster,
  type AccountSummary,
  type RosterSyncSummary,
} from '../lib/accounts/google-sheet-roster.js';

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

      await respond({
        response_type: 'ephemeral',
        text: formatAccountsSummary(accounts),
      });
      return;
    }

    if (subcommand === 'sync-roster' || subcommand === 'roster-sync') {
      try {
        const { summary, accounts } = await syncGoogleSheetRoster();
        await respond({
          response_type: 'ephemeral',
          text: formatRosterSyncSummary(summary, accounts),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Roster sync failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `Unknown subcommand: ${subcommand}. Try /ops ping, /ops accounts, or /ops sync-roster`,
    });
  });
}

export function formatAccountsSummary(accounts: AccountSummary[]): string {
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const missingTokenCount = accounts.filter((account) => account.pitTokenStatus === 'missing').length;

  return [
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
    .join('\n');
}

export function formatRosterSyncSummary(
  summary: RosterSyncSummary,
  accounts: AccountSummary[],
): string {
  const missingTokenCount = accounts.filter((account) => account.pitTokenStatus === 'missing').length;

  return [
    'GHL roster sync complete.',
    `Rows read: ${summary.totalRows}`,
    `Inserted: ${summary.inserted}`,
    `Updated: ${summary.updated}`,
    `Encrypted PIT tokens stored: ${summary.tokensStored}`,
    `Token references set: ${summary.tokenRefsSet}`,
    `Known accounts: ${accounts.length}`,
    `GHL PIT tokens missing: ${missingTokenCount}`,
  ].join('\n');
}
