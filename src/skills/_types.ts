import type { z } from 'zod';
import type { AuditLogger } from '../lib/audit/log.js';
import type { ApprovalGate } from '../lib/approval/gate.js';
import type { LiteLLMClient } from '../lib/llm/client.js';

export interface SkillContext {
  jobId: string;
  agentId: string;
  accountId?: string;
  audit: AuditLogger;
  approval: ApprovalGate;
  llm: LiteLLMClient;
}

export interface Skill<Input, Output> {
  id: string;
  description: string;
  mutates: boolean;
  requiresApproval: boolean;
  autonomousEligible: boolean;
  schema: z.ZodSchema<Input>;
  execute(input: Input, ctx: SkillContext): Promise<Output>;
}
