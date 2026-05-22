import { describe, expect, it } from 'vitest';
import { formatApprovalResumeResult } from '../../../src/lib/slack/format-approval-output.js';
import { formatRefreshAssistableOAuthOutput } from '../../../src/skills/assistable/refresh-oauth.js';

describe('formatApprovalResumeResult', () => {
  it('formats Assistable OAuth refresh resume output', () => {
    const output = {
      accountId: 'account-1',
      accountName: 'Angelo',
      assistableLocationId: 'loc_123',
      locationSource: 'ghl-location-id' as const,
      previousStatus: 'disconnected' as const,
      currentStatus: 'connected' as const,
      refreshMessage: 'OAuth refreshed',
      refreshedAt: '2026-05-22T12:00:00.000Z',
    };

    const text = formatApprovalResumeResult(output);

    expect(text).toBe(formatRefreshAssistableOAuthOutput(output));
    expect(text).toContain('Assistable OAuth refresh completed.');
    expect(text).toContain('Previous status: disconnected');
    expect(text).toContain('Current status: connected');
  });
});

describe('formatRefreshAssistableOAuthOutput', () => {
  it('adds manual reset guidance when still disconnected', () => {
    const text = formatRefreshAssistableOAuthOutput({
      accountId: 'account-1',
      accountName: 'Lupe',
      assistableLocationId: 'loc_456',
      locationSource: 'assistable-subaccount-id',
      previousStatus: 'disconnected',
      currentStatus: 'disconnected',
      refreshedAt: '2026-05-22T12:00:00.000Z',
    });

    expect(text).toContain('Current status: disconnected');
    expect(text).toContain('reset the connection manually in Assistable');
  });
});
