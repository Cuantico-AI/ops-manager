import { describe, expect, it } from 'vitest';
import { formatGhlConfigFleetSummary } from '../../src/jobs/ghl-config-inventory.js';

describe('formatGhlConfigFleetSummary', () => {
  it('summarizes fleet inventory without exposing secrets', () => {
    const text = formatGhlConfigFleetSummary(
      [
        {
          accountName: 'Complete Lending',
          workflowCount: 5,
          publishedWorkflows: 3,
          customFieldCount: 12,
        },
        {
          accountName: 'Annie Stern',
          workflowCount: 2,
          publishedWorkflows: 2,
          customFieldCount: 4,
        },
      ],
      [{ accountName: 'Bad Account', message: 'GHL list workflows failed: 403 Forbidden' }],
    );

    expect(text).toContain('Monthly GHL config inventory.');
    expect(text).toContain('Accounts checked: 2');
    expect(text).toContain('Total workflows: 7');
    expect(text).toContain('Total custom fields: 16');
    expect(text).toContain(
      'Complete Lending — 5 workflows (3 published), 12 custom fields',
    );
    expect(text).toContain('Bad Account — GHL list workflows failed: 403 Forbidden');
    expect(text).not.toContain('pit_');
  });
});
