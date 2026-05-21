import { describe, expect, it } from 'vitest';
import { formatAccountsSummary, formatRosterSyncSummary } from '../../src/slack/commands.js';
import type { AccountSummary, RosterSyncSummary } from '../../src/lib/accounts/google-sheet-roster.js';

const baseAccount = {
  id: 'account-1',
  name: 'Complete Lending',
  status: 'active',
  ghlLocationId: 'loc_123',
  assistableSubaccountId: null,
  n8nWorkflowIds: [],
  updatedAt: '2026-05-21T00:00:00.000Z',
} satisfies Omit<AccountSummary, 'pitTokenStatus'>;

describe('Slack command formatters', () => {
  it('formats account summaries without exposing token references or values', () => {
    const text = formatAccountsSummary([
      {
        ...baseAccount,
        pitTokenStatus: 'stored',
      },
      {
        ...baseAccount,
        id: 'account-2',
        name: 'Missing Token Account',
        pitTokenStatus: 'missing',
      },
    ]);

    expect(text).toContain('Known accounts: 2 (2 active)');
    expect(text).toContain('GHL PIT tokens missing: 1');
    expect(text).toContain('token stored');
    expect(text).toContain('token missing');
    expect(text).not.toContain('secret:');
    expect(text).not.toContain('pit_');
  });

  it('formats roster sync counts only', () => {
    const summary: RosterSyncSummary = {
      totalRows: 2,
      inserted: 1,
      updated: 1,
      tokensStored: 1,
      tokenRefsSet: 0,
    };

    const text = formatRosterSyncSummary(summary, [
      {
        ...baseAccount,
        pitTokenStatus: 'stored',
      },
    ]);

    expect(text).toContain('GHL roster sync complete.');
    expect(text).toContain('Rows read: 2');
    expect(text).toContain('Encrypted PIT tokens stored: 1');
    expect(text).not.toContain('secret:');
    expect(text).not.toContain('pit_');
  });
});

