import { describe, expect, it } from 'vitest';
import {
  parseRosterCsv,
  toGoogleSheetCsvExportUrl,
} from '../../../src/lib/accounts/google-sheet-roster.js';

describe('Google Sheet roster helpers', () => {
  it('converts an edit URL to a CSV export URL', () => {
    const url = toGoogleSheetCsvExportUrl(
      'https://docs.google.com/spreadsheets/d/sheet-id/edit#gid=12345',
    );

    expect(url).toBe('https://docs.google.com/spreadsheets/d/sheet-id/export?format=csv&gid=12345');
  });

  it('parses roster CSV with common Google Sheet column names', () => {
    const rows =
      parseRosterCsv(`Account Name,GHL Location ID,Personal Integration Token,n8n Workflow IDs
Complete Lending,loc_123,pit_secret,"wf_1, wf_2"
`);

    expect(rows).toEqual([
      {
        rowNumber: 2,
        name: 'Complete Lending',
        status: undefined,
        ghlLocationId: 'loc_123',
        ghlPitToken: 'pit_secret',
        ghlPitTokenRef: undefined,
        assistableSubaccountId: undefined,
        n8nWorkflowIds: ['wf_1', 'wf_2'],
      },
    ]);
  });
});
