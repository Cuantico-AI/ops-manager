import { z } from 'zod';
import { listAccountsForN8nWorkflowCheck } from '../../lib/accounts/n8n-workflow-health.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { ValidationError } from '../../lib/errors.js';
import { n8nClient, type N8nClient } from '../../lib/n8n/client.js';
import { resolveTrackedWorkflowId } from '../../lib/n8n/resolve-workflow-id.js';
import type { Skill, SkillContext } from '../_types.js';

export const triggerWorkflowInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
  workflowId: z.string().trim().min(1).optional(),
  inputData: z.record(z.unknown()).optional(),
});

export type TriggerWorkflowInput = z.infer<typeof triggerWorkflowInputSchema>;

export interface TriggerWorkflowOutput {
  accountId: string;
  accountName: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  triggeredAt: string;
}

export const n8nTriggerWorkflowSkill: Skill<TriggerWorkflowInput, TriggerWorkflowOutput> = {
  id: 'n8n.trigger-workflow',
  description: 'Trigger a tracked client workflow on n8n',
  mutates: true,
  requiresApproval: true,
  schema: triggerWorkflowInputSchema,
  async execute(input, ctx: SkillContext): Promise<TriggerWorkflowOutput> {
    const account = await resolveAccountInput(input);
    const [trackedAccount] = await listAccountsForN8nWorkflowCheck({
      accountId: account.id,
      includeInactive: true,
    });

    const workflowId = resolveTrackedWorkflowId(
      trackedAccount?.n8nWorkflowIds ?? [],
      input.workflowId,
    );

    const targetSummary = `Trigger n8n workflow ${workflowId} for ${account.name}`;
    const approval = await ctx.approval.gate({
      jobId: ctx.jobId,
      skill: 'n8n.trigger-workflow',
      targetSummary,
      proposedAction: input,
    });

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'n8n.trigger-workflow',
      target: account.id,
      mutated: true,
      approvalId: approval.approvalId,
      input: {
        accountId: account.id,
        accountName: account.name,
        workflowId,
        inputData: input.inputData,
      },
    });

    const result = await triggerWorkflow(workflowId, input.inputData, n8nClient);
    const output: TriggerWorkflowOutput = {
      accountId: account.id,
      accountName: account.name,
      workflowId: result.workflowId,
      workflowName: result.workflowName,
      executionId: result.executionId,
      triggeredAt: new Date().toISOString(),
    };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'n8n.trigger-workflow',
      target: account.id,
      mutated: true,
      approvalId: approval.approvalId,
      output: {
        workflowId: output.workflowId,
        executionId: output.executionId,
      },
    });

    return output;
  },
};

export function formatTriggerWorkflowOutput(output: TriggerWorkflowOutput): string {
  return [
    'n8n workflow triggered.',
    `Account: ${output.accountName}`,
    `Workflow: ${output.workflowName} (${output.workflowId})`,
    `Execution ID: ${output.executionId}`,
    `Triggered at: ${output.triggeredAt}`,
  ].join('\n');
}

async function triggerWorkflow(
  workflowId: string,
  inputData: Record<string, unknown> | undefined,
  client: N8nClient,
) {
  const workflow = await client.getWorkflow(workflowId);
  if (!workflow.active) {
    throw new ValidationError(`Workflow ${workflowId} is inactive in n8n`);
  }

  return client.executeWorkflow(workflowId, inputData);
}
