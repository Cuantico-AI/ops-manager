import { afterEach, describe, expect, it, vi } from 'vitest';
import { isClientCheckinFleetSummaryEnabled } from '../../src/jobs/client-checkin-fleet-summary.js';
import type { ClientCheckinFleetSummary } from '../../src/lib/client-checkin/fleet-summary.js';

const baseSummary: ClientCheckinFleetSummary = {
  sinceHours: 168,
  since: '2026-05-16T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalBriefs: 2,
  healthyBriefs: 1,
  watchBriefs: 0,
  atRiskBriefs: 1,
  attentionBriefs: 1,
  attentionRate: 50,
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalBriefs: 1,
      attentionBriefs: 1,
      latestStatus: 'at_risk',
      latestGeneratedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
  topIssueSystems: [{ system: 'assistable', issueCount: 1 }],
  recentAttention: [
    {
      id: 'brief-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      status: 'at_risk',
      summary: 'Assistable reconnect is needed.',
      openIssueCount: 1,
      followUpQuestionCount: 1,
      modelUsed: 'ops-claude-sonnet',
      generatedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
};

afterEach(() => {
  delete process.env.CLIENT_CHECKIN_FLEET_SUMMARY_ENABLED;
  delete process.env.CLIENT_CHECKIN_FLEET_SUMMARY_HOURS;
  delete process.env.CLIENT_CHECKIN_FLEET_SUMMARY_CHANNEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isClientCheckinFleetSummaryEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.CLIENT_CHECKIN_FLEET_SUMMARY_ENABLED;
    expect(isClientCheckinFleetSummaryEnabled()).toBe(false);

    process.env.CLIENT_CHECKIN_FLEET_SUMMARY_ENABLED = 'true';
    expect(isClientCheckinFleetSummaryEnabled()).toBe(true);
  });
});

describe('runClientCheckinFleetSummary', () => {
  it('posts a Slack summary when attention briefs exist', async () => {
    vi.resetModules();
    process.env.CLIENT_CHECKIN_FLEET_SUMMARY_HOURS = '240';
    process.env.CLIENT_CHECKIN_FLEET_SUMMARY_CHANNEL = '#client-alerts';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue(baseSummary);
    const postExecute = vi.fn().mockResolvedValue({ ts: '1234.5678' });
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'client-checkin.list-fleet-risks') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runClientCheckinFleetSummary } =
      await import('../../src/jobs/client-checkin-fleet-summary.js');
    await runClientCheckinFleetSummary(registry as never);

    expect(summaryExecute).toHaveBeenCalledWith({ sinceHours: 240 }, expect.any(Object));
    expect(postExecute).toHaveBeenCalledWith(
      {
        channel: '#client-alerts',
        text: expect.stringContaining('Client check-in fleet attention summary.'),
      },
      expect.any(Object),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs SET status = $1'),
      expect.arrayContaining(['succeeded', expect.stringContaining('"postedToSlack":true')]),
    );
  });

  it('suppresses Slack posts when there are no attention briefs', async () => {
    vi.resetModules();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue({
      ...baseSummary,
      healthyBriefs: 2,
      watchBriefs: 0,
      atRiskBriefs: 0,
      attentionBriefs: 0,
      attentionRate: 0,
      recentAttention: [],
      topAccounts: [],
      topIssueSystems: [],
    });
    const postExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'client-checkin.list-fleet-risks') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runClientCheckinFleetSummary } =
      await import('../../src/jobs/client-checkin-fleet-summary.js');
    await runClientCheckinFleetSummary(registry as never);

    expect(postExecute).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs SET status = $1'),
      expect.arrayContaining(['succeeded', expect.stringContaining('"postedToSlack":false')]),
    );
  });
});
