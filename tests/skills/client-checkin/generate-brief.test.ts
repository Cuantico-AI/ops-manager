import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/lib/errors.js';
import {
  formatClientCheckinBriefOutput,
  parseClientCheckinCommandArgs,
  parseClientCheckinModelOutput,
  type GenerateClientCheckinBriefOutput,
} from '../../../src/skills/client-checkin/generate-brief.js';

describe('parseClientCheckinCommandArgs', () => {
  it('uses the whole argument string as the account query', () => {
    expect(parseClientCheckinCommandArgs('  Complete Lending  ')).toEqual({
      accountQuery: 'Complete Lending',
    });
  });

  it('requires an account query', () => {
    expect(() => parseClientCheckinCommandArgs('   ')).toThrow(ValidationError);
  });
});

describe('parseClientCheckinModelOutput', () => {
  it('parses fenced JSON from the model', () => {
    const brief = parseClientCheckinModelOutput(
      [
        '```json',
        '{',
        '  "status": "watch",',
        '  "summary": "Generally stable with one follow-up.",',
        '  "talkingPoints": ["Confirm current automation performance."],',
        '  "openIssues": [',
        '    {',
        '      "system": "n8n",',
        '      "severity": "minor",',
        '      "detail": "One stale workflow needs review.",',
        '      "suggestedAction": "Check last execution."',
        '    }',
        '  ],',
        '  "followUpQuestions": ["Any recent missed automations?"]',
        '}',
        '```',
      ].join('\n'),
    );

    expect(brief.status).toBe('watch');
    expect(brief.openIssues[0]?.system).toBe('n8n');
  });

  it('parses raw JSON objects', () => {
    const brief = parseClientCheckinModelOutput(
      '{"status":"healthy","summary":"All clear.","talkingPoints":["Everything is connected."],"openIssues":[],"followUpQuestions":[]}',
    );

    expect(brief.status).toBe('healthy');
    expect(brief.openIssues).toEqual([]);
  });
});

describe('formatClientCheckinBriefOutput', () => {
  it('formats signals, talking points, and issues for Slack', () => {
    const output: GenerateClientCheckinBriefOutput = {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      generatedAt: '2026-05-23T01:00:00.000Z',
      modelUsed: 'ops-claude-sonnet',
      status: 'at_risk',
      summary: 'OAuth is disconnected.',
      talkingPoints: ['A reconnect is needed before the next campaign.'],
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
        accountId: 'account-1',
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
          checkedAt: '2026-05-22T02:00:00.000Z',
          failingWorkflows: 0,
          staleWorkflows: 0,
        },
      },
    };

    const formatted = formatClientCheckinBriefOutput(output);

    expect(formatted).toContain('Status: AT RISK');
    expect(formatted).toContain('• Assistable OAuth: disconnected (not checked yet)');
    expect(formatted).toContain('[MAJOR] assistable: Assistable OAuth is disconnected.');
  });
});
