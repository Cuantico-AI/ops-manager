import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../../../src/lib/db/client.js';
import {
  getClientCheckinBriefById,
  listClientCheckinBriefsForAccount,
  persistClientCheckinBrief,
} from '../../../src/lib/client-checkin/briefs.js';
import { NotFoundError } from '../../../src/lib/errors.js';

vi.mock('../../../src/lib/db/client.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../../src/lib/db/prisma.js', () => ({
  prisma: {
    accounts: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    client_checkin_briefs: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const accountId = '00000000-0000-0000-0000-000000000001';
const jobId = '00000000-0000-0000-0000-000000000010';
const briefId = '00000000-0000-0000-0000-000000000200';

const signals = {
  accountId,
  accountName: 'Complete Lending',
  accountStatus: 'active',
  ghl: {
    locationId: 'loc_123',
    pitTokenPresent: true,
    status: 'valid',
    checkedAt: '2026-05-22T01:00:00.000Z',
    httpStatus: 200,
    message: null,
  },
  assistable: {
    subaccountId: 'assistable_123',
    status: 'connected',
    checkedAt: '2026-05-22T02:00:00.000Z',
    httpStatus: 200,
    message: null,
  },
  n8n: {
    workflowIds: ['wf_1'],
    workflowCount: 1,
    status: 'healthy',
    checkedAt: '2026-05-22T03:00:00.000Z',
    failingWorkflows: 0,
    staleWorkflows: 0,
  },
};

const briefRow = {
  id: briefId,
  job_id: jobId,
  account_id: accountId,
  account_name: 'Complete Lending',
  status: 'watch' as const,
  summary: 'Mostly healthy with one workflow to monitor.',
  talking_points: ['Confirm automation performance.'],
  open_issues: [
    {
      system: 'n8n' as const,
      severity: 'minor' as const,
      detail: 'One workflow has stale execution data.',
      suggestedAction: 'Check the latest execution.',
    },
  ],
  follow_up_questions: ['Any recent missed automations?'],
  signals,
  model_used: 'ops-claude-sonnet',
  generated_at: new Date('2026-05-23T01:00:00.000Z'),
  created_at: new Date('2026-05-23T01:00:01.000Z'),
};

describe('persistClientCheckinBrief', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('stores generated brief content and health signals without token material', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [briefRow] } as never);

    const brief = await persistClientCheckinBrief({
      jobId,
      output: {
        accountId,
        accountName: 'Complete Lending',
        generatedAt: '2026-05-23T01:00:00.000Z',
        modelUsed: 'ops-claude-sonnet',
        status: 'watch',
        summary: 'Mostly healthy with one workflow to monitor.',
        talkingPoints: ['Confirm automation performance.'],
        openIssues: briefRow.open_issues,
        followUpQuestions: ['Any recent missed automations?'],
        signals,
      },
    });

    expect(brief.id).toBe(briefId);
    expect(brief.openIssues).toHaveLength(1);
    expect(brief.signals.ghl.status).toBe('valid');
    expect(JSON.stringify(vi.mocked(query).mock.calls[0]?.[1])).not.toContain('pit_');
  });
});

describe('listClientCheckinBriefsForAccount', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('resolves an account and returns recent persisted briefs', async () => {
    const { prisma } = await import('../../../src/lib/db/prisma.js');
    vi.mocked(prisma.accounts.findMany).mockResolvedValueOnce([
      {
        id: accountId,
        name: 'Complete Lending',
        status: 'active',
        ghl_location_id: 'loc_123',
        ghl_pit_token_ref: null,
      },
    ] as never);
    vi.mocked(query).mockResolvedValueOnce({ rows: [briefRow] } as never);
    vi.mocked(prisma.client_checkin_briefs.findMany).mockResolvedValueOnce([
      {
        ...briefRow,
        accounts: { name: 'Complete Lending' },
      },
    ] as never);

    const output = await listClientCheckinBriefsForAccount({
      accountQuery: 'Complete',
      limit: 2,
    });

    expect(output.accountName).toBe('Complete Lending');
    expect(output.briefs[0]?.status).toBe('watch');
  });
});

describe('getClientCheckinBriefById', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset();
  });

  it('throws NotFoundError when no brief matches the ID', async () => {
    const { prisma } = await import('../../../src/lib/db/prisma.js');
    vi.mocked(prisma.client_checkin_briefs.findUnique).mockResolvedValueOnce(null as never);

    await expect(getClientCheckinBriefById(briefId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
