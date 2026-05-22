import { describe, expect, it } from 'vitest';
import { evaluateWorkflowHealth } from '../../../src/lib/n8n/workflow-health.js';

describe('evaluateWorkflowHealth', () => {
  const workflow = {
    id: 'wf_1',
    name: 'Client Sync',
    active: true,
  };

  it('marks inactive workflows as inactive', () => {
    const snapshot = evaluateWorkflowHealth(
      { ...workflow, active: false },
      [
        {
          id: 'exec_1',
          status: 'success',
          finished: true,
          stoppedAt: new Date().toISOString(),
        },
      ],
      24,
    );

    expect(snapshot.status).toBe('inactive');
  });

  it('marks active workflows with a recent error as failing', () => {
    const snapshot = evaluateWorkflowHealth(workflow, [
      {
        id: 'exec_1',
        status: 'error',
        finished: true,
        stoppedAt: new Date().toISOString(),
      },
    ]);

    expect(snapshot.status).toBe('failing');
    expect(snapshot.recentErrors).toBe(1);
  });

  it('marks active workflows with no recent runs as stale', () => {
    const snapshot = evaluateWorkflowHealth(
      workflow,
      [
        {
          id: 'exec_1',
          status: 'success',
          finished: true,
          stoppedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
      24,
    );

    expect(snapshot.status).toBe('stale');
  });

  it('marks active workflows with a recent success as healthy', () => {
    const snapshot = evaluateWorkflowHealth(workflow, [
      {
        id: 'exec_1',
        status: 'success',
        finished: true,
        stoppedAt: new Date().toISOString(),
      },
    ]);

    expect(snapshot.status).toBe('healthy');
  });
});
