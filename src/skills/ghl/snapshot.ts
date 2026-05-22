import { z } from 'zod';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { fetchGhlAccountSnapshot } from '../../lib/ghl/fetch-account-snapshot.js';
import type { GhlAccountSnapshot } from '../../lib/ghl/snapshot.js';
import type { Skill, SkillContext } from '../_types.js';

export const ghlSnapshotInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type GhlSnapshotInput = z.infer<typeof ghlSnapshotInputSchema>;

export type GhlSnapshotOutput = GhlAccountSnapshot;

export const ghlSnapshotSkill: Skill<GhlSnapshotInput, GhlSnapshotOutput> = {
  id: 'ghl.snapshot',
  description: 'Build a GHL pipeline and opportunity snapshot for one account',
  mutates: false,
  requiresApproval: false,
  schema: ghlSnapshotInputSchema,
  async execute(input, ctx: SkillContext): Promise<GhlSnapshotOutput> {
    const account = await resolveAccountInput(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.snapshot',
      target: account.id,
      mutated: false,
      input: { accountId: account.id, accountName: account.name },
    });

    const snapshot = await fetchGhlAccountSnapshot(account);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ghl.snapshot',
      target: account.id,
      mutated: false,
      output: {
        pipelineCount: snapshot.pipelines.length,
        totalOpportunities: snapshot.totalOpportunities,
      },
    });

    return snapshot;
  },
};
