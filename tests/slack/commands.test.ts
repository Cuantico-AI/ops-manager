import { describe, expect, it } from 'vitest';
import {
  formatAccountsSummary,
  formatAssistableOAuthCheckSummary,
  formatGhlTokenCheckSummary,
  formatRosterSyncSummary,
} from '../../src/slack/commands.js';
import type {
  AccountSummary,
  RosterSyncSummary,
} from '../../src/lib/accounts/google-sheet-roster.js';

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

  it('formats GHL token checks without exposing token values', () => {
    const text = formatGhlTokenCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 2,
        valid: 1,
        invalid: 1,
        forbidden: 0,
        notFound: 0,
        missingToken: 0,
        missingLocation: 0,
        secretError: 0,
        unreachable: 0,
        needsAttention: 1,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Complete Lending',
          ghlLocationId: 'loc_123',
          status: 'valid',
          httpStatus: 200,
          tokenFingerprint: 'abc123def456',
          checkedAt: '2026-05-21T00:00:00.000Z',
        },
        {
          accountId: 'account-2',
          accountName: 'Bad Token Account',
          ghlLocationId: 'loc_456',
          status: 'invalid',
          httpStatus: 401,
          message: 'pit_secret should stay out of Slack',
          checkedAt: '2026-05-21T00:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('GHL PIT token check complete.');
    expect(text).toContain('Needs attention: 1');
    expect(text).toContain('• Bad Token Account — invalid');
    expect(text).not.toContain('pit_secret');
    expect(text).not.toContain('secret:');
  });

  it('formats single-account token diagnostics with a fingerprint only', () => {
    const text = formatGhlTokenCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 1,
        valid: 1,
        invalid: 0,
        forbidden: 0,
        notFound: 0,
        missingToken: 0,
        missingLocation: 0,
        secretError: 0,
        unreachable: 0,
        needsAttention: 0,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Annie Stern',
          ghlLocationId: 'loc_123',
          status: 'valid',
          httpStatus: 200,
          tokenFingerprint: 'abc123def456',
          checkedAt: '2026-05-21T00:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('Account: Annie Stern');
    expect(text).toContain('Token fingerprint: sha256:abc123def456');
    expect(text).toContain('valid means this PIT can read');
    expect(text).not.toContain('pit_');
    expect(text).not.toContain('secret:');
  });

  it('formats Assistable OAuth checks without exposing API keys', () => {
    const text = formatAssistableOAuthCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 2,
        connected: 1,
        disconnected: 1,
        notFound: 0,
        authError: 0,
        missingSubaccountId: 0,
        unreachable: 0,
        needsAttention: 1,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Complete Lending',
          assistableLocationId: 'loc_123',
          locationSource: 'ghl-location-id',
          status: 'connected',
          httpStatus: 200,
          checkedAt: '2026-05-21T00:00:00.000Z',
        },
        {
          accountId: 'account-2',
          accountName: 'Bad OAuth Account',
          assistableLocationId: 'loc_456',
          locationSource: 'ghl-location-id',
          status: 'disconnected',
          httpStatus: 403,
          message: 'assistable_secret should stay out of Slack',
          checkedAt: '2026-05-21T00:00:00.000Z',
        },
      ],
    });

    expect(text).toContain('Assistable OAuth check complete.');
    expect(text).toContain('Needs attention: 1');
    expect(text).toContain('• Bad OAuth Account — disconnected');
    expect(text).not.toContain('assistable_secret');
  });
});
