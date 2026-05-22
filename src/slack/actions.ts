import type { App } from '@slack/bolt';
import {
  approveAndResumeJob,
  assertApprovalId,
  rejectApprovalRequest,
} from '../lib/approval/resume.js';
import { formatApprovalResumeResult } from '../lib/slack/format-approval-output.js';
import type { SkillRegistry } from '../skills/_registry.js';

export function registerActions(app: App, registry: SkillRegistry): void {
  app.action('approval_approve', async ({ ack, action, body, respond }) => {
    await ack();

    if (!('value' in action) || !action.value) {
      await respond?.({
        response_type: 'ephemeral',
        text: 'Approval button is missing an approval ID.',
        replace_original: false,
      });
      return;
    }

    const userId = 'user' in body && body.user ? body.user.id : 'unknown';

    try {
      const approvalId = assertApprovalId(action.value);
      const output = await approveAndResumeJob(registry, approvalId, userId);
      const text = formatApprovalResumeResult(output);

      await respond?.({
        response_type: 'ephemeral',
        text,
        replace_original: false,
      });
    } catch (err) {
      await respond?.({
        response_type: 'ephemeral',
        text: `Approval failed: ${err instanceof Error ? err.message : String(err)}`,
        replace_original: false,
      });
    }
  });

  app.action('approval_reject', async ({ ack, action, body, respond }) => {
    await ack();

    if (!('value' in action) || !action.value) {
      await respond?.({
        response_type: 'ephemeral',
        text: 'Reject button is missing an approval ID.',
        replace_original: false,
      });
      return;
    }

    const userId = 'user' in body && body.user ? body.user.id : 'unknown';

    try {
      const approvalId = assertApprovalId(action.value);
      await rejectApprovalRequest(approvalId, userId);
      await respond?.({
        response_type: 'ephemeral',
        text: `Approval ${approvalId} rejected.`,
        replace_original: false,
      });
    } catch (err) {
      await respond?.({
        response_type: 'ephemeral',
        text: `Reject failed: ${err instanceof Error ? err.message : String(err)}`,
        replace_original: false,
      });
    }
  });
}
