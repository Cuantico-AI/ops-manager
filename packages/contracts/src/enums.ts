import { z } from 'zod';

/**
 * Shared enums for the ops-manager read API. These are the single source of
 * truth for the status/severity/category vocabularies used by both the Fastify
 * read API and the Cuantico Ops dashboard. Changing a value here surfaces as a
 * type error on both sides.
 */

export const accountStatusSchema = z.enum(['healthy', 'attention', 'down', 'onboarding']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const verticalSchema = z.enum(['mortgage', 'realestate', 'insurance']);
export type Vertical = z.infer<typeof verticalSchema>;

export const pitStatusSchema = z.enum(['valid', 'expiring', 'expired']);
export type PitStatus = z.infer<typeof pitStatusSchema>;

export const assistableStatusSchema = z.enum(['connected', 'disconnected']);
export type AssistableStatus = z.infer<typeof assistableStatusSchema>;

export const n8nStatusSchema = z.enum(['active', 'none']);
export type N8nStatus = z.infer<typeof n8nStatusSchema>;

export const requestStatusSchema = z.enum(['new', 'triaging', 'awaiting', 'progress', 'done']);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const channelSchema = z.enum(['auto', 'system', 'human', 'rule']);
export type Channel = z.infer<typeof channelSchema>;

export const prioritySchema = z.enum(['high', 'med', 'low']);
export type Priority = z.infer<typeof prioritySchema>;

export const riskSchema = z.enum(['low', 'med', 'high']);
export type Risk = z.infer<typeof riskSchema>;

export const triggerSchema = z.enum(['system', 'rule', 'operator']);
export type Trigger = z.infer<typeof triggerSchema>;

export const auditResultSchema = z.enum(['ok', 'fail', 'pending', 'info']);
export type AuditResult = z.infer<typeof auditResultSchema>;

export const qaChannelSchema = z.enum(['voice', 'sms']);
export type QaChannel = z.infer<typeof qaChannelSchema>;

export const qaSeveritySchema = z.enum(['high', 'med', 'low']);
export type QaSeverity = z.infer<typeof qaSeveritySchema>;

export const qaCategorySchema = z.enum([
  'hallucination',
  'wrong-info',
  'off-script',
  'out-of-scope',
  'unsafe-promise',
  'tone',
]);
export type QaCategory = z.infer<typeof qaCategorySchema>;

export const qaHealthStatusSchema = z.enum(['good', 'watch', 'degrading']);
export type QaHealthStatus = z.infer<typeof qaHealthStatusSchema>;

export const approvalDecisionSchema = z.enum(['approve', 'reject']);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const qaDecisionSchema = z.enum(['confirm', 'dismiss']);
export type QaDecision = z.infer<typeof qaDecisionSchema>;
