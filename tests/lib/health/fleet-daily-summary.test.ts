import { describe, expect, it } from 'vitest';
import {
  formatFleetDailyHealthOverview,
  isFleetDailyHealthEnabled,
} from '../../../src/lib/health/fleet-daily-summary.js';

describe('formatFleetDailyHealthOverview', () => {
  it('summarizes fleet health across GHL, Assistable, and n8n', () => {
    const text = formatFleetDailyHealthOverview({
      ghl: {
        checkedAt: '2026-05-22T14:00:00.000Z',
        summary: {
          total: 37,
          valid: 37,
          invalid: 0,
          forbidden: 0,
          notFound: 0,
          missingToken: 0,
          missingLocation: 0,
          secretError: 0,
          unreachable: 0,
          needsAttention: 0,
        },
        results: [],
      },
      assistable: {
        checkedAt: '2026-05-22T14:00:00.000Z',
        summary: {
          total: 37,
          connected: 35,
          disconnected: 2,
          notFound: 0,
          missingSubaccountId: 0,
          authError: 0,
          unreachable: 0,
          needsAttention: 2,
        },
        results: [],
      },
      n8n: {
        checkedAt: '2026-05-22T14:00:00.000Z',
        summary: {
          total: 37,
          healthy: 0,
          needsAttention: 37,
          missingWorkflowIds: 0,
          inactiveWorkflows: 0,
          failingWorkflows: 0,
          staleWorkflows: 0,
          notFoundWorkflows: 37,
          unreachableWorkflows: 0,
        },
        results: [],
      },
    });

    expect(text).toContain('Daily fleet health summary.');
    expect(text).toContain('GHL PIT tokens');
    expect(text).toContain('Assistable OAuth');
    expect(text).toContain('n8n workflows');
    expect(text).toContain('39 account issue(s) across the fleet.');
    expect(text).not.toContain('xoxb-');
  });
});

describe('isFleetDailyHealthEnabled', () => {
  it('defaults to enabled', () => {
    delete process.env.FLEET_DAILY_HEALTH_ENABLED;
    expect(isFleetDailyHealthEnabled()).toBe(true);
  });

  it('can be disabled explicitly', () => {
    process.env.FLEET_DAILY_HEALTH_ENABLED = 'false';
    expect(isFleetDailyHealthEnabled()).toBe(false);
    delete process.env.FLEET_DAILY_HEALTH_ENABLED;
  });
});
