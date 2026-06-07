import type { AuditLogger } from './log.js';

/**
 * The truthful-audit invariant.
 *
 * A mutation must write to `audit_log` what it ACTUALLY did — success or
 * failure, with the real result — never an optimistic `mutated: true` record
 * written before the operation resolves.
 *
 * `wrapMutation` enforces this around a single mutating call:
 *
 *   1. Pre-attempt record (`mutated: false`) — intent, captured before the
 *      mutation runs. Honest: nothing has changed yet.
 *   2a. On success — a `mutated: true` record carrying the real result.
 *   2b. On failure — a `mutated: false` record carrying the error, then the
 *       error is re-thrown. A failed mutation never leaves a success record.
 *
 * Audit writes go through the existing {@link AuditLogger} (the INSERT+SELECT
 * `ops_app` path); this helper adds no new schema or role.
 */
export interface WrapMutationParams<T> {
  audit: AuditLogger;
  jobId: string;
  actor: string;
  action: string;
  target: string;
  approvalId?: string;
  /** Logged verbatim on the pre-attempt and failure records. */
  input?: unknown;
  /** Maps the successful result to the audit `output` payload. */
  output?: (result: T) => unknown;
}

export async function wrapMutation<T>(
  fn: () => Promise<T>,
  params: WrapMutationParams<T>,
): Promise<T> {
  const { audit, jobId, actor, action, target, approvalId, input, output } = params;

  await audit.log({
    jobId,
    actor,
    action,
    target,
    mutated: false,
    approvalId,
    input,
  });

  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await audit.log({
      jobId,
      actor,
      action,
      target,
      mutated: false,
      approvalId,
      input,
      output: { error: serializeMutationError(err) },
    });
    throw err;
  }

  await audit.log({
    jobId,
    actor,
    action,
    target,
    mutated: true,
    approvalId,
    output: output ? output(result) : undefined,
  });

  return result;
}

function serializeMutationError(err: unknown): {
  name: string;
  message: string;
  code?: string;
  detail?: unknown;
} {
  return {
    name: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
    code: (err as { code?: string })?.code,
    detail: (err as { detail?: unknown })?.detail,
  };
}
