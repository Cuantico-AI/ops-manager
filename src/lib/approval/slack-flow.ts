import { getSlackClient } from '../../slack/client.js';
import type { ApprovalRecord } from './store.js';
import { getApprovalExpiryHours } from './store.js';

export function getApprovalsChannel(): string {
  return process.env.SLACK_APPROVALS_CHANNEL ?? '#ops-manager-approvals';
}

export function formatApprovalRequestMessage(approval: ApprovalRecord): string {
  return [
    'Approval required for a mutating ops action.',
    `Approval ID: ${approval.id}`,
    `Skill: ${approval.skill}`,
    `Target: ${approval.targetSummary}`,
    `Expires in: ${getApprovalExpiryHours()} hour(s) (${approval.expiresAt})`,
    '',
    'Proposed action:',
    '```',
    JSON.stringify(approval.proposedAction, null, 2),
    '```',
  ].join('\n');
}

export function formatApprovalResolvedMessage(
  approval: ApprovalRecord,
  status: 'approved' | 'rejected',
  resolvedBy: string,
): string {
  return [
    `Approval ${status}.`,
    `Approval ID: ${approval.id}`,
    `Skill: ${approval.skill}`,
    `Target: ${approval.targetSummary}`,
    `Resolved by: ${resolvedBy}`,
  ].join('\n');
}

export async function postApprovalRequest(approval: ApprovalRecord): Promise<string> {
  const client = getSlackClient();
  const result = await client.chat.postMessage({
    channel: getApprovalsChannel(),
    text: formatApprovalRequestMessage(approval),
    blocks: buildApprovalBlocks(approval),
  });

  if (!result.ok || !result.ts) {
    throw new Error(`Failed to post approval request: ${result.error ?? 'unknown error'}`);
  }

  return result.ts;
}

export async function updateApprovalMessage(
  approval: ApprovalRecord,
  status: 'approved' | 'rejected',
  resolvedBy: string,
): Promise<void> {
  if (!approval.slackMessageTs) {
    return;
  }

  const client = getSlackClient();
  await client.chat.update({
    channel: getApprovalsChannel(),
    ts: approval.slackMessageTs,
    text: formatApprovalResolvedMessage(approval, status, resolvedBy),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formatApprovalResolvedMessage(approval, status, resolvedBy),
        },
      },
    ],
  });
}

function buildApprovalBlocks(approval: ApprovalRecord) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: formatApprovalRequestMessage(approval),
      },
    },
    {
      type: 'actions',
      block_id: `approval_${approval.id}`,
      elements: [
        {
          type: 'button',
          action_id: 'approval_approve',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          value: approval.id,
        },
        {
          type: 'button',
          action_id: 'approval_reject',
          text: { type: 'plain_text', text: 'Reject' },
          style: 'danger',
          value: approval.id,
        },
      ],
    },
  ];
}
