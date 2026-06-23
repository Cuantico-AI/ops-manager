import { z } from 'zod';
import { ExternalServiceError } from '../../lib/errors.js';
import { getSlackClient } from '../../slack/client.js';
import type { Skill, SkillContext } from '../_types.js';

export const postMessageInputSchema = z.object({
  channel: z.string().min(1),
  text: z.string().min(1),
  threadTs: z.string().min(1).optional(),
});

export type PostMessageInput = z.infer<typeof postMessageInputSchema>;
export type PostMessageOutput = { ts: string };

export const slackPostMessageSkill: Skill<PostMessageInput, PostMessageOutput> = {
  id: 'slack.post-message',
  description: 'Post a message to a Slack channel',
  mutates: false,
  requiresApproval: false,
  autonomousEligible: false,
  schema: postMessageInputSchema,
  async execute(input, ctx: SkillContext): Promise<PostMessageOutput> {
    const actor = ctx.agentId;

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor,
      action: 'slack.post-message',
      target: input.channel,
      mutated: false,
      input,
    });

    const client = getSlackClient();
    const result = await client.chat.postMessage({
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs,
    });

    if (!result.ok || !result.ts) {
      throw new ExternalServiceError(
        `Slack postMessage failed: ${result.error ?? 'unknown error'}`,
        'SLACK_POST_MESSAGE_FAILED',
      );
    }

    const output: PostMessageOutput = { ts: result.ts };

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor,
      action: 'slack.post-message',
      target: input.channel,
      mutated: false,
      output,
    });

    return output;
  },
};
