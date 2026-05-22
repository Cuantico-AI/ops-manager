import { describe, expect, it } from 'vitest';
import { buildGhlAccountSnapshot, formatGhlAccountSnapshot } from '../../../src/lib/ghl/snapshot.js';

describe('GHL snapshot helpers', () => {
  it('aggregates opportunities by pipeline stage', () => {
    const snapshot = buildGhlAccountSnapshot({
      accountId: 'account-1',
      accountName: 'Complete Lending',
      locationId: 'loc_123',
      pipelines: [
        {
          id: 'pipe_1',
          name: 'Sales',
          locationId: 'loc_123',
          stages: [
            { id: 'stage_1', name: 'New Lead' },
            { id: 'stage_2', name: 'Won' },
          ],
        },
      ],
      opportunities: [
        {
          id: 'opp_1',
          name: 'Opp 1',
          pipelineId: 'pipe_1',
          pipelineStageId: 'stage_1',
          status: 'open',
        },
        {
          id: 'opp_2',
          name: 'Opp 2',
          pipelineId: 'pipe_1',
          pipelineStageId: 'stage_2',
          status: 'won',
        },
      ],
    });

    expect(snapshot.totalOpportunities).toBe(2);
    expect(snapshot.pipelines[0]?.stages[0]).toMatchObject({
      stageName: 'New Lead',
      open: 1,
      total: 1,
    });
    expect(snapshot.pipelines[0]?.stages[1]).toMatchObject({
      stageName: 'Won',
      won: 1,
      total: 1,
    });
  });

  it('formats snapshot text without token values', () => {
    const text = formatGhlAccountSnapshot(
      buildGhlAccountSnapshot({
        accountId: 'account-1',
        accountName: 'Complete Lending',
        locationId: 'loc_123',
        pipelines: [
          {
            id: 'pipe_1',
            name: 'Sales',
            locationId: 'loc_123',
            stages: [{ id: 'stage_1', name: 'New Lead' }],
          },
        ],
        opportunities: [
          {
            id: 'opp_1',
            name: 'Opp 1',
            pipelineId: 'pipe_1',
            pipelineStageId: 'stage_1',
            status: 'open',
          },
        ],
      }),
    );

    expect(text).toContain('GHL snapshot — Complete Lending');
    expect(text).toContain('Pipeline: Sales (1)');
    expect(text).toContain('New Lead — 1 (open 1, won 0, lost 0)');
    expect(text).not.toContain('pit_');
  });
});
