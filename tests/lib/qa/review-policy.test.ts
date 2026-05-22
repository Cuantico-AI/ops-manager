import { describe, expect, it } from 'vitest';
import type { AssistablePostCallPayload } from '../../../src/lib/qa/assistable-post-call.js';
import {
  evaluateAutoReviewPolicy,
  isSampleSelected,
  type QaAutoReviewPolicyConfig,
} from '../../../src/lib/qa/review-policy.js';

const basePayload: AssistablePostCallPayload = {
  call_id: 'call_123',
  location_id: 'loc_abc',
  call_time_seconds: 120,
  full_transcript: 'Agent: Hello there. Customer: I am interested in learning more about your services today.',
  user_sentiment: 'positive',
  assistant_task_completion: 'success',
};

const enabledConfig: QaAutoReviewPolicyConfig = {
  enabled: true,
  minDurationSec: 90,
  minTranscriptChars: 50,
  sampleRate: 0,
  skipTags: ['voicemail reached', 'machine detected'],
  alwaysReviewTags: ['negative'],
  negativeSentiments: ['negative'],
};

describe('evaluateAutoReviewPolicy', () => {
  it('skips short calls', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, call_time_seconds: 30 },
      enabledConfig,
    );

    expect(decision.review).toBe(false);
    expect(decision.reason).toBe('too-short-duration');
  });

  it('skips voicemail-tagged calls', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, tags: ['voicemail reached'] },
      enabledConfig,
    );

    expect(decision.review).toBe(false);
    expect(decision.reason).toBe('skip-tag');
  });

  it('always reviews negative sentiment', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, user_sentiment: 'negative' },
      enabledConfig,
    );

    expect(decision.review).toBe(true);
    expect(decision.trigger).toBe('negative');
    expect(decision.flagged).toBe(true);
  });

  it('always reviews negative contact tags', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, contact_tags: ['Negative'] },
      enabledConfig,
    );

    expect(decision.review).toBe(true);
    expect(decision.trigger).toBe('negative');
    expect(decision.flagged).toBe(true);
  });

  it('always reviews ai_call_error tags', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, tags: ['ai_call_error_rate_limit'] },
      enabledConfig,
    );

    expect(decision.review).toBe(true);
    expect(decision.trigger).toBe('error');
    expect(decision.flagged).toBe(true);
  });

  it('always reviews failed assistant task completion', () => {
    const decision = evaluateAutoReviewPolicy(
      { ...basePayload, assistant_task_completion: 'failed' },
      enabledConfig,
    );

    expect(decision.review).toBe(true);
    expect(decision.trigger).toBe('failed_task');
    expect(decision.flagged).toBe(true);
  });

  it('samples eligible calls deterministically', () => {
    const sampledConfig = { ...enabledConfig, sampleRate: 1 };
    const decision = evaluateAutoReviewPolicy(basePayload, sampledConfig);

    expect(decision.review).toBe(true);
    expect(decision.trigger).toBe('sample');
    expect(decision.flagged).toBe(false);
  });
});

describe('isSampleSelected', () => {
  it('is deterministic for a call id', () => {
    expect(isSampleSelected('call_stable_id', 0.5)).toBe(isSampleSelected('call_stable_id', 0.5));
  });
});

describe('shouldNotifySlackForAutoReview', () => {
  it('does not notify Slack by default', async () => {
    const { shouldNotifySlackForAutoReview } = await import('../../../src/lib/qa/review-policy.js');
    delete process.env.QA_REVIEW_SLACK_ENABLED;

    expect(
      shouldNotifySlackForAutoReview({
        decision: { review: true, trigger: 'negative', reason: 'negative', flagged: true },
        pass: false,
        escalated: true,
      }),
    ).toBe(false);
  });

  it('notifies only on Sonnet escalation when mode is escalation', async () => {
    const { shouldNotifySlackForAutoReview } = await import('../../../src/lib/qa/review-policy.js');
    process.env.QA_REVIEW_SLACK_ENABLED = 'true';
    process.env.QA_REVIEW_SLACK_MODE = 'escalation';

    expect(
      shouldNotifySlackForAutoReview({
        decision: { review: true, trigger: 'negative', reason: 'negative', flagged: true },
        pass: false,
        escalated: false,
      }),
    ).toBe(false);

    expect(
      shouldNotifySlackForAutoReview({
        decision: { review: true, trigger: 'negative', reason: 'negative', flagged: true },
        pass: false,
        escalated: true,
      }),
    ).toBe(true);
  });
});
