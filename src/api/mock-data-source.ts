import type {
  Account,
  AccountDetailResponse,
  Approval,
  ApprovalDecision,
  ApprovalsResponse,
  AuditEntry,
  AuditResponse,
  FleetResponse,
  QaDecision,
  QaFlag,
  QaFlagsResponse,
  QaHealth,
  QaHealthResponse,
  Request,
  RequestsResponse,
  ResolveApprovalResponse,
  ResolveQaFlagResponse,
  TimelineEvent,
} from '@cuantico/contracts';
import { NotFoundError } from '../lib/errors.js';
import type { ReadApiDataSource } from './data-source.js';
import {
  MOCK_ACCOUNTS,
  MOCK_APPROVALS,
  MOCK_AUDIT,
  MOCK_QA_FLAGS,
  MOCK_QA_HEALTH,
  MOCK_REQUESTS,
  computeRollup,
} from './mock-data.js';

/**
 * In-memory data source backed by the mock dataset. Mutations (approve/reject,
 * QA confirm/dismiss) are applied to the in-memory state and prepend a synthetic
 * audit entry, mirroring the prototype's resolve handlers so the dashboard
 * behaves identically against this source.
 */
export class MockReadApiDataSource implements ReadApiDataSource {
  readonly label = 'mock';

  private accounts: Account[] = clone(MOCK_ACCOUNTS);
  private requests: Request[] = clone(MOCK_REQUESTS);
  private approvals: Approval[] = clone(MOCK_APPROVALS);
  private flags: QaFlag[] = clone(MOCK_QA_FLAGS);
  private health: QaHealth[] = clone(MOCK_QA_HEALTH);
  private audit: AuditEntry[] = clone(MOCK_AUDIT);

  getFleet(): Promise<FleetResponse> {
    return Promise.resolve({
      accounts: clone(this.accounts),
      rollup: computeRollup(
        this.accounts,
        this.requests,
        this.approvals,
        this.flags,
        this.health,
      ),
      syncedAt: new Date().toISOString(),
    });
  }

  getAccountDetail(accountId: string): Promise<AccountDetailResponse> {
    const account = this.accounts.find((a) => a.id === accountId || a.name === accountId);
    if (!account) {
      throw new NotFoundError(`Account not found: ${accountId}`);
    }

    const qa = this.health.find((q) => q.acct === account.name) ?? null;
    const recentActions = this.audit.filter((e) => e.acct === account.name).slice(0, 8);
    const openRequests = this.requests.filter(
      (r) => r.acct === account.name && r.status !== 'done',
    );
    const timeline: TimelineEvent[] = recentActions
      .slice(0, 6)
      .map((e) => ({ text: e.action, ts: e.ts, result: e.result }));

    return Promise.resolve({
      account: clone(account),
      qa: qa ? clone(qa) : null,
      timeline,
      recentActions: clone(recentActions),
      openRequests: clone(openRequests),
    });
  }

  getRequests(): Promise<RequestsResponse> {
    return Promise.resolve({ requests: clone(this.requests) });
  }

  getApprovals(): Promise<ApprovalsResponse> {
    return Promise.resolve({ approvals: clone(this.approvals) });
  }

  resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
    operator: string,
  ): Promise<ResolveApprovalResponse> {
    const approval = this.approvals.find((a) => a.id === approvalId);
    if (!approval) {
      throw new NotFoundError(`Approval not found: ${approvalId}`);
    }

    this.approvals = this.approvals.filter((a) => a.id !== approvalId);

    let updatedRequest: Request | null = null;
    this.requests = this.requests.map((r) => {
      if (r.approvalId !== approvalId) return r;
      const next: Request = {
        ...r,
        status: decision === 'approve' ? 'progress' : 'triaging',
        approvalId: undefined,
        min: 0,
      };
      updatedRequest = next;
      return next;
    });

    const entry = this.prependAudit({
      acct: approval.acct,
      action: `${decision === 'approve' ? 'Approved' : 'Rejected'}: ${approval.verb}`,
      detail:
        decision === 'approve'
          ? approval.diff.map((d) => `${d.k} → ${d.to}`).join(' · ')
          : 'operator declined — no change applied',
      trigger: 'operator',
      who: operator,
      result: decision === 'approve' ? 'ok' : 'info',
    });

    return Promise.resolve({
      approvalId,
      decision,
      request: updatedRequest,
      auditEntry: entry,
    });
  }

  getQaFlags(): Promise<QaFlagsResponse> {
    return Promise.resolve({ flags: clone(this.flags) });
  }

  getQaHealth(): Promise<QaHealthResponse> {
    return Promise.resolve({ health: clone(this.health) });
  }

  resolveQaFlag(
    flagId: string,
    decision: QaDecision,
    operator: string,
  ): Promise<ResolveQaFlagResponse> {
    const flag = this.flags.find((f) => f.id === flagId);
    if (!flag) {
      throw new NotFoundError(`QA flag not found: ${flagId}`);
    }

    this.flags = this.flags.filter((f) => f.id !== flagId);

    const entry = this.prependAudit({
      acct: flag.acct,
      action: `${decision === 'confirm' ? 'QA flag confirmed' : 'QA flag dismissed'} — ${flag.category}`,
      detail:
        decision === 'confirm'
          ? 'real issue · assistant flagged for tuning · added to QA training set'
          : 'marked false positive · fed back to QA tuning set',
      trigger: 'operator',
      who: operator,
      result: decision === 'confirm' ? 'pending' : 'info',
    });

    return Promise.resolve({ flagId, decision, auditEntry: entry });
  }

  getAudit(): Promise<AuditResponse> {
    return Promise.resolve({ entries: clone(this.audit) });
  }

  private prependAudit(
    partial: Pick<AuditEntry, 'acct' | 'action' | 'detail' | 'trigger' | 'who' | 'result'>,
  ): AuditEntry {
    const head = this.audit[0];
    const entry: AuditEntry = {
      ...partial,
      seq: (head?.seq ?? 0) + 1,
      min: 0,
      ts: 'just now',
      hash: randomHash(),
      prev: head?.hash ?? '00000000',
    };
    this.audit = [entry, ...this.audit];
    return entry;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomHash(): string {
  return `00000000${Math.floor(Math.random() * 0xffffffff).toString(16)}`.slice(-8);
}
