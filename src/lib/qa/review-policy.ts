import { createHash } from 'node:crypto';
import type { AssistablePostCallPayload } from './assistable-post-call.js';

export type QaAutoReviewSkipReason =
  | 'disabled'
  | 'too-short-duration'
  | 'skip-tag'
  | 'missing-transcript'
  | 'transcript-too-short'
  | 'missing-location'
  | 'not-selected';

export type QaAutoReviewTrigger = 'sample' | 'negative' | 'error' | 'failed_task';

export interface QaAutoReviewDecision {
  review: boolean;
  trigger?: QaAutoReviewTrigger;
  reason: QaAutoReviewSkipReason | QaAutoReviewTrigger;
  flagged: boolean;
}

export interface QaAutoReviewPolicyConfig {
  enabled: boolean;
  minDurationSec: number;
  minTranscriptChars: number;
  sampleRate: number;
  skipTags: string[];
  alwaysReviewTags: string[];
  negativeSentiments: string[];
}

const DEFAULT_SKIP_TAGS = [
  'voicemail reached',
  'machine detected',
  'not answered',
  'dial no answer',
  'dial busy',
  'dial failed',
  'dial no answer',
];

const DEFAULT_NEGATIVE_SENTIMENTS = ['negative'];

const ERROR_TAG_PREFIX = 'ai_call_error_';

export function getQaAutoReviewPolicyConfig(): QaAutoReviewPolicyConfig {
  return {
    enabled: process.env.QA_AUTO_REVIEW_ENABLED === 'true',
    minDurationSec: Number(process.env.QA_REVIEW_MIN_DURATION_SEC ?? 90),
    minTranscriptChars: Number(process.env.QA_REVIEW_MIN_TRANSCRIPT_CHARS ?? 200),
    sampleRate: Number(process.env.QA_REVIEW_SAMPLE_RATE ?? 0.015),
    skipTags: parseCsv(process.env.QA_REVIEW_SKIP_TAGS, DEFAULT_SKIP_TAGS).map(normalizeTag),
    alwaysReviewTags: parseCsv(process.env.QA_REVIEW_ALWAYS_TAGS, []).map(normalizeTag),
    negativeSentiments: parseCsv(
      process.env.QA_REVIEW_NEGATIVE_SENTIMENTS,
      DEFAULT_NEGATIVE_SENTIMENTS,
    ).map((value) => value.toLowerCase()),
  };
}

export function getQaAutoReviewModel(): string {
  return process.env.QA_AUTO_REVIEW_MODEL?.trim() || 'ops-claude-haiku';
}

export function getQaReviewEscalationModel(): string | null {
  const model = process.env.QA_REVIEW_ESCALATION_MODEL?.trim();
  return model || 'ops-claude-sonnet';
}

export function getQaManualReviewModel(): string {
  return process.env.QA_REVIEW_MODEL?.trim() || 'ops-claude-sonnet';
}

export function evaluateAutoReviewPolicy(
  payload: AssistablePostCallPayload,
  config: QaAutoReviewPolicyConfig = getQaAutoReviewPolicyConfig(),
): QaAutoReviewDecision {
  if (!config.enabled) {
    return { review: false, reason: 'disabled', flagged: false };
  }

  const durationSec = resolveDurationSec(payload);
  if (durationSec < config.minDurationSec) {
    return { review: false, reason: 'too-short-duration', flagged: false };
  }

  const tags = collectTags(payload);
  if (tags.some((tag) => config.skipTags.includes(tag))) {
    return { review: false, reason: 'skip-tag', flagged: false };
  }

  const transcript = payload.full_transcript?.trim() ?? '';
  if (!transcript) {
    return { review: false, reason: 'missing-transcript', flagged: false };
  }
  if (transcript.length < config.minTranscriptChars) {
    return { review: false, reason: 'transcript-too-short', flagged: false };
  }

  if (!payload.location_id?.trim()) {
    return { review: false, reason: 'missing-location', flagged: false };
  }

  if (hasErrorTags(tags)) {
    return { review: true, trigger: 'error', reason: 'error', flagged: true };
  }

  if (isNegativeSentiment(payload.user_sentiment, config.negativeSentiments)) {
    return { review: true, trigger: 'negative', reason: 'negative', flagged: true };
  }

  if (hasAlwaysReviewTag(tags, config.alwaysReviewTags)) {
    return { review: true, trigger: 'negative', reason: 'negative', flagged: true };
  }

  if (isFailedTask(payload.assistant_task_completion)) {
    return { review: true, trigger: 'failed_task', reason: 'failed_task', flagged: true };
  }

  if (isSampleSelected(payload.call_id, config.sampleRate)) {
    return { review: true, trigger: 'sample', reason: 'sample', flagged: false };
  }

  return { review: false, reason: 'not-selected', flagged: false };
}

export function shouldNotifySlackForAutoReview(input: {
  decision: QaAutoReviewDecision;
  pass: boolean;
  escalated: boolean;
}): boolean {
  if (process.env.QA_REVIEW_SLACK_ALL === 'true') {
    return true;
  }

  if (input.decision.flagged) {
    return true;
  }

  if (!input.pass) {
    return true;
  }

  if (input.escalated) {
    return true;
  }

  return false;
}

function resolveDurationSec(payload: AssistablePostCallPayload): number {
  if (typeof payload.call_time_seconds === 'number') {
    return payload.call_time_seconds;
  }
  if (typeof payload.call_time_ms === 'number') {
    return Math.floor(payload.call_time_ms / 1000);
  }
  return 0;
}

function collectTags(payload: AssistablePostCallPayload): string[] {
  const tags = [
    ...(payload.tags ?? []),
    ...(payload.contact_tags ?? []),
    ...(payload.ghl_tags ?? []),
  ];

  return tags.map(normalizeTag).filter(Boolean);
}

function hasErrorTags(tags: string[]): boolean {
  return tags.some((tag) => tag.startsWith(ERROR_TAG_PREFIX));
}

function hasAlwaysReviewTag(tags: string[], alwaysReviewTags: string[]): boolean {
  return alwaysReviewTags.some((tag) => tags.includes(tag));
}

function isNegativeSentiment(
  sentiment: string | undefined,
  negativeSentiments: string[],
): boolean {
  if (!sentiment) {
    return false;
  }

  return negativeSentiments.includes(sentiment.trim().toLowerCase());
}

function isFailedTask(taskCompletion: string | undefined): boolean {
  if (!taskCompletion) {
    return false;
  }

  const normalized = taskCompletion.trim().toLowerCase();
  return normalized !== 'success' && normalized !== 'complete' && normalized !== 'completed';
}

export function isSampleSelected(callId: string, sampleRate: number): boolean {
  if (sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }

  const hash = createHash('sha256').update(callId).digest();
  const bucket = hash.readUInt32BE(0) / 0xffffffff;
  return bucket < sampleRate;
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}
