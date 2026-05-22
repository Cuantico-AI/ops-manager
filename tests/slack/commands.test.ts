import { describe, expect, it } from 'vitest';
import {
  formatAccountsSummary,
  formatAssistableOAuthCheckSummary,
  formatGhlTokenCheckSummary,
  formatN8nWorkflowCheckSummary,
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

  it('formats n8n workflow checks without exposing API keys', () => {
    const text = formatN8nWorkflowCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 1,
        healthy: 0,
        needsAttention: 1,
        missingWorkflowIds: 0,
        inactiveWorkflows: 0,
        failingWorkflows: 1,
        staleWorkflows: 0,
        notFoundWorkflows: 0,
        unreachableWorkflows: 0,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Complete Lending',
          status: 'needs-attention',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [
            {
              workflowId: 'wf_1',
              workflowName: 'Client Sync',
              active: true,
              status: 'failing',
              lastRunAt: '2026-05-21T00:00:00.000Z',
              lastRunStatus: 'error',
              recentExecutions: 3,
              recentErrors: 2,
              message: 'n8n_secret should stay out of Slack',
            },
          ],
        },
      ],
    });

    expect(text).toContain('n8n workflow check complete.');
    expect(text).toContain('Status: needs-attention');
    expect(text).toContain('Client Sync (wf_1) — failing');
    expect(text).not.toContain('n8n_secret');
  });

  it('formats fleet n8n workflow checks without exposing API keys', () => {
    const text = formatN8nWorkflowCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 2,
        healthy: 1,
        needsAttention: 1,
        missingWorkflowIds: 0,
        inactiveWorkflows: 0,
        failingWorkflows: 1,
        staleWorkflows: 0,
        notFoundWorkflows: 0,
        unreachableWorkflows: 0,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Complete Lending',
          status: 'healthy',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [],
        },
        {
          accountId: 'account-2',
          accountName: 'Bad Workflow Account',
          status: 'needs-attention',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [
            {
              workflowId: 'wf_2',
              workflowName: 'Client Sync',
              active: true,
              status: 'failing',
              recentExecutions: 1,
              recentErrors: 1,
            },
          ],
        },
      ],
    });

    expect(text).toContain('Failing workflows: 1');
    expect(text).toContain('Bad Workflow Account — wf_2: failing');
    expect(text).not.toContain('n8n_secret');
  });

  it('calls out missing n8n workflow IDs in roster', () => {
    const text = formatN8nWorkflowCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 2,
        healthy: 1,
        needsAttention: 0,
        missingWorkflowIds: 1,
        inactiveWorkflows: 0,
        failingWorkflows: 0,
        staleWorkflows: 0,
        notFoundWorkflows: 0,
        unreachableWorkflows: 0,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Healthy Account',
          status: 'healthy',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [],
        },
        {
          accountId: 'account-2',
          accountName: 'No Workflow Account',
          status: 'missing-workflow-ids',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [],
        },
      ],
    });

    expect(text).toContain('Missing workflow IDs: 1');
    expect(text).toContain('No Workflow Account — no workflow IDs in roster');
  });

  it('warns when tracked n8n workflow IDs are not found', () => {
    const text = formatN8nWorkflowCheckSummary({
      checkedAt: '2026-05-21T00:00:00.000Z',
      summary: {
        total: 2,
        healthy: 1,
        needsAttention: 1,
        missingWorkflowIds: 0,
        inactiveWorkflows: 0,
        failingWorkflows: 0,
        staleWorkflows: 0,
        notFoundWorkflows: 1,
        unreachableWorkflows: 0,
      },
      results: [
        {
          accountId: 'account-1',
          accountName: 'Healthy Account',
          status: 'healthy',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [],
        },
        {
          accountId: 'account-2',
          accountName: 'Bad ID Account',
          status: 'needs-attention',
          checkedAt: '2026-05-21T00:00:00.000Z',
          workflows: [
            {
              workflowId: 'missing-workflow-ids',
              workflowName: 'missing-workflow-ids',
              active: false,
              status: 'not_found',
              recentExecutions: 0,
              recentErrors: 0,
            },
          ],
        },
      ],
    });

    expect(text).toContain('Tracked workflow IDs were not found in n8n.');
    expect(text).toContain('Bad ID Account — missing-workflow-ids: not_found');
  });
});
