import { z } from 'zod';
import {
  listAccountsForAssistableOAuthCheck,
  resolveAssistableLocationId,
  saveAssistableOAuthCheckResult,
  type AccountAssistableOAuthStatus,
  type AssistableOAuthCheckResult,
} from '../../lib/accounts/assistable-oauth-health.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { query } from '../../lib/db/client.js';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { assistableClient, type AssistableClient } from '../../lib/assistable/client.js';
import type { Skill, SkillContext } from '../_types.js';

export const refreshAssistableOAuthInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type RefreshAssistableOAuthInput = z.infer<typeof refreshAssistableOAuthInputSchema>;

export interface RefreshAssistableOAuthOutput {
  accountId: string;
  accountName: string;
  assistableLocationId: string;
  locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
  previousStatus: AccountAssistableOAuthStatus | null;
  currentStatus: AccountAssistableOAuthStatus;
  refreshMessage?: string;
  refreshedAt: string;
}

export const assistableRefreshOAuthSkill: Skill<
  RefreshAssistableOAuthInput,
  RefreshAssistableOAuthOutput
> = {
  id: 'assistable.refresh-oauth',
  description: 'Refresh Assistable GHL OAuth for a disconnected account location',
  mutates: true,
  requiresApproval: true,
  schema: refreshAssistableOAuthInputSchema,
  async execute(input, ctx: SkillContext): Promise<RefreshAssistableOAuthOutput> {
    const account = await resolveAccountInput(input);
    const [assistableAccount] = await listAccountsForAssistableOAuthCheck({
      accountId: account.id,
      includeInactive: true,
    });
    if (!assistableAccount) {
      throw new NotFoundError(`Account not found: ${account.id}`);
    }

    const resolved = resolveAssistableLocationId(assistableAccount);
    if (!resolved) {
      throw new ValidationError(
        `Account "${account.name}" has no Assistable subaccount ID or GHL location ID`,
      );
    }

    const previousStatus = await readPreviousOAuthStatus(account.id);

    const targetSummary = `Refresh Assistable OAuth for ${account.name} (${resolved.locationId})`;
    const approval = await ctx.approval.gate({
      jobId: ctx.jobId,
      skill: 'assistable.refresh-oauth',
      targetSummary,
      proposedAction: {
        ...input,
        accountId: account.id,
        accountName: account.name,
        assistableLocationId: resolved.locationId,
        locationSource: resolved.source,
        previousStatus,
      },
    });

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'assistable.refresh-oauth',
      target: account.id,
      mutated: true,
      approvalId: approval.approvalId,
      input: {
        accountId: account.id,
        accountName: account.name,
        assistableLocationId: resolved.locationId,
        locationSource: resolved.source,
        previousStatus,
      },
    });

    const output = await refreshAndVerify(
      {
        accountId: account.id,
        accountName: account.name,
        assistableLocationId: resolved.locationId,
        locationSource: resolved.source,
        previousStatus,
      },
      assistableClient,
    );

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'assistable.refresh-oauth',
      target: account.id,
      mutated: true,
      approvalId: approval.approvalId,
      output: {
        previousStatus: output.previousStatus,
        currentStatus: output.currentStatus,
        refreshMessage: output.refreshMessage,
      },
    });

    return output;
  },
};

export function formatRefreshAssistableOAuthOutput(output: RefreshAssistableOAuthOutput): string {
  const lines = [
    'Assistable OAuth refresh completed.',
    `Account: ${output.accountName}`,
    `Location ID: ${output.assistableLocationId} (${output.locationSource})`,
    `Previous status: ${output.previousStatus ?? 'unknown'}`,
    `Current status: ${output.currentStatus}`,
    `Refreshed at: ${output.refreshedAt}`,
  ];

  if (output.refreshMessage) {
    lines.push(`Refresh response: ${output.refreshMessage}`);
  }

  if (output.currentStatus !== 'connected') {
    lines.push(
      'OAuth is still not connected. If refresh failed, reset the connection manually in Assistable (Agency-Level Settings > Reset Connection).',
    );
  }

  return lines.join('\n');
}

async function readPreviousOAuthStatus(accountId: string): Promise<AccountAssistableOAuthStatus | null> {
  const { rows } = await query<{ assistable_oauth_status: AccountAssistableOAuthStatus | null }>(
    `SELECT assistable_oauth_status FROM accounts WHERE id = $1`,
    [accountId],
  );

  return rows[0]?.assistable_oauth_status ?? null;
}

async function refreshAndVerify(
  input: {
    accountId: string;
    accountName: string;
    assistableLocationId: string;
    locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
    previousStatus: AccountAssistableOAuthStatus | null;
  },
  client: AssistableClient,
): Promise<RefreshAssistableOAuthOutput> {
  const refreshedAt = new Date().toISOString();
  const refresh = await client.refreshLocationOAuth({
    locationId: input.assistableLocationId,
  });

  if (!refresh.success) {
    if (refresh.routeNotFound) {
      throw new ExternalServiceError(
        refresh.message ??
          'Assistable refresh OAuth route is not available. Reset the connection manually in the Assistable dashboard (Agency-Level Settings > Reset Connection).',
        'ASSISTABLE_REFRESH_ROUTE_NOT_FOUND',
      );
    }

    throw new ExternalServiceError(
      refresh.message ?? 'Assistable OAuth refresh failed',
      'ASSISTABLE_REFRESH_FAILED',
    );
  }

  const verification = await client.checkLocationConnection({
    locationId: input.assistableLocationId,
  });
  const checkResult: AssistableOAuthCheckResult = {
    accountId: input.accountId,
    accountName: input.accountName,
    assistableLocationId: input.assistableLocationId,
    locationSource: input.locationSource,
    status: verification.status,
    httpStatus: verification.httpStatus,
    message: verification.message,
    checkedAt: refreshedAt,
  };
  await saveAssistableOAuthCheckResult(checkResult);

  return {
    accountId: input.accountId,
    accountName: input.accountName,
    assistableLocationId: input.assistableLocationId,
    locationSource: input.locationSource,
    previousStatus: input.previousStatus,
    currentStatus: verification.status,
    refreshMessage: refresh.message,
    refreshedAt,
  };
}
