import { z } from 'zod';
import {
  listAccountsForAssistableOAuthCheck,
  resolveAssistableLocationId,
  saveAssistableOAuthCheckResult,
  type AccountAssistableOAuthStatus,
  type AssistableOAuthCheckResult,
} from '../../lib/accounts/assistable-oauth-health.js';
import { resolveAccountInput } from '../../lib/accounts/resolve-account-input.js';
import { wrapMutation } from '../../lib/audit/wrap-mutation.js';
import { query } from '../../lib/db/client.js';
import { ExternalServiceError, NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  assistableClient,
  buildManualAssistableOAuthResetSteps,
  isAssistableRefreshOAuthConfigured,
  type AssistableClient,
} from '../../lib/assistable/client.js';
import type { Skill, SkillContext } from '../_types.js';

export const refreshAssistableOAuthInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  accountQuery: z.string().trim().min(1).optional(),
});

export type RefreshAssistableOAuthInput = z.infer<typeof refreshAssistableOAuthInputSchema>;

export interface RefreshAssistableOAuthOutput {
  mode: 'manual' | 'api';
  accountId: string;
  accountName: string;
  assistableLocationId: string;
  locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
  previousStatus: AccountAssistableOAuthStatus | null;
  currentStatus: AccountAssistableOAuthStatus;
  refreshMessage?: string;
  manualSteps?: string[];
  refreshedAt: string;
}

export const assistableRefreshOAuthSkill: Skill<
  RefreshAssistableOAuthInput,
  RefreshAssistableOAuthOutput
> = {
  id: 'assistable.refresh-oauth',
  description: 'Diagnose and reconnect Assistable GHL OAuth for an account',
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
    const checkedAt = new Date().toISOString();
    const currentCheck = await assistableClient.checkLocationConnection({
      locationId: resolved.locationId,
    });

    if (currentCheck.status === 'connected') {
      await saveAssistableOAuthCheckResult(
        buildCheckResult(
          {
            accountId: account.id,
            accountName: account.name,
            assistableLocationId: resolved.locationId,
            locationSource: resolved.source,
          },
          currentCheck,
          checkedAt,
        ),
      );

      const output: RefreshAssistableOAuthOutput = {
        mode: 'manual',
        accountId: account.id,
        accountName: account.name,
        assistableLocationId: resolved.locationId,
        locationSource: resolved.source,
        previousStatus,
        currentStatus: 'connected',
        refreshedAt: checkedAt,
      };

      await ctx.audit.log({
        jobId: ctx.jobId,
        actor: ctx.agentId,
        action: 'assistable.refresh-oauth',
        target: account.id,
        mutated: false,
        output: {
          mode: output.mode,
          currentStatus: output.currentStatus,
          skippedRefresh: true,
        },
      });

      return output;
    }

    await ctx.audit.log({
      jobId: ctx.jobId,
      actor: ctx.agentId,
      action: 'assistable.refresh-oauth',
      target: account.id,
      mutated: false,
      input: {
        accountId: account.id,
        accountName: account.name,
        assistableLocationId: resolved.locationId,
        locationSource: resolved.source,
        previousStatus,
        apiRefreshConfigured: isAssistableRefreshOAuthConfigured(),
      },
    });

    if (!isAssistableRefreshOAuthConfigured()) {
      const output = await runManualReconnectGuide(
        {
          accountId: account.id,
          accountName: account.name,
          assistableLocationId: resolved.locationId,
          locationSource: resolved.source,
          previousStatus,
          checkedAt,
        },
        assistableClient,
      );

      await ctx.audit.log({
        jobId: ctx.jobId,
        actor: ctx.agentId,
        action: 'assistable.refresh-oauth',
        target: account.id,
        mutated: false,
        output: {
          mode: output.mode,
          currentStatus: output.currentStatus,
        },
      });

      return output;
    }

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

    return wrapMutation(
      () =>
        refreshViaApi(
          {
            accountId: account.id,
            accountName: account.name,
            assistableLocationId: resolved.locationId,
            locationSource: resolved.source,
            previousStatus,
            checkedAt,
          },
          assistableClient,
        ),
      {
        audit: ctx.audit,
        jobId: ctx.jobId,
        actor: ctx.agentId,
        action: 'assistable.refresh-oauth',
        target: account.id,
        approvalId: approval.approvalId,
        input: {
          accountId: account.id,
          accountName: account.name,
          assistableLocationId: resolved.locationId,
          locationSource: resolved.source,
          previousStatus,
          mode: 'api',
        },
        output: (out) => ({
          mode: out.mode,
          previousStatus: out.previousStatus,
          currentStatus: out.currentStatus,
          refreshMessage: out.refreshMessage,
        }),
      },
    );
  },
};

export function formatRefreshAssistableOAuthOutput(output: RefreshAssistableOAuthOutput): string {
  if (output.mode === 'manual') {
    const lines = [
      'Assistable OAuth reconnect guide.',
      `Account: ${output.accountName}`,
      `Location ID: ${output.assistableLocationId} (${output.locationSource})`,
      `Previous status: ${output.previousStatus ?? 'unknown'}`,
      `Current status: ${output.currentStatus}`,
      `Checked at: ${output.refreshedAt}`,
      '',
      ...(output.manualSteps ?? []),
    ];

    if (output.currentStatus === 'connected') {
      lines.push('', 'No manual reset is needed — OAuth is already connected.');
    }

    return lines.join('\n');
  }

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
      'OAuth is still not connected. Reset the connection manually in Assistable (Agency-Level Settings > Reset Connection), then run `/ops check-assistable ' +
        output.accountName +
        '`.',
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

async function runManualReconnectGuide(
  input: {
    accountId: string;
    accountName: string;
    assistableLocationId: string;
    locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
    previousStatus: AccountAssistableOAuthStatus | null;
    checkedAt: string;
  },
  client: AssistableClient,
): Promise<RefreshAssistableOAuthOutput> {
  const verification = await client.checkLocationConnection({
    locationId: input.assistableLocationId,
  });
  await saveAssistableOAuthCheckResult(buildCheckResult(input, verification, input.checkedAt));

  return {
    mode: 'manual',
    accountId: input.accountId,
    accountName: input.accountName,
    assistableLocationId: input.assistableLocationId,
    locationSource: input.locationSource,
    previousStatus: input.previousStatus,
    currentStatus: verification.status,
    manualSteps: buildManualAssistableOAuthResetSteps(
      input.accountName,
      input.assistableLocationId,
    ),
    refreshedAt: input.checkedAt,
  };
}

async function refreshViaApi(
  input: {
    accountId: string;
    accountName: string;
    assistableLocationId: string;
    locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
    previousStatus: AccountAssistableOAuthStatus | null;
    checkedAt: string;
  },
  client: AssistableClient,
): Promise<RefreshAssistableOAuthOutput> {
  const refresh = await client.refreshLocationOAuth({
    locationId: input.assistableLocationId,
  });

  if (!refresh.success) {
    if (refresh.routeNotFound) {
      throw new ExternalServiceError(
        refresh.message ??
          'Assistable OAuth refresh is not available via API. Reset the connection manually in the Assistable dashboard (Agency-Level Settings > Reset Connection).',
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
  await saveAssistableOAuthCheckResult(buildCheckResult(input, verification, input.checkedAt));

  return {
    mode: 'api',
    accountId: input.accountId,
    accountName: input.accountName,
    assistableLocationId: input.assistableLocationId,
    locationSource: input.locationSource,
    previousStatus: input.previousStatus,
    currentStatus: verification.status,
    refreshMessage: refresh.message,
    refreshedAt: input.checkedAt,
  };
}

function buildCheckResult(
  input: {
    accountId: string;
    accountName: string;
    assistableLocationId: string;
    locationSource: 'assistable-subaccount-id' | 'ghl-location-id';
  },
  verification: {
    status: AccountAssistableOAuthStatus;
    httpStatus?: number;
    message?: string;
  },
  checkedAt: string,
): AssistableOAuthCheckResult {
  return {
    accountId: input.accountId,
    accountName: input.accountName,
    assistableLocationId: input.assistableLocationId,
    locationSource: input.locationSource,
    status: verification.status,
    httpStatus: verification.httpStatus,
    message: verification.message,
    checkedAt,
  };
}
