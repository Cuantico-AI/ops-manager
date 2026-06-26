import { randomUUID } from 'node:crypto';
import { resolveChannel } from '../lib/slack/channel.js';
import type { Worker } from 'bullmq';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate } from '../lib/approval/gate.js';
import { prisma } from '../lib/db/prisma.js'
import { childLogger } from '../lib/logger.js';
import { llmClient } from '../lib/llm/client.js';
import { type AssistablePostCallPayload, resolveCallType } from '../lib/qa/assistable-post-call.js';
import { resolveAccountByLocationId } from '../lib/qa/resolve-account-from-location.js';
import {
  getQaAutoReviewModel,
  shouldNotifySlackForAutoReview,
  type QaAutoReviewDecision,
} from '../lib/qa/review-policy.js';
import { formatAutoQaReviewSlackMessage } from '../lib/qa/slack-notify.js';
import { getQueue, getWorker } from '../lib/queue/client.js';
import { persistQaReview } from '../lib/qa/reviews.js';
import type { SkillRegistry } from '../skills/_registry.js';
import {
  runEscalatedQaReview,
  type ReviewTranscriptOutput,
} from '../skills/qa/review-transcript.js';
import { postMessageInputSchema } from '../skills/slack/post-message.js';
import type { SkillContext } from '../skills/_types.js';

export const QA_AUTO_REVIEW_QUEUE = 'qa-auto-review';

export interface QaAutoReviewJobData {
  payload: AssistablePostCallPayload;
  decision: QaAutoReviewDecision;
}

let qaAutoReviewWorker: Worker<QaAutoReviewJobData> | null = null;

export async function enqueueQaAutoReview(
  payload: AssistablePostCallPayload,
  decision: QaAutoReviewDecision,
): Promise<void> {
  const queue = getQueue(QA_AUTO_REVIEW_QUEUE);
  await queue.add(
    'qa-auto-review',
    { payload, decision },
    {
      jobId: payload.call_id,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}

export function registerQaAutoReviewWorker(registry: SkillRegistry): void {
  if (process.env.QA_AUTO_REVIEW_ENABLED !== 'true') {
    return;
  }

  getQueue(QA_AUTO_REVIEW_QUEUE);
  qaAutoReviewWorker = getWorker<QaAutoReviewJobData>(QA_AUTO_REVIEW_QUEUE, async (job) => {
    await runQaAutoReview(registry, job.data);
  });
}

export async function stopQaAutoReviewWorker(): Promise<void> {
  if (qaAutoReviewWorker) {
    await qaAutoReviewWorker.close();
    qaAutoReviewWorker = null;
  }
}

export async function runQaAutoReview(
  registry: SkillRegistry,
  data: QaAutoReviewJobData,
): Promise<ReviewTranscriptOutput> {
  const jobId = randomUUID();
  const log = childLogger({ jobId, callId: data.payload.call_id });
  const account = await resolveAccountByLocationId(data.payload.location_id!);
  const transcript = data.payload.full_transcript?.trim() ?? '';
  const primaryModel = getQaAutoReviewModel();

  log.info(
    {
      accountId: account.id,
      trigger: data.decision.trigger,
      sentiment: data.payload.user_sentiment,
    },
    'QA auto-review starting',
  );

  await prisma.jobs.create({
    data: {
      id: jobId,
      agent_id: 'qa-review',
      trigger_type: 'webhook',
      trigger_payload: JSON.stringify({
        source: 'assistable.post-call',
        callId: data.payload.call_id,
        trigger: data.decision.trigger,
      }),
      status: 'running',
      input: JSON.stringify({
        accountId: account.id,
        callId: data.payload.call_id,
        trigger: data.decision.trigger,
        transcriptChars: transcript.length,
        userSentiment: data.payload.user_sentiment,
      }),
      started_at: new Date(),
      account_id: account.id,
    },
  });

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    accountId: account.id,
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await runEscalatedQaReview(
      {
        accountId: account.id,
        accountName: account.name,
        transcript,
        callType: resolveCallType(data.payload),
        model: primaryModel,
        callId: data.payload.call_id,
        reviewTrigger: data.decision.trigger,
      },
      ctx.llm,
    );

    const escalated = output.modelUsed !== primaryModel;
    const persistedReview = await persistQaReview({
      jobId,
      output,
      reviewTrigger: data.decision.trigger,
      escalated,
    });

    await ctx.audit.log({
      jobId,
      actor: ctx.agentId,
      action: 'qa.review-transcript',
      target: account.id,
      mutated: false,
      input: {
        callId: data.payload.call_id,
        trigger: data.decision.trigger,
        transcriptChars: transcript.length,
        modelUsed: output.modelUsed,
        escalated,
      },
      output: {
        score: output.score,
        pass: output.pass,
        findingCount: output.findings.length,
      },
    });

    if (
      shouldNotifySlackForAutoReview({
        decision: data.decision,
        pass: output.pass,
        escalated,
      })
    ) {
      const channel = resolveChannel(
        [process.env.QA_REVIEW_SLACK_CHANNEL, process.env.SLACK_ALERTS_CHANNEL],
        '#ops-manager-alerts',
      );
      const skill = registry.get('slack.post-message');
      await skill.execute(
        postMessageInputSchema.parse({
          channel,
          text: formatAutoQaReviewSlackMessage({
            output,
            decision: data.decision,
            userSentiment: data.payload.user_sentiment,
            escalated,
          }),
        }),
        ctx,
      );
    }

    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        output: JSON.stringify({
          callId: data.payload.call_id,
          trigger: data.decision.trigger,
          score: output.score,
          pass: output.pass,
          modelUsed: output.modelUsed,
          escalated,
          qaReviewId: persistedReview.id,
          findingCount: output.findings.length,
          summary: output.summary,
          findings: output.findings,
        }),
        completed_at: new Date(),
      },
    });

    return output;
  } catch (err) {
    await prisma.jobs.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: JSON.stringify({
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : 'Error',
        }),
        completed_at: new Date(),
      },
    });
    throw err;
  }
}
