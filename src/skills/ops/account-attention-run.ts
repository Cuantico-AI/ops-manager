import { z } from 'zod';
import {
  executeOpsAccountAttentionRun,
  formatOpsAccountAttentionRunOutput,
  parseOpsAccountAttentionRunCommandArgs,
  type OpsAccountAttentionRunSummary,
} from '../../lib/ops/account-attention-run.js';
import type { Skill, SkillContext } from '../_types.js';

export const opsAccountAttentionRunInputSchema = z.object({
  sinceHours: z.number().int().min(1).max(168).optional(),
  limit: z.number().int().min(1).max(25).optional(),
  minSignals: z.number().int().min(1).max(3).optional(),
  accountDigestLimit: z.number().int().min(1).max(25).optional(),
  concurrency: z.number().int().min(1).max(10).optional(),
});

export type OpsAccountAttentionRunInput = z.infer<typeof opsAccountAttentionRunInputSchema>;

export const opsAccountAttentionRunSkill: Skill<
  OpsAccountAttentionRunInput,
  OpsAccountAttentionRunSummary
> = {
  id: 'ops.account-attention-run',
  description: 'Batch summarize high-attention accounts from the Phase 5 fleet digest',
  mutates: false,
  requiresApproval: false,
  schema: opsAccountAttentionRunInputSchema,
  async execute(input, ctx: SkillContext): Promise<OpsAccountAttentionRunSummary> {
    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.account-attention-run',
      target: 'fleet',
      mutated: false,
      input,
    });

    const output = await executeOpsAccountAttentionRun(input);

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'ops.account-attention-run',
      target: 'fleet',
      mutated: false,
      output: {
        sinceHours: output.sinceHours,
        minSignals: output.minSignals,
        limit: output.limit,
        totalCandidates: output.totalCandidates,
        digested: output.digested,
        failed: output.failed,
        totalAttentionSignals: output.totalAttentionSignals,
      },
    });

    return output;
  },
};

export { formatOpsAccountAttentionRunOutput, parseOpsAccountAttentionRunCommandArgs };
