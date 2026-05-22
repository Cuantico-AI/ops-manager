import { describe, expect, it } from 'vitest';
import { formatGhlPipelineFleetSummary } from '../../src/jobs/ghl-pipeline-snapshot.js';

describe('formatGhlPipelineFleetSummary', () => {
  it('summarizes fleet counts without exposing secrets', () => {
    const text = formatGhlPipelineFleetSummary(
      [
        {
          accountName: 'Complete Lending',
          pipelineCount: 2,
          totalOpportunities: 10,
          open: 7,
        },
      ],
      [{ accountName: 'Bad Account', message: 'GHL search opportunities failed: 403 Forbidden' }],
    );

    expect(text).toContain('Weekly GHL pipeline snapshot.');
    expect(text).toContain('Accounts checked: 1');
    expect(text).toContain('Complete Lending — 2 pipelines, 10 opps (7 open)');
    expect(text).toContain('Bad Account — GHL search opportunities failed: 403 Forbidden');
    expect(text).not.toContain('pit_');
  });
});
