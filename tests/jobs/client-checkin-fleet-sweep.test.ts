import { afterEach, describe, expect, it, vi } from 'vitest';
import { isClientCheckinFleetSweepEnabled } from '../../src/jobs/client-checkin-fleet-sweep.js';
import type { GenerateClientCheckinBriefOutput } from '../../src/skills/client-checkin/generate-brief.js';

const accountId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_ENABLED;
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS;
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY;
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_LIMIT;
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_INCLUDE_INACTIVE;
  delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_MODEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isClientCheckinFleetSweepEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.CLIENT_CHECKIN_FLEET_SWEEP_ENABLED;
    expect(isClientCheckinFleetSweepEnabled()).toBe(false);

    process.env.CLIENT_CHECKIN_FLEET_SWEEP_ENABLED = 'true';
    expect(isClientCheckinFleetSweepEnabled()).toBe(true);
  });
});

describe('runClientCheckinFleetSweep', () => {
  it('generates and persists stale client check-in briefs without posting Slack', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-23T12:00:00.000Z'));
    process.env.CLIENT_CHECKIN_FLEET_SWEEP_MIN_HOURS = '12';
    process.env.CLIENT_CHECKIN_FLEET_SWEEP_CONCURRENCY = '1';
    process.env.CLIENT_CHECKIN_FLEET_SWEEP_LIMIT = '5';
    process.env.CLIENT_CHECKIN_FLEET_SWEEP_INCLUDE_INACTIVE = 'true';
    process.env.CLIENT_CHECKIN_FLEET_SWEEP_MODEL = 'ops-claude-haiku';

    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts a')) {
        return Promise.resolve({
          rows: [
            {
              id: accountId,
              name: 'Complete Lending',
              status: 'active',
              latest_brief_generated_at: '2026-05-21T12:00:00.000Z',
            },
          ],
        });
      }
      if (sql.includes('INSERT INTO client_checkin_briefs')) {
        return Promise.resolve({
          rows: [
            {
              id: 'brief-1',
              job_id: 'job-1',
              account_id: accountId,
              account_name: 'Complete Lending',
              status: 'watch',
              summary: 'One workflow needs review.',
              talking_points: ['Discuss automation health.'],
              open_issues: [{ system: 'n8n', severity: 'minor', detail: 'Workflow stale.' }],
              follow_up_questions: ['Any recent missed automations?'],
              signals: makeBrief().signals,
              model_used: 'ops-claude-haiku',
              generated_at: '2026-05-23T12:00:00.000Z',
              created_at: '2026-05-23T12:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));
    vi.mock('../../src/lib/db/prisma.js', () => ({
      prisma: {
        jobs: {
          create: vi.fn(),
          update: vi.fn(),
        },
      },
    }));

    const generateExecute = vi.fn().mockResolvedValue(makeBrief());
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'client-checkin.generate-brief') {
          return { execute: generateExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runClientCheckinFleetSweep } =
      await import('../../src/jobs/client-checkin-fleet-sweep.js');
    const summary = await runClientCheckinFleetSweep(registry as never);

    expect(generateExecute).toHaveBeenCalledWith(
      { accountId, includeInactive: true, model: 'ops-claude-haiku' },
      expect.any(Object),
    );
    expect(registry.get).not.toHaveBeenCalledWith('slack.post-message');
    expect(summary).toMatchObject({
      totalCandidates: 1,
      generated: 1,
      skippedRecent: 0,
      failed: 0,
      watchBriefs: 1,
      attentionBriefs: 1,
    });
  });
});

function makeBrief(): GenerateClientCheckinBriefOutput {
  return {
    accountId,
    accountName: 'Complete Lending',
    generatedAt: '2026-05-23T12:00:00.000Z',
    modelUsed: 'ops-claude-haiku',
    status: 'watch',
    summary: 'One workflow needs review.',
    talkingPoints: ['Discuss automation health.'],
    openIssues: [{ system: 'n8n', severity: 'minor', detail: 'Workflow stale.' }],
    followUpQuestions: ['Any recent missed automations?'],
    signals: {
      accountId,
      accountName: 'Complete Lending',
      accountStatus: 'active',
      ghl: {
        locationId: 'loc_123',
        pitTokenPresent: true,
        status: 'valid',
        checkedAt: '2026-05-23T11:00:00.000Z',
        httpStatus: 200,
        message: null,
      },
      assistable: {
        subaccountId: 'assistable_123',
        status: 'connected',
        checkedAt: '2026-05-23T11:00:00.000Z',
        httpStatus: 200,
        message: null,
      },
      n8n: {
        workflowIds: ['wf_1'],
        workflowCount: 1,
        status: 'healthy',
        checkedAt: '2026-05-23T11:00:00.000Z',
        failingWorkflows: 0,
        staleWorkflows: 0,
      },
    },
  };
}
