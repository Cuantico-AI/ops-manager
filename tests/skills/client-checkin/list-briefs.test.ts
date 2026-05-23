import { describe, expect, it } from 'vitest';
import {
  formatClientCheckinBriefHistoryOutput,
  parseClientCheckinHistoryCommandArgs,
} from '../../../src/skills/client-checkin/list-briefs.js';

describe('parseClientCheckinHistoryCommandArgs', () => {
  it('uses a trailing number as the limit', () => {
    expect(parseClientCheckinHistoryCommandArgs('Complete Lending 5')).toEqual({
      accountQuery: 'Complete Lending',
      limit: 5,
    });
  });
});

describe('formatClientCheckinBriefHistoryOutput', () => {
  it('formats recent brief summaries without secret material', () => {
    const text = formatClientCheckinBriefHistoryOutput({
      accountId: '00000000-0000-0000-0000-000000000001',
      accountName: 'Complete Lending',
      limit: 10,
      briefs: [
        {
          id: '00000000-0000-0000-0000-000000000200',
          jobId: '00000000-0000-0000-0000-000000000010',
          accountId: '00000000-0000-0000-0000-000000000001',
          accountName: 'Complete Lending',
          status: 'watch',
          summary: 'Mostly healthy with one workflow to monitor.',
          talkingPoints: ['Confirm automation performance.'],
          openIssues: [
            {
              system: 'n8n',
              severity: 'minor',
              detail: 'One workflow has stale execution data.',
            },
          ],
          followUpQuestions: ['Any recent missed automations?'],
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
              status: 'connected',
              checkedAt: '2026-05-22T02:00:00.000Z',
              httpStatus: 200,
              message: null,
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
        },
      ],
    });

    expect(text).toContain('Recent client check-in briefs:');
    expect(text).toContain('WATCH');
    expect(text).toContain('00000000-0000-0000-0000-000000000200');
    expect(text).not.toContain('pit_');
  });
});
