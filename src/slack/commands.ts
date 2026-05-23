import { randomUUID } from 'node:crypto';
import type { App } from '@slack/bolt';
import {
  listStoredAccounts,
  syncGoogleSheetRoster,
  type AccountSummary,
  type RosterSyncSummary,
} from '../lib/accounts/google-sheet-roster.js';
import { auditLogger } from '../lib/audit/log.js';
import { approvalGate, isApprovalPendingError } from '../lib/approval/gate.js';
import {
  approveAndResumeJob,
  assertApprovalId,
  rejectApprovalRequest,
} from '../lib/approval/resume.js';
import { listRecentJobs } from '../lib/approval/store.js';
import { query } from '../lib/db/client.js';
import { ExternalServiceError } from '../lib/errors.js';
import {
  formatFleetDailyHealthOverview,
  type FleetDailyHealthChecks,
} from '../lib/health/fleet-daily-summary.js';
import { llmClient } from '../lib/llm/client.js';
import {
  checkN8nWorkflowHealthInputSchema,
  n8nCheckWorkflowHealthSkill,
  type CheckN8nWorkflowHealthOutput,
} from '../skills/n8n/check-workflow-health.js';
import {
  formatRefreshAssistableOAuthOutput,
  assistableRefreshOAuthSkill,
  refreshAssistableOAuthInputSchema,
  type RefreshAssistableOAuthOutput,
} from '../skills/assistable/refresh-oauth.js';
import {
  clientCheckinGenerateBriefSkill,
  formatClientCheckinBriefOutput,
  generateClientCheckinBriefInputSchema,
  parseClientCheckinCommandArgs,
  type GenerateClientCheckinBriefOutput,
} from '../skills/client-checkin/generate-brief.js';
import {
  clientCheckinGetBriefSkill,
  formatClientCheckinBriefRecordOutput,
  getClientCheckinBriefInputSchema,
  parseClientCheckinShowCommandArgs,
} from '../skills/client-checkin/get-brief.js';
import {
  clientCheckinListBriefsSkill,
  formatClientCheckinBriefHistoryOutput,
  listClientCheckinBriefsInputSchema,
  parseClientCheckinHistoryCommandArgs,
} from '../skills/client-checkin/list-briefs.js';
import {
  formatPromptOpsReviewRecordOutput,
  getPromptOpsReviewInputSchema,
  parsePromptOpsShowCommandArgs,
  promptOpsGetReviewSkill,
} from '../skills/prompt-ops/get-review.js';
import {
  formatPromptOpsReviewHistoryOutput,
  listPromptOpsReviewsInputSchema,
  parsePromptOpsHistoryCommandArgs,
  promptOpsListReviewsSkill,
} from '../skills/prompt-ops/list-reviews.js';
import {
  formatPromptOpsReviewOutput,
  parsePromptOpsCommandArgs,
  promptOpsReviewRequestSkill,
  reviewPromptOpsRequestInputSchema,
  type ReviewPromptOpsRequestOutput,
} from '../skills/prompt-ops/review-request.js';
import {
  formatQaReviewRecordOutput,
  getQaReviewInputSchema,
  parseQaShowCommandArgs,
  qaGetReviewSkill,
} from '../skills/qa/get-review.js';
import {
  formatQaReviewHistoryOutput,
  listQaReviewsInputSchema,
  parseQaHistoryCommandArgs,
  qaListReviewsSkill,
} from '../skills/qa/list-reviews.js';
import {
  formatQaFleetSummaryOutput,
  listFleetQaFailuresInputSchema,
  parseQaFleetSummaryCommandArgs,
  qaListFleetFailuresSkill,
} from '../skills/qa/list-fleet-failures.js';
import {
  formatQaReviewOutput,
  qaReviewTranscriptSkill,
  parseQaReviewCommandArgs,
  reviewTranscriptInputSchema,
  type ReviewTranscriptOutput,
} from '../skills/qa/review-transcript.js';
import {
  persistClientCheckinBrief,
  type ClientCheckinBriefRecord,
  type ListClientCheckinBriefsOutput,
} from '../lib/client-checkin/briefs.js';
import {
  persistPromptOpsReview,
  type ListPromptOpsReviewsOutput,
  type PromptOpsReviewRecord,
} from '../lib/prompt-ops/reviews.js';
import {
  type FleetQaSummary,
} from '../lib/qa/fleet-summary.js';
import {
  persistQaReview,
  type ListQaReviewsOutput,
  type QaReviewRecord,
} from '../lib/qa/reviews.js';
import {
  checkAssistableOAuthInputSchema,
  assistableCheckOAuthStatusSkill,
  type CheckAssistableOAuthOutput,
} from '../skills/assistable/check-oauth-status.js';
import {
  checkPitTokenInputSchema,
  ghlCheckPitTokenSkill,
  type CheckPitTokenOutput,
} from '../skills/ghl/check-pit-token.js';
import { formatGhlAccountSnapshot } from '../lib/ghl/snapshot.js';
import { formatGhlAccountInventory } from '../lib/ghl/inventory.js';
import {
  ghlInventoryInputSchema,
  ghlInventorySkill,
  type GhlInventoryOutput,
} from '../skills/ghl/inventory.js';
import {
  ghlSnapshotInputSchema,
  ghlSnapshotSkill,
  type GhlSnapshotOutput,
} from '../skills/ghl/snapshot.js';
import type { N8nAccountWorkflowCheckResult } from '../lib/accounts/n8n-workflow-health.js';
import { formatApprovalResumeResult } from '../lib/slack/format-approval-output.js';
import {
  formatSetCustomValueOutput,
  ghlSetCustomValueSkill,
  setCustomValueInputSchema,
  type SetCustomValueOutput,
} from '../skills/ghl/set-custom-value.js';
import {
  formatTriggerWorkflowOutput,
  n8nTriggerWorkflowSkill,
  triggerWorkflowInputSchema,
  type TriggerWorkflowOutput,
} from '../skills/n8n/trigger-workflow.js';
import { parseTriggerN8nCommandArgs } from './mutating-command-args.js';
import type { SkillRegistry } from '../skills/_registry.js';

import type { SkillContext } from '../skills/_types.js';

const startTime = Date.now();

export function registerCommands(app: App, registry: SkillRegistry): void {
  app.command('/ops', async ({ command, ack, respond }) => {
    await ack();

    const parts = command.text.trim().split(/\s+/).filter(Boolean);
    const subcommand = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1).join(' ');

    if (subcommand === 'ping' || subcommand === '') {
      const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      await respond({
        response_type: 'ephemeral',
        text: `pong — uptime: ${uptimeSeconds}s`,
      });
      return;
    }

    if (subcommand === 'accounts') {
      const accounts = await listStoredAccounts();

      await respond({
        response_type: 'ephemeral',
        text: formatAccountsSummary(accounts),
      });
      return;
    }

    if (subcommand === 'sync-roster' || subcommand === 'roster-sync') {
      try {
        const { summary, accounts } = await syncGoogleSheetRoster();
        await respond({
          response_type: 'ephemeral',
          text: formatRosterSyncSummary(summary, accounts),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Roster sync failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-tokens' || subcommand === 'check-pit-tokens') {
      try {
        const output = await runManualGhlTokenCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlTokenCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL token check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-assistable' || subcommand === 'check-assistable-oauth') {
      try {
        const output = await runManualAssistableOAuthCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatAssistableOAuthCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Assistable OAuth check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'check-n8n' || subcommand === 'check-n8n-workflows') {
      try {
        const output = await runManualN8nWorkflowCheck(args || undefined);
        await respond({
          response_type: 'ephemeral',
          text: formatN8nWorkflowCheckSummary(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `n8n workflow check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'fleet-health' || subcommand === 'daily-health') {
      try {
        const checks = await runManualFleetHealthCheck();
        await respond({
          response_type: 'ephemeral',
          text: formatFleetHealthCheckSummary(checks),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Fleet health check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'ghl-snapshot') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops ghl-snapshot <account name>',
        });
        return;
      }

      try {
        const snapshot = await runManualGhlSnapshot(args);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlAccountSnapshot(snapshot),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'ghl-inventory') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops ghl-inventory <account name>',
        });
        return;
      }

      try {
        const inventory = await runManualGhlInventory(args);
        await respond({
          response_type: 'ephemeral',
          text: formatGhlAccountInventory(inventory),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `GHL inventory failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'jobs') {
      try {
        const jobs = await listRecentJobs(20);
        await respond({
          response_type: 'ephemeral',
          text: formatRecentJobsSummary(jobs),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Jobs list failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'approve') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops approve <approval-id>',
        });
        return;
      }

      try {
        const approvalId = assertApprovalId(args);
        const output = await approveAndResumeJob(registry, approvalId, command.user_id);
        await respond({
          response_type: 'ephemeral',
          text: formatApprovalResumeResult(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Approve failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'reject') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops reject <approval-id>',
        });
        return;
      }

      try {
        const approvalId = assertApprovalId(args);
        await rejectApprovalRequest(approvalId, command.user_id);
        await respond({
          response_type: 'ephemeral',
          text: `Approval ${approvalId} rejected.`,
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Reject failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'set-custom-value') {
      if (parts.length < 4) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops set-custom-value <account name> <customValueId> <value>',
        });
        return;
      }

      const customValueId = parts[parts.length - 2] ?? '';
      const value = parts[parts.length - 1] ?? '';
      const accountQuery = parts.slice(1, -2).join(' ');

      try {
        const output = await runManualSetCustomValue({ accountQuery, customValueId, value });
        await respond({
          response_type: 'ephemeral',
          text: formatSetCustomValueOutput(output),
        });
      } catch (err) {
        if (isApprovalPendingError(err)) {
          await respond({
            response_type: 'ephemeral',
            text: [
              'Approval required before this write can run.',
              `Approval ID: ${err.approvalId}`,
              'Approve in #ops-manager-approvals or run `/ops approve <approval-id>`.',
            ].join('\n'),
          });
          return;
        }

        await respond({
          response_type: 'ephemeral',
          text: `Set custom value failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'trigger-n8n' || subcommand === 'trigger-n8n-workflow') {
      if (parts.length < 2) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops trigger-n8n <account name> [workflowId]',
        });
        return;
      }

      try {
        const parsed = parseTriggerN8nCommandArgs(parts);
        const output = await runManualTriggerN8nWorkflow(parsed);
        await respond({
          response_type: 'ephemeral',
          text: formatTriggerWorkflowOutput(output),
        });
      } catch (err) {
        if (isApprovalPendingError(err)) {
          await respond({
            response_type: 'ephemeral',
            text: [
              'Approval required before this workflow can run.',
              `Approval ID: ${err.approvalId}`,
              'Approve in #ops-manager-approvals or run `/ops approve <approval-id>`.',
            ].join('\n'),
          });
          return;
        }

        await respond({
          response_type: 'ephemeral',
          text: `Trigger n8n workflow failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'refresh-assistable' || subcommand === 'refresh-assistable-oauth') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops refresh-assistable <account name>',
        });
        return;
      }

      try {
        const output = await runManualRefreshAssistableOAuth(args);
        await respond({
          response_type: 'ephemeral',
          text: formatRefreshAssistableOAuthOutput(output),
        });
      } catch (err) {
        if (isApprovalPendingError(err)) {
          await respond({
            response_type: 'ephemeral',
            text: [
              'Approval required before Assistable OAuth can be refreshed.',
              `Approval ID: ${err.approvalId}`,
              'Approve in #ops-manager-approvals or run `/ops approve <approval-id>`.',
            ].join('\n'),
          });
          return;
        }

        await respond({
          response_type: 'ephemeral',
          text: `Refresh Assistable OAuth failed: ${formatRefreshAssistableOAuthCommandError(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'qa-review' || subcommand === 'qa') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops qa-review <account name> :: <transcript>',
        });
        return;
      }

      try {
        const output = await runManualQaReview(args);
        await respond({
          response_type: 'ephemeral',
          text: formatQaReviewOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `QA review failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'qa-history' || subcommand === 'qa-reviews') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops qa-history <account name> [limit]',
        });
        return;
      }

      try {
        const output = await runManualQaHistory(args);
        await respond({
          response_type: 'ephemeral',
          text: formatQaReviewHistoryOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `QA history failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'qa-failures' || subcommand === 'qa-fails') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops qa-failures <account name> [limit]',
        });
        return;
      }

      try {
        const output = await runManualQaHistory(args, { failingOnly: true });
        await respond({
          response_type: 'ephemeral',
          text: formatQaReviewHistoryOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `QA failures failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'qa-fleet-summary' ||
      subcommand === 'qa-fleet' ||
      subcommand === 'qa-fleet-failures'
    ) {
      try {
        const output = await runManualQaFleetSummary(args);
        await respond({
          response_type: 'ephemeral',
          text: formatQaFleetSummaryOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `QA fleet summary failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (subcommand === 'qa-show' || subcommand === 'qa-review-show') {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops qa-show <call_id>',
        });
        return;
      }

      try {
        const output = await runManualQaShow(args);
        await respond({
          response_type: 'ephemeral',
          text: formatQaReviewRecordOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `QA show failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'checkin-history' ||
      subcommand === 'check-in-history' ||
      subcommand === 'client-checkin-history' ||
      subcommand === 'client-checkins'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops checkin-history <account name> [limit]',
        });
        return;
      }

      try {
        const output = await runManualClientCheckinHistory(args);
        await respond({
          response_type: 'ephemeral',
          text: formatClientCheckinBriefHistoryOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Client check-in history failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
      return;
    }

    if (
      subcommand === 'checkin-show' ||
      subcommand === 'check-in-show' ||
      subcommand === 'client-checkin-show'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops checkin-show <brief_id>',
        });
        return;
      }

      try {
        const output = await runManualClientCheckinShow(args);
        await respond({
          response_type: 'ephemeral',
          text: formatClientCheckinBriefRecordOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Client check-in show failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'client-checkin' ||
      subcommand === 'client-check-in' ||
      subcommand === 'check-in'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops client-checkin <account name>',
        });
        return;
      }

      try {
        const output = await runManualClientCheckin(args);
        await respond({
          response_type: 'ephemeral',
          text: formatClientCheckinBriefOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Client check-in failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'prompt-ops' ||
      subcommand === 'promptops' ||
      subcommand === 'prompt-review'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops prompt-ops <account name> :: <prompt change request>',
        });
        return;
      }

      try {
        const output = await runManualPromptOpsReview(args);
        await respond({
          response_type: 'ephemeral',
          text: formatPromptOpsReviewOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Prompt Ops review failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'prompt-history' ||
      subcommand === 'prompt-ops-history' ||
      subcommand === 'prompt-reviews'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops prompt-history <account name> [limit]',
        });
        return;
      }

      try {
        const output = await runManualPromptOpsHistory(args);
        await respond({
          response_type: 'ephemeral',
          text: formatPromptOpsReviewHistoryOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Prompt Ops history failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    if (
      subcommand === 'prompt-show' ||
      subcommand === 'prompt-ops-show' ||
      subcommand === 'prompt-review-show'
    ) {
      if (!args) {
        await respond({
          response_type: 'ephemeral',
          text: 'Usage: /ops prompt-show <review_id>',
        });
        return;
      }

      try {
        const output = await runManualPromptOpsShow(args);
        await respond({
          response_type: 'ephemeral',
          text: formatPromptOpsReviewRecordOutput(output),
        });
      } catch (err) {
        await respond({
          response_type: 'ephemeral',
          text: `Prompt Ops show failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    await respond({
      response_type: 'ephemeral',
      text: `Unknown subcommand: ${subcommand}. Try /ops ping, /ops accounts, /ops sync-roster, /ops check-tokens, /ops check-assistable, /ops check-n8n, /ops fleet-health, /ops jobs, /ops approve, /ops set-custom-value, /ops trigger-n8n, /ops refresh-assistable, /ops qa-review, /ops qa-history, /ops qa-show, /ops client-checkin, /ops checkin-history, /ops checkin-show, /ops prompt-ops, /ops prompt-history, /ops prompt-show, /ops ghl-snapshot, or /ops ghl-inventory`,
    });
  });
}

export function formatRecentJobsSummary(
  jobs: Array<{
    id: string;
    agentId: string;
    triggerType: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>,
): string {
  if (jobs.length === 0) {
    return 'No recent jobs found.';
  }

  return [
    'Recent jobs:',
    ...jobs.map(
      (job) =>
        `• ${job.id} — ${job.status} (${job.triggerType}, started ${job.startedAt})${
          job.completedAt ? `, completed ${job.completedAt}` : ''
        }`,
    ),
  ].join('\n');
}

export { formatApprovalResumeResult } from '../lib/slack/format-approval-output.js';

export function formatAccountsSummary(accounts: AccountSummary[]): string {
  const activeCount = accounts.filter((account) => account.status === 'active').length;
  const missingTokenCount = accounts.filter(
    (account) => account.pitTokenStatus === 'missing',
  ).length;

  return [
    `Known accounts: ${accounts.length} (${activeCount} active)`,
    `GHL PIT tokens missing: ${missingTokenCount}`,
    '',
    ...accounts.slice(0, 20).map((account) => {
      const token = account.pitTokenStatus === 'stored' ? 'token stored' : 'token missing';
      return `• ${account.name} — ${account.status}, ${token}`;
    }),
    accounts.length > 20 ? `…and ${accounts.length - 20} more` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatRosterSyncSummary(
  summary: RosterSyncSummary,
  accounts: AccountSummary[],
): string {
  const missingTokenCount = accounts.filter(
    (account) => account.pitTokenStatus === 'missing',
  ).length;

  return [
    'GHL roster sync complete.',
    `Rows read: ${summary.totalRows}`,
    `Inserted: ${summary.inserted}`,
    `Updated: ${summary.updated}`,
    `Encrypted PIT tokens stored: ${summary.tokensStored}`,
    `Token references set: ${summary.tokenRefsSet}`,
    `Known accounts: ${accounts.length}`,
    `GHL PIT tokens missing: ${missingTokenCount}`,
  ].join('\n');
}

export function formatGhlTokenCheckSummary(output: CheckPitTokenOutput): string {
  const attention = output.results.filter((result) => result.status !== 'valid');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    return [
      'GHL PIT token check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      `Location ID: ${onlyResult.ghlLocationId ?? 'missing'}`,
      `HTTP status: ${onlyResult.httpStatus ?? 'n/a'}`,
      `Token fingerprint: ${
        onlyResult.tokenFingerprint ? `sha256:${onlyResult.tokenFingerprint}` : 'n/a'
      }`,
      onlyResult.status === 'valid'
        ? 'Note: valid means this PIT can read the LeadConnector location endpoint; narrower endpoint scopes may still fail.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'GHL PIT token check complete.',
    `Checked: ${output.summary.total}`,
    `Valid: ${output.summary.valid}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Invalid: ${output.summary.invalid}`,
    `Forbidden/scope issue: ${output.summary.forbidden}`,
    `Location not found: ${output.summary.notFound}`,
    `Missing token: ${output.summary.missingToken}`,
    `Missing location: ${output.summary.missingLocation}`,
    `Secret errors: ${output.summary.secretError}`,
    `Unreachable: ${output.summary.unreachable}`,
    attention.length ? '' : 'All checked accounts are valid.',
    ...attention.slice(0, 20).map((result) => `• ${result.accountName} — ${result.status}`),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAssistableOAuthCheckSummary(output: CheckAssistableOAuthOutput): string {
  const attention = output.results.filter((result) => result.status !== 'connected');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    return [
      'Assistable OAuth check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      `Assistable location ID: ${onlyResult.assistableLocationId ?? 'missing'}`,
      onlyResult.locationSource ? `Location source: ${onlyResult.locationSource}` : '',
      `HTTP status: ${onlyResult.httpStatus ?? 'n/a'}`,
      onlyResult.status === 'connected'
        ? 'Note: connected means Assistable sees a GHL access token for this location; a missing probe conversation is expected.'
        : '',
      onlyResult.message ? `Assistable message: ${onlyResult.message}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    'Assistable OAuth check complete.',
    `Checked: ${output.summary.total}`,
    `Connected: ${output.summary.connected}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Disconnected: ${output.summary.disconnected}`,
    `Not found: ${output.summary.notFound}`,
    `Missing location ID: ${output.summary.missingSubaccountId}`,
    `Auth errors: ${output.summary.authError}`,
    `Unreachable: ${output.summary.unreachable}`,
    attention.length ? '' : 'All checked accounts are connected.',
    ...attention.slice(0, 20).map((result) => `• ${result.accountName} — ${result.status}`),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatN8nWorkflowAttentionLine(result: N8nAccountWorkflowCheckResult): string {
  if (result.status === 'missing-workflow-ids') {
    return `• ${result.accountName} — no workflow IDs in roster`;
  }

  const badWorkflows = result.workflows.filter((workflow) =>
    ['failing', 'stale', 'not_found', 'unreachable', 'inactive'].includes(workflow.status),
  );
  const detail = badWorkflows
    .slice(0, 2)
    .map((workflow) => `${workflow.workflowId}: ${workflow.status}`)
    .join('; ');
  return `• ${result.accountName} — ${detail || result.status}`;
}

export function formatFleetHealthCheckSummary(checks: FleetDailyHealthChecks): string {
  return [
    formatFleetDailyHealthOverview(checks),
    '',
    '---',
    '',
    formatGhlTokenCheckSummary(checks.ghl),
    '',
    '---',
    '',
    formatAssistableOAuthCheckSummary(checks.assistable),
    '',
    '---',
    '',
    formatN8nWorkflowCheckSummary(checks.n8n),
  ].join('\n');
}

export function formatN8nWorkflowCheckSummary(output: CheckN8nWorkflowHealthOutput): string {
  const attention = output.results.filter((result) => result.status !== 'healthy');
  const onlyResult = output.results.length === 1 ? output.results[0] : undefined;

  if (onlyResult) {
    if (onlyResult.status === 'missing-workflow-ids') {
      return [
        'n8n workflow check complete.',
        `Account: ${onlyResult.accountName}`,
        'Status: missing-workflow-ids',
        'No n8n workflow IDs are stored for this account in the roster.',
      ].join('\n');
    }

    return [
      'n8n workflow check complete.',
      `Account: ${onlyResult.accountName}`,
      `Status: ${onlyResult.status}`,
      ...onlyResult.workflows.map((workflow) => {
        const lastRun = workflow.lastRunAt ? `, last run ${workflow.lastRunAt}` : '';
        const errors =
          workflow.recentErrors > 0 ? `, ${workflow.recentErrors} recent error(s)` : '';
        return `• ${workflow.workflowName} (${workflow.workflowId}) — ${workflow.status}${lastRun}${errors}`;
      }),
    ].join('\n');
  }

  return [
    'n8n workflow check complete.',
    `Checked: ${output.summary.total}`,
    `Healthy: ${output.summary.healthy}`,
    `Needs attention: ${output.summary.needsAttention}`,
    `Missing workflow IDs: ${output.summary.missingWorkflowIds}`,
    `Failing workflows: ${output.summary.failingWorkflows}`,
    `Stale workflows: ${output.summary.staleWorkflows}`,
    `Inactive workflows: ${output.summary.inactiveWorkflows}`,
    `Not found: ${output.summary.notFoundWorkflows}`,
    `Unreachable: ${output.summary.unreachableWorkflows}`,
    attention.length ? '' : 'All checked accounts with n8n workflows are healthy.',
    output.summary.notFoundWorkflows > 0 && output.summary.missingWorkflowIds === 0
      ? 'Tracked workflow IDs were not found in n8n. Verify real workflow IDs in the roster Sheet.'
      : '',
    ...attention.slice(0, 20).map((result) => formatN8nWorkflowAttentionLine(result)),
    attention.length > 20 ? `…and ${attention.length - 20} more needing attention` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runManualFleetHealthCheck(): Promise<FleetDailyHealthChecks> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops fleet-health' }),
      'running',
      JSON.stringify({ includeInactive: false }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const checkInput = { includeInactive: false };
    const [ghl, assistable, n8n] = await Promise.all([
      ghlCheckPitTokenSkill.execute(checkPitTokenInputSchema.parse(checkInput), ctx),
      assistableCheckOAuthStatusSkill.execute(
        checkAssistableOAuthInputSchema.parse(checkInput),
        ctx,
      ),
      n8nCheckWorkflowHealthSkill.execute(checkN8nWorkflowHealthInputSchema.parse(checkInput), ctx),
    ]);

    const checks = { ghl, assistable, n8n };
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        ghl: ghl.summary,
        assistable: assistable.summary,
        n8n: n8n.summary,
      }),
      jobId,
    ]);
    return checks;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualN8nWorkflowCheck(
  accountQuery?: string,
): Promise<CheckN8nWorkflowHealthOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-n8n', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const input = checkN8nWorkflowHealthInputSchema.parse({
      includeInactive: false,
      accountQuery,
    });
    const output = await n8nCheckWorkflowHealthSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualAssistableOAuthCheck(
  accountQuery?: string,
): Promise<CheckAssistableOAuthOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-assistable', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const input = checkAssistableOAuthInputSchema.parse({
      includeInactive: false,
      accountQuery,
    });
    const output = await assistableCheckOAuthStatusSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlTokenCheck(accountQuery?: string): Promise<CheckPitTokenOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops check-tokens', accountQuery }),
      'running',
      JSON.stringify({ includeInactive: false, accountQuery }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const input = checkPitTokenInputSchema.parse({ includeInactive: false, accountQuery });
    const output = await ghlCheckPitTokenSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({ summary: output.summary }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlInventory(accountQuery: string): Promise<GhlInventoryOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops ghl-inventory', accountQuery }),
      'running',
      JSON.stringify({ accountQuery }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const input = ghlInventoryInputSchema.parse({ accountQuery });
    const output = await ghlInventorySkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        workflowCount: output.workflows.length,
        customFieldCount: output.customFields.length,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualGhlSnapshot(accountQuery: string): Promise<GhlSnapshotOutput> {
  const jobId = randomUUID();
  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops ghl-snapshot', accountQuery }),
      'running',
      JSON.stringify({ accountQuery }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const input = ghlSnapshotInputSchema.parse({ accountQuery });
    const output = await ghlSnapshotSkill.execute(input, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        pipelineCount: output.pipelines.length,
        totalOpportunities: output.totalOpportunities,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualSetCustomValue(input: {
  accountQuery: string;
  customValueId: string;
  value: string;
}): Promise<SetCustomValueOutput> {
  const jobId = randomUUID();
  const parsedInput = setCustomValueInputSchema.parse(input);

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops set-custom-value', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await ghlSetCustomValueSkill.execute(parsedInput, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        customValueId: output.customValueId,
        value: output.customValue.value,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    const status = isApprovalPendingError(err) ? 'awaiting_approval' : 'failed';
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      status,
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
        approvalId: isApprovalPendingError(err) ? err.approvalId : undefined,
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualTriggerN8nWorkflow(input: {
  accountQuery: string;
  workflowId?: string;
}): Promise<TriggerWorkflowOutput> {
  const jobId = randomUUID();
  const parsedInput = triggerWorkflowInputSchema.parse(input);

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops trigger-n8n', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await n8nTriggerWorkflowSkill.execute(parsedInput, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        workflowId: output.workflowId,
        executionId: output.executionId,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    const status = isApprovalPendingError(err) ? 'awaiting_approval' : 'failed';
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      status,
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
        approvalId: isApprovalPendingError(err) ? err.approvalId : undefined,
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualRefreshAssistableOAuth(
  accountQuery: string,
): Promise<RefreshAssistableOAuthOutput> {
  const jobId = randomUUID();
  const parsedInput = refreshAssistableOAuthInputSchema.parse({ accountQuery });

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'system',
      'manual',
      JSON.stringify({ command: '/ops refresh-assistable', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'system',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await assistableRefreshOAuthSkill.execute(parsedInput, ctx);
    await query(`UPDATE jobs SET status = $1, output = $2, completed_at = NOW() WHERE id = $3`, [
      'succeeded',
      JSON.stringify({
        mode: output.mode,
        previousStatus: output.previousStatus,
        currentStatus: output.currentStatus,
      }),
      jobId,
    ]);
    return output;
  } catch (err) {
    const status = isApprovalPendingError(err) ? 'awaiting_approval' : 'failed';
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      status,
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
        approvalId: isApprovalPendingError(err) ? err.approvalId : undefined,
      }),
      jobId,
    ]);
    throw err;
  }
}

function formatRefreshAssistableOAuthCommandError(err: unknown): string {
  if (err instanceof ExternalServiceError) {
    return err.message;
  }

  return err instanceof Error ? err.message : String(err);
}

async function runManualQaReview(args: string): Promise<ReviewTranscriptOutput> {
  const parsedArgs = parseQaReviewCommandArgs(args);
  const parsedInput = reviewTranscriptInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'qa-review',
      'manual',
      JSON.stringify({
        command: '/ops qa-review',
        ...parsedInput,
        transcriptChars: parsedInput.transcript.length,
      }),
      'running',
      JSON.stringify({
        accountQuery: parsedInput.accountQuery,
        transcriptChars: parsedInput.transcript.length,
        callType: parsedInput.callType,
      }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await qaReviewTranscriptSkill.execute(parsedInput, ctx);
    const persistedReview = await persistQaReview({
      jobId,
      output,
      reviewTrigger: output.reviewTrigger ?? 'manual',
    });
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          qaReviewId: persistedReview.id,
          score: output.score,
          pass: output.pass,
          findingCount: output.findings.length,
          summary: output.summary,
          findings: output.findings,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualQaHistory(
  args: string,
  opts: { failingOnly?: boolean } = {},
): Promise<ListQaReviewsOutput> {
  const parsedArgs = parseQaHistoryCommandArgs(args, opts);
  const parsedInput = listQaReviewsInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'qa-review',
      'manual',
      JSON.stringify({
        command: parsedInput.failingOnly ? '/ops qa-failures' : '/ops qa-history',
        ...parsedInput,
      }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await qaListReviewsSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          accountId: output.accountId,
          accountName: output.accountName,
          reviewCount: output.reviews.length,
          failingOnly: output.failingOnly,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualQaFleetSummary(args: string): Promise<FleetQaSummary> {
  const parsedArgs = parseQaFleetSummaryCommandArgs(args);
  const parsedInput = listFleetQaFailuresInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'qa-review',
      'manual',
      JSON.stringify({
        command: '/ops qa-fleet-summary',
        ...parsedInput,
      }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await qaListFleetFailuresSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, completed_at = NOW()
       WHERE id = $3`,
      [
        'succeeded',
        JSON.stringify({
          sinceHours: output.sinceHours,
          totalReviews: output.totalReviews,
          failedReviews: output.failedReviews,
          passRate: output.passRate,
          failureCount: output.failures.length,
        }),
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualQaShow(args: string): Promise<QaReviewRecord> {
  const parsedArgs = parseQaShowCommandArgs(args);
  const parsedInput = getQaReviewInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'qa-review',
      'manual',
      JSON.stringify({ command: '/ops qa-show', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'qa-review',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await qaGetReviewSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          qaReviewId: output.id,
          accountId: output.accountId,
          accountName: output.accountName,
          callId: output.callId,
          score: output.score,
          pass: output.pass,
          findingCount: output.findings.length,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualClientCheckin(args: string): Promise<GenerateClientCheckinBriefOutput> {
  const parsedArgs = parseClientCheckinCommandArgs(args);
  const parsedInput = generateClientCheckinBriefInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'client-checkin',
      'manual',
      JSON.stringify({ command: '/ops client-checkin', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'client-checkin',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await clientCheckinGenerateBriefSkill.execute(parsedInput, ctx);
    const persistedBrief = await persistClientCheckinBrief({ jobId, output });
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          clientCheckinBriefId: persistedBrief.id,
          status: output.status,
          summary: output.summary,
          talkingPoints: output.talkingPoints,
          openIssues: output.openIssues,
          followUpQuestions: output.followUpQuestions,
          signals: output.signals,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualClientCheckinHistory(args: string): Promise<ListClientCheckinBriefsOutput> {
  const parsedArgs = parseClientCheckinHistoryCommandArgs(args);
  const parsedInput = listClientCheckinBriefsInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'client-checkin',
      'manual',
      JSON.stringify({ command: '/ops checkin-history', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'client-checkin',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await clientCheckinListBriefsSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          accountId: output.accountId,
          accountName: output.accountName,
          briefCount: output.briefs.length,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualClientCheckinShow(args: string): Promise<ClientCheckinBriefRecord> {
  const parsedArgs = parseClientCheckinShowCommandArgs(args);
  const parsedInput = getClientCheckinBriefInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'client-checkin',
      'manual',
      JSON.stringify({ command: '/ops checkin-show', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'client-checkin',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await clientCheckinGetBriefSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          clientCheckinBriefId: output.id,
          accountId: output.accountId,
          accountName: output.accountName,
          status: output.status,
          openIssueCount: output.openIssues.length,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualPromptOpsReview(args: string): Promise<ReviewPromptOpsRequestOutput> {
  const parsedArgs = parsePromptOpsCommandArgs(args);
  const parsedInput = reviewPromptOpsRequestInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'prompt-ops',
      'manual',
      JSON.stringify({
        command: '/ops prompt-ops',
        accountQuery: parsedInput.accountQuery,
        requestChars: parsedInput.request.length,
      }),
      'running',
      JSON.stringify({
        accountQuery: parsedInput.accountQuery,
        requestChars: parsedInput.request.length,
      }),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'prompt-ops',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await promptOpsReviewRequestSkill.execute(parsedInput, ctx);
    const persistedReview = await persistPromptOpsReview({ jobId, output });
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          promptOpsReviewId: persistedReview.id,
          riskLevel: output.riskLevel,
          blocked: output.blocked,
          summary: output.summary,
          intendedOutcome: output.intendedOutcome,
          recommendedChanges: output.recommendedChanges,
          testPlan: output.testPlan,
          rollbackPlan: output.rollbackPlan,
          clarifyingQuestions: output.clarifyingQuestions,
          blockers: output.blockers,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualPromptOpsHistory(args: string): Promise<ListPromptOpsReviewsOutput> {
  const parsedArgs = parsePromptOpsHistoryCommandArgs(args);
  const parsedInput = listPromptOpsReviewsInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'prompt-ops',
      'manual',
      JSON.stringify({ command: '/ops prompt-history', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'prompt-ops',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await promptOpsListReviewsSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          accountId: output.accountId,
          accountName: output.accountName,
          reviewCount: output.reviews.length,
          blockedOnly: output.blockedOnly,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}

async function runManualPromptOpsShow(args: string): Promise<PromptOpsReviewRecord> {
  const parsedArgs = parsePromptOpsShowCommandArgs(args);
  const parsedInput = getPromptOpsReviewInputSchema.parse(parsedArgs);
  const jobId = randomUUID();

  await query(
    `INSERT INTO jobs (id, agent_id, trigger_type, trigger_payload, status, input, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      jobId,
      'prompt-ops',
      'manual',
      JSON.stringify({ command: '/ops prompt-show', ...parsedInput }),
      'running',
      JSON.stringify(parsedInput),
    ],
  );

  const ctx: SkillContext = {
    jobId,
    agentId: 'prompt-ops',
    audit: auditLogger,
    approval: approvalGate,
    llm: llmClient,
  };

  try {
    const output = await promptOpsGetReviewSkill.execute(parsedInput, ctx);
    await query(
      `UPDATE jobs
       SET status = $1, output = $2, account_id = $3, completed_at = NOW()
       WHERE id = $4`,
      [
        'succeeded',
        JSON.stringify({
          promptOpsReviewId: output.id,
          accountId: output.accountId,
          accountName: output.accountName,
          riskLevel: output.riskLevel,
          blocked: output.blocked,
        }),
        output.accountId,
        jobId,
      ],
    );
    return output;
  } catch (err) {
    await query(`UPDATE jobs SET status = $1, error = $2, completed_at = NOW() WHERE id = $3`, [
      'failed',
      JSON.stringify({
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : 'Error',
      }),
      jobId,
    ]);
    throw err;
  }
}
