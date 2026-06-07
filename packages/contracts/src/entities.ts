import { z } from 'zod';
import {
  accountStatusSchema,
  assistableStatusSchema,
  auditResultSchema,
  channelSchema,
  n8nStatusSchema,
  pitStatusSchema,
  prioritySchema,
  qaCategorySchema,
  qaChannelSchema,
  qaHealthStatusSchema,
  qaSeveritySchema,
  requestStatusSchema,
  riskSchema,
  triggerSchema,
  verticalSchema,
} from './enums.js';

/**
 * Read-model entities. These mirror the prototype's `window.OPS` shape
 * (design_handoff_cuantico_ops/src/data.jsx) so the dashboard can consume the
 * real API without reshaping, and are the contract the backend must satisfy.
 */

export const accountSchema = z.object({
  id: z.string(),
  locationId: z.string().nullable(),
  name: z.string(),
  vert: verticalSchema,
  vertLabel: z.string(),
  status: accountStatusSchema,
  initials: z.string(),
  tint: z.tuple([z.string(), z.string()]),
  pit: pitStatusSchema,
  // Nullable: days-to-expiry requires a stored PIT issue/expiry timestamp, which
  // the GHL token-health check does not yet capture. null = not tracked (the
  // `pit` status itself is real). Mock mode still supplies a number.
  pitDays: z.number().nullable(),
  assistable: assistableStatusSchema,
  assistantId: z.string().nullable(),
  n8n: n8nStatusSchema,
  n8nCount: z.number().int().nonnegative(),
  n8nErr: z.boolean(),
  lastMin: z.number().int().nonnegative(),
  lastActivity: z.string(),
  issue: z.string().nullable(),
  spark: z.array(z.number()),
  // Nullable: Assistable minute-cap usage is not fetched/stored yet. null = not
  // tracked. Mock mode still supplies a number.
  minuteCap: z.number().nullable(),
});
export type Account = z.infer<typeof accountSchema>;

export const requestSchema = z.object({
  id: z.string(),
  acct: z.string(),
  title: z.string(),
  status: requestStatusSchema,
  min: z.number().int().nonnegative(),
  chan: channelSchema,
  prio: prioritySchema,
  approvalId: z.string().optional(),
});
export type Request = z.infer<typeof requestSchema>;

export const approvalDiffSchema = z.object({
  k: z.string(),
  from: z.string(),
  to: z.string(),
});
export type ApprovalDiff = z.infer<typeof approvalDiffSchema>;

export const approvalSchema = z.object({
  id: z.string(),
  acct: z.string(),
  risk: riskSchema,
  verb: z.string(),
  desc: z.string(),
  diff: z.array(approvalDiffSchema),
  trigger: triggerSchema,
  who: z.string(),
  min: z.number().int().nonnegative(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const auditEntrySchema = z.object({
  seq: z.number().int(),
  acct: z.string(),
  action: z.string(),
  detail: z.string(),
  trigger: triggerSchema,
  who: z.string(),
  result: auditResultSchema,
  min: z.number().int().nonnegative(),
  ts: z.string(),
  hash: z.string(),
  prev: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const transcriptLineSchema = z.object({
  role: z.string(),
  text: z.string(),
  flag: z.boolean().optional(),
});
export type TranscriptLine = z.infer<typeof transcriptLineSchema>;

export const qaFlagSchema = z.object({
  id: z.string(),
  acct: z.string(),
  assistantId: z.string().nullable().optional(),
  // Reference to the source call/conversation in Assistable (qa_reviews.call_id).
  // Transcripts are intentionally not persisted (privacy); this ID lets the
  // human-review queue deep-link back to the source without storing it. Nullable:
  // some reviews have no call id (e.g. SMS/manual).
  callId: z.string().nullable().optional(),
  channel: qaChannelSchema,
  severity: qaSeveritySchema,
  confidence: z.number().int().min(0).max(100),
  category: qaCategorySchema,
  when: z.number().int().nonnegative(),
  transcript: z.array(transcriptLineSchema),
  reason: z.string(),
});
export type QaFlag = z.infer<typeof qaFlagSchema>;

export const qaHealthSchema = z.object({
  acct: z.string(),
  score: z.number().int().min(0).max(100),
  slope: z.number(),
  flagsWk: z.number().int().nonnegative(),
  status: qaHealthStatusSchema,
  trend: z.array(z.number()),
  lastFlag: z.string(),
  reviewed: z.number().int().nonnegative(),
});
export type QaHealth = z.infer<typeof qaHealthSchema>;

export const fleetCountsSchema = z.object({
  healthy: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  down: z.number().int().nonnegative(),
  onboarding: z.number().int().nonnegative(),
});
export type FleetCounts = z.infer<typeof fleetCountsSchema>;

export const rollupSchema = z.object({
  total: z.number().int().nonnegative(),
  counts: fleetCountsSchema,
  tokensExpiring: z.number().int().nonnegative(),
  tokensExpired: z.number().int().nonnegative(),
  assistDisc: z.number().int().nonnegative(),
  n8nActive: z.number().int().nonnegative(),
  n8nNone: z.number().int().nonnegative(),
  uptime: z.number(),
  pendingApprovals: z.number().int().nonnegative(),
  activeRequests: z.number().int().nonnegative(),
  awaiting: z.number().int().nonnegative(),
  qaPending: z.number().int().nonnegative(),
  qaHigh: z.number().int().nonnegative(),
  avgQa: z.number(),
  qaDegrading: z.number().int().nonnegative(),
});
export type Rollup = z.infer<typeof rollupSchema>;

/** A timeline event on the account detail screen. */
export const timelineEventSchema = z.object({
  text: z.string(),
  ts: z.string(),
  result: auditResultSchema,
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
