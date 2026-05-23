import { afterEach, describe, expect, it, vi } from 'vitest';
import { isClientCheckinAttentionSweepEnabled } from '../../src/jobs/client-checkin-attention-sweep.js';
import type { ClientCheckinAttentionSweepSummary } from '../../src/lib/client-checkin/attention-sweep.js';

const baseSummary: ClientCheckinAttentionSweepSummary = {
  sinceHours: 24,
  since: '2026-05-22T12:00:00.000Z',
  minSignals: 2,
  minHours: 24,
  limit: 5,
  concurrency: 2,
  startedAt: '2026-05-23T12:00:00.000Z',
  completedAt: '2026-05-23T12:01:00.000Z',
  fleetTotalAttentionSignals: 3,
  fleetAccountsWithAttention: 1,
  totalCandidates: 1,
  generated: 1,
  skippedRecent: 0,
  failed: 0,
  healthyBriefs: 0,
  watchBriefs: 1,
  atRiskBriefs: 0,
  attentionBriefs: 1,
  results: [],
};

afterEach(() => {
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_ENABLED;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_HOURS;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_SIGNALS;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_HOURS;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_LIMIT;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_CONCURRENCY;
  delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MODEL;
  vi.doUnmock('../../src/lib/db/client.js');
  vi.doUnmock('../../src/lib/client-checkin/attention-sweep.js');
});

describe('isClientCheckinAttentionSweepEnabled', () => {
  it('is disabled unless explicitly enabled', () => {
    delete process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_ENABLED;
    expect(isClientCheckinAttentionSweepEnabled()).toBe(false);

    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_ENABLED = 'true';
    expect(isClientCheckinAttentionSweepEnabled()).toBe(true);
  });
});

describe('runClientCheckinAttentionSweep', () => {
  it('runs the attention sweep without posting Slack', async () => {
    vi.resetModules();
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_HOURS = '12';
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_SIGNALS = '2';
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MIN_HOURS = '6';
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_LIMIT = '4';
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_CONCURRENCY = '1';
    process.env.CLIENT_CHECKIN_ATTENTION_SWEEP_MODEL = 'ops-claude-haiku';

    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../../src/lib/db/client.js', () => ({ query }));

    const executeSweep = vi.fn().mockResolvedValue({
      ...baseSummary,
      sinceHours: 12,
      minHours: 6,
      limit: 4,
      concurrency: 1,
    });
    vi.doMock('../../src/lib/client-checkin/attention-sweep.js', async () => {
      const z = await import('zod');
      const actual = await vi.importActual<typeof import('../../src/lib/client-checkin/attention-sweep.js')>(
        '../../src/lib/client-checkin/attention-sweep.js',
      );
      return {
        ...actual,
        clientCheckinAttentionSweepCommandArgsSchema: z.object({
          sinceHours: z.number().int().positive().optional(),
          minSignals: z.number().int().positive().optional(),
          minHours: z.number().int().positive().optional(),
          limit: z.number().int().positive().optional(),
          concurrency: z.number().int().positive().optional(),
        }),
        executeClientCheckinAttentionSweep: executeSweep,
      };
    });

    const generateExecute = vi.fn();
    const registry = {
      get: vi.fn((id: string) => {
        if (id === 'client-checkin.generate-brief') {
          return { execute: generateExecute };
        }
        if (id === 'slack.post-message') {
          throw new Error('slack should not be used');
        }
        throw new Error(`unexpected skill ${id}`);
      }),
    };

    const { runClientCheckinAttentionSweep } = await import(
      '../../src/jobs/client-checkin-attention-sweep.js'
    );
    const summary = await runClientCheckinAttentionSweep(registry as never);

    expect(executeSweep).toHaveBeenCalledWith(
      expect.objectContaining({
        sinceHours: 12,
        minSignals: 2,
        minHours: 6,
        limit: 4,
        concurrency: 1,
        model: 'ops-claude-haiku',
      }),
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
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE jobs SET status = $1'),
      expect.arrayContaining(['succeeded', expect.stringContaining('"generated":1')]),
    );
  });
});
