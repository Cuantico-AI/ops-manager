import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../../../src/lib/approval/gate.js';
import { ApprovalPendingError } from '../../../src/lib/errors.js';

vi.mock('../../../src/lib/approval/store.js', () => ({
  createApproval: vi.fn(async (input: { jobId: string; skill: string }) => ({
    id: '00000000-0000-4000-8000-000000000099',
    jobId: input.jobId,
    skill: input.skill,
    targetSummary: 'test',
    proposedAction: {},
    status: 'pending',
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    slackMessageTs: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })),
  findApprovedApprovalForJob: vi.fn(async () => null),
  findPendingApprovalForJob: vi.fn(async () => null),
  setJobStatus: vi.fn(async () => undefined),
  setApprovalSlackMessageTs: vi.fn(async () => undefined),
}));

vi.mock('../../../src/lib/approval/slack-flow.js', () => ({
  postApprovalRequest: vi.fn(async () => '1234.5678'),
}));

describe('ApprovalGate', () => {
  afterEach(() => {
    delete process.env.BYPASS_APPROVAL;
    vi.clearAllMocks();
  });

  it('approves when BYPASS_APPROVAL is true', async () => {
    process.env.BYPASS_APPROVAL = 'true';
    const gate = new ApprovalGate();
    const result = await gate.gate({
      jobId: '00000000-0000-4000-8000-000000000001',
      skill: 'test',
      targetSummary: 'test',
      proposedAction: {},
    });
    expect(result.status).toBe('approved');
  });

  it('creates a pending approval when bypass is disabled', async () => {
    process.env.BYPASS_APPROVAL = 'false';
    const gate = new ApprovalGate();
    await expect(
      gate.gate({
        jobId: '00000000-0000-4000-8000-000000000001',
        skill: 'test',
        targetSummary: 'test',
        proposedAction: {},
      }),
    ).rejects.toBeInstanceOf(ApprovalPendingError);
  });
});
