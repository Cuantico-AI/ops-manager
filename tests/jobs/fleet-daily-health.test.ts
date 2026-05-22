import { describe, expect, it, vi } from 'vitest';
import { shouldPostIndividualHealthAlert } from '../../src/jobs/health-alerts.js';

describe('shouldPostIndividualHealthAlert', () => {
  it('suppresses individual posts when unified fleet health is enabled', () => {
    delete process.env.FLEET_DAILY_HEALTH_ENABLED;
    expect(shouldPostIndividualHealthAlert()).toBe(false);
  });

  it('allows individual posts when unified fleet health is disabled', () => {
    process.env.FLEET_DAILY_HEALTH_ENABLED = 'false';
    expect(shouldPostIndividualHealthAlert()).toBe(true);
    delete process.env.FLEET_DAILY_HEALTH_ENABLED;
  });
});

describe('runFleetDailyHealth', () => {
  it('posts overview and threaded detail replies', async () => {
    vi.resetModules();
    process.env.FLEET_DAILY_HEALTH_ENABLED = 'true';

    const postExecute = vi
      .fn()
      .mockResolvedValueOnce({ ts: '1234.5678' })
      .mockResolvedValueOnce({ ts: '1234.5679' })
      .mockResolvedValueOnce({ ts: '1234.5680' })
      .mockResolvedValueOnce({ ts: '1234.5681' });

    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'slack.post-message') {
          return { execute: postExecute };
        }
        if (id === 'ghl.check-pit-token') {
          return {
            execute: vi.fn().mockResolvedValue({
              checkedAt: '2026-05-22T14:00:00.000Z',
              summary: { total: 1, valid: 1, needsAttention: 0 },
              results: [],
            }),
          };
        }
        if (id === 'assistable.check-oauth-status') {
          return {
            execute: vi.fn().mockResolvedValue({
              checkedAt: '2026-05-22T14:00:00.000Z',
              summary: { total: 1, connected: 1, needsAttention: 0 },
              results: [],
            }),
          };
        }
        if (id === 'n8n.check-workflow-health') {
          return {
            execute: vi.fn().mockResolvedValue({
              checkedAt: '2026-05-22T14:00:00.000Z',
              summary: { total: 1, healthy: 1, needsAttention: 0, missingWorkflowIds: 0 },
              results: [],
            }),
          };
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    vi.doMock('../../src/lib/db/client.js', () => ({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    }));

    const { runFleetDailyHealth } = await import('../../src/jobs/fleet-daily-health.js');
    await runFleetDailyHealth(registry as never);

    expect(postExecute).toHaveBeenCalledTimes(4);
    expect(postExecute.mock.calls[0]?.[0]).toMatchObject({
      channel: '#ops-manager-alerts',
      text: expect.stringContaining('Daily fleet health summary.'),
    });
    expect(postExecute.mock.calls[1]?.[0]).toMatchObject({
      threadTs: '1234.5678',
      text: expect.stringContaining('GHL PIT token check complete.'),
    });

    vi.doUnmock('../../src/lib/db/client.js');
    delete process.env.FLEET_DAILY_HEALTH_ENABLED;
  });
});
