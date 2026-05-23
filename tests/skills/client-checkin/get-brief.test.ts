import { describe, expect, it } from 'vitest';
import {
  formatClientCheckinBriefRecordOutput,
  parseClientCheckinShowCommandArgs,
} from '../../../src/skills/client-checkin/get-brief.js';

describe('parseClientCheckinShowCommandArgs', () => {
  it('parses a brief ID', () => {
    expect(parseClientCheckinShowCommandArgs(' 00000000-0000-0000-0000-000000000200 ')).toEqual({
      briefId: '00000000-0000-0000-0000-000000000200',
    });
  });
});

describe('formatClientCheckinBriefRecordOutput', () => {
  it('formats a persisted brief with signals and issues', () => {
    const text = formatClientCheckinBriefRecordOutput({
      id: '00000000-0000-0000-0000-000000000200',
      jobId: '00000000-0000-0000-0000-000000000010',
      accountId: '00000000-0000-0000-0000-000000000001',
      accountName: 'Complete Lending',
      status: 'at_risk',
      summary: 'Assistable OAuth is disconnected.',
      talkingPoints: ['Reconnect before the next campaign.'],
      openIssues: [
        {
          system: 'assistable',
          severity: 'major',
          detail: 'Assistable OAuth is disconnected.',
          suggestedAction: 'Run the reconnect workflow.',
        },
      ],
      followUpQuestions: ['Did the client change GHL permissions?'],
      signals: {
        accountId: '00000000-0000-0000-0000-000000000001',
        accountName: 'Complete Lending',
        accountStatus: 'active',
        ghl: {
          locationId: 'loc_123',
          pitTokenPresent: true,
          status: 'valid',
          checkedAt: '2026-05-22T01:00:00.000Z',
          httpStatus: 200,
          message: null,
        },
        assistable: {
          subaccountId: 'assistable_123',
          status: 'disconnected',
          checkedAt: null,
          httpStatus: 401,
          message: 'Disconnected',
        },
        n8n: {
          workflowIds: ['wf_1'],
          workflowCount: 1,
          status: 'healthy',
          checkedAt: '2026-05-22T03:00:00.000Z',
          failingWorkflows: 0,
          staleWorkflows: 0,
        },
      },
      modelUsed: 'ops-claude-sonnet',
      generatedAt: '2026-05-23T01:00:00.000Z',
      createdAt: '2026-05-23T01:00:01.000Z',
    });

    expect(text).toContain('Client check-in brief found.');
    expect(text).toContain('Status: AT RISK');
    expect(text).toContain('Assistable OAuth: disconnected');
    expect(text).toContain('[MAJOR] assistable');
  });
});
