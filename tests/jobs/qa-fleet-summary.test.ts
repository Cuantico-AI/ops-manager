import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQaFleetSummaryEnabled } from '../../src/jobs/qa-fleet-summary.js';
import type { FleetQaSummary } from '../../src/lib/qa/fleet-summary.js';

const baseSummary: FleetQaSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  generatedAt: '2026-05-23T12:00:00.000Z',
  limit: 10,
  totalReviews: 2,
  passedReviews: 1,
  failedReviews: 1,
  escalatedReviews: 1,
  passRate: 50,
  topAccounts: [
    {
      accountId: 'account-1',
      accountName: 'Complete Lending',
      totalReviews: 1,
      failedReviews: 1,
      averageScore: 62,
    },
  ],
  topTriggers: [
    {
      reviewTrigger: 'negative',
      totalReviews: 1,
      failedReviews: 1,
    },
  ],
  failures: [
    {
      id: 'review-1',
      accountId: 'account-1',
      accountName: 'Complete Lending',
      callId: 'call_123',
      reviewTrigger: 'negative',
      score: 62,
      callType: 'inbound',
      summary: 'Caller had unresolved objections.',
      findingCount: 1,
      modelUsed: 'ops-claude-sonnet',
      escalated: true,
      reviewedAt: '2026-05-23T11:30:00.000Z',
    },
  ],
};

afterEach(() => {
  delete process.env.QA_FLEET_SUMMARY_ENABLED;
  delete process.env.QA_FLEET_SUMMARY_HOURS;
  delete process.env.QA_FLEET_SUMMARY_CHANNEL;
  vi.doUnmock('../../src/lib/db/client.js');
});

describe('isQaFleetSummaryEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.QA_FLEET_SUMMARY_ENABLED;
    expect(isQaFleetSummaryEnabled()).toBe(false);

    process.env.QA_FLEET_SUMMARY_ENABLED = 'true';
    expect(isQaFleetSummaryEnabled()).toBe(true);
  });
});

describe('runQaFleetSummary', () => {
  it('posts a Slack summary when failures exist', async () => {
    vi.resetModules();
    process.env.QA_FLEET_SUMMARY_HOURS = '12';
    process.env.QA_FLEET_SUMMARY_CHANNEL = '#qa-alerts';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue(baseSummary);
    const postExecute = vi.fn().mockResolvedValue({ ts: '1234.5678' });
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'qa.list-fleet-failures') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runQaFleetSummary } = await import('../../src/jobs/qa-fleet-summary.js');
    await runQaFleetSummary(registry as never);

    expect(summaryExecute).toHaveBeenCalledWith({ sinceHours: 12 }, expect.any(Object));
    expect(postExecute).toHaveBeenCalledWith(
      {
        channel: '#qa-alerts',
        text: expect.stringContaining('Fleet QA failure summary.'),
      },
      expect.any(Object),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs SET status = $1'),
      expect.arrayContaining([
        'succeeded',
        expect.stringContaining('"postedToSlack":true'),
      ]),
    );
  });

  it('suppresses Slack posts when there are no failures', async () => {
    vi.resetModules();

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const summaryExecute = vi.fn().mockResolvedValue({
      ...baseSummary,
      failedReviews: 0,
      failures: [],
      topAccounts: [],
      topTriggers: [],
    });
    const postExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'qa.list-fleet-failures') {
          return { execute: summaryExecute };
        }
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runQaFleetSummary } = await import('../../src/jobs/qa-fleet-summary.js');
    await runQaFleetSummary(registry as never);

    expect(postExecute).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs SET status = $1'),
      expect.arrayContaining([
        'succeeded',
        expect.stringContaining('"postedToSlack":false'),
      ]),
    );
  });
});
