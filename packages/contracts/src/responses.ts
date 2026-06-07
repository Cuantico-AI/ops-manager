import { z } from 'zod';
import {
  accountSchema,
  approvalSchema,
  auditEntrySchema,
  qaFlagSchema,
  qaHealthSchema,
  requestSchema,
  rollupSchema,
  timelineEventSchema,
} from './entities.js';
import { approvalDecisionSchema, qaDecisionSchema } from './enums.js';

/**
 * Response envelopes for each read-API endpoint, plus the bodies for the two
 * mutation endpoints. The dashboard's data layer types itself off these.
 */

export const fleetResponseSchema = z.object({
  accounts: z.array(accountSchema),
  rollup: rollupSchema,
  syncedAt: z.string(),
});
export type FleetResponse = z.infer<typeof fleetResponseSchema>;

export const accountDetailResponseSchema = z.object({
  account: accountSchema,
  qa: qaHealthSchema.nullable(),
  timeline: z.array(timelineEventSchema),
  recentActions: z.array(auditEntrySchema),
  openRequests: z.array(requestSchema),
});
export type AccountDetailResponse = z.infer<typeof accountDetailResponseSchema>;

export const requestsResponseSchema = z.object({
  requests: z.array(requestSchema),
});
export type RequestsResponse = z.infer<typeof requestsResponseSchema>;

export const approvalsResponseSchema = z.object({
  approvals: z.array(approvalSchema),
});
export type ApprovalsResponse = z.infer<typeof approvalsResponseSchema>;

export const qaFlagsResponseSchema = z.object({
  flags: z.array(qaFlagSchema),
});
export type QaFlagsResponse = z.infer<typeof qaFlagsResponseSchema>;

export const qaHealthResponseSchema = z.object({
  health: z.array(qaHealthSchema),
});
export type QaHealthResponse = z.infer<typeof qaHealthResponseSchema>;

export const auditResponseSchema = z.object({
  entries: z.array(auditEntrySchema),
});
export type AuditResponse = z.infer<typeof auditResponseSchema>;

export const resolveApprovalBodySchema = z.object({
  decision: approvalDecisionSchema,
});
export type ResolveApprovalBody = z.infer<typeof resolveApprovalBodySchema>;

export const resolveApprovalResponseSchema = z.object({
  approvalId: z.string(),
  decision: approvalDecisionSchema,
  request: requestSchema.nullable(),
  auditEntry: auditEntrySchema,
});
export type ResolveApprovalResponse = z.infer<typeof resolveApprovalResponseSchema>;

export const resolveQaFlagBodySchema = z.object({
  decision: qaDecisionSchema,
});
export type ResolveQaFlagBody = z.infer<typeof resolveQaFlagBodySchema>;

export const resolveQaFlagResponseSchema = z.object({
  flagId: z.string(),
  decision: qaDecisionSchema,
  auditEntry: auditEntrySchema,
});
export type ResolveQaFlagResponse = z.infer<typeof resolveQaFlagResponseSchema>;

/** Standard error envelope used by all endpoints on failure. */
export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
