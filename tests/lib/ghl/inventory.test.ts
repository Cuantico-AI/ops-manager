import { describe, expect, it } from 'vitest';
import {
  formatGhlAccountInventory,
  summarizeWorkflowStatuses,
} from '../../../src/lib/ghl/inventory.js';

describe('GHL inventory helpers', () => {
  it('summarizes workflow statuses', () => {
    const summary = summarizeWorkflowStatuses([
      { id: 'wf_1', name: 'A', status: 'published', locationId: 'loc_123' },
      { id: 'wf_2', name: 'B', status: 'draft', locationId: 'loc_123' },
      { id: 'wf_3', name: 'C', status: 'published', locationId: 'loc_123' },
    ]);

    expect(summary).toEqual([
      { status: 'draft', count: 1 },
      { status: 'published', count: 2 },
    ]);
  });

  it('formats inventory text without token values', () => {
    const text = formatGhlAccountInventory({
      accountId: 'account-1',
      accountName: 'Complete Lending',
      locationId: 'loc_123',
      capturedAt: '2026-05-21T00:00:00.000Z',
      workflows: [
        { id: 'wf_1', name: 'Welcome', status: 'published', locationId: 'loc_123' },
        { id: 'wf_2', name: 'Follow Up', status: 'draft', locationId: 'loc_123' },
      ],
      customFields: [
        {
          id: 'cf_1',
          name: 'Lead Source',
          fieldKey: 'contact.lead_source',
          dataType: 'TEXT',
          model: 'contact',
        },
      ],
    });

    expect(text).toContain('GHL inventory — Complete Lending');
    expect(text).toContain('Workflows: 2 (1 published)');
    expect(text).toContain('status draft: 1');
    expect(text).toContain('Custom fields: 1');
    expect(text).toContain('Lead Source (contact.lead_source, TEXT, contact)');
    expect(text).not.toContain('pit_');
  });
});
