import { describe, expect, it } from 'vitest';
import { buildClientCheckinSignals } from '../../../src/lib/client-checkin/health-signals.js';

describe('buildClientCheckinSignals', () => {
  it('maps account health columns and metadata into brief-ready signals', () => {
    const signals = buildClientCheckinSignals({
      id: 'account-1',
      name: 'Complete Lending',
      status: 'active',
      ghl_location_id: 'loc_123',
      ghl_pit_token_ref: 'secret-ref',
      assistable_subaccount_id: 'assistable_123',
      n8n_workflow_ids: ['wf_1', 'wf_2'],
      ghl_token_status: 'valid',
      ghl_token_checked_at: new Date('2026-05-20T10:00:00.000Z'),
      assistable_oauth_status: 'connected',
      assistable_oauth_checked_at: '2026-05-20T11:00:00.000Z',
      n8n_workflow_status: 'needs-attention',
      n8n_workflow_checked_at: null,
      metadata: {
        ghlTokenHealth: {
          httpStatus: 200,
          message: null,
        },
        assistableOAuthHealth: {
          httpStatus: 200,
          message: 'Connected',
        },
        n8nWorkflowHealth: {
          workflowCount: 2,
          failingWorkflows: 1,
          staleWorkflows: 0,
        },
      },
    });

    expect(signals).toMatchObject({
      accountId: 'account-1',
      accountName: 'Complete Lending',
      ghl: {
        locationId: 'loc_123',
        pitTokenPresent: true,
        status: 'valid',
        checkedAt: '2026-05-20T10:00:00.000Z',
        httpStatus: 200,
      },
      assistable: {
        subaccountId: 'assistable_123',
        status: 'connected',
        message: 'Connected',
      },
      n8n: {
        workflowIds: ['wf_1', 'wf_2'],
        workflowCount: 2,
        status: 'needs-attention',
        failingWorkflows: 1,
        staleWorkflows: 0,
      },
    });
  });

  it('defaults missing statuses to unknown and workflow count to tracked IDs', () => {
    const signals = buildClientCheckinSignals({
      id: 'account-2',
      name: 'No Checks Yet',
      status: 'active',
      ghl_location_id: null,
      ghl_pit_token_ref: null,
      assistable_subaccount_id: null,
      n8n_workflow_ids: ['wf_1'],
      ghl_token_status: null,
      ghl_token_checked_at: null,
      assistable_oauth_status: null,
      assistable_oauth_checked_at: null,
      n8n_workflow_status: null,
      n8n_workflow_checked_at: null,
      metadata: null,
    });

    expect(signals.ghl.status).toBe('unknown');
    expect(signals.ghl.pitTokenPresent).toBe(false);
    expect(signals.assistable.status).toBe('unknown');
    expect(signals.n8n.status).toBe('unknown');
    expect(signals.n8n.workflowCount).toBe(1);
  });
});
