import type {
  AccountDetailResponse,
  ApprovalDecision,
  ApprovalsResponse,
  AuditResponse,
  FleetResponse,
  QaDecision,
  QaFlagsResponse,
  QaHealthResponse,
  RequestsResponse,
  ResolveApprovalResponse,
  ResolveQaFlagResponse,
} from '@cuantico/contracts';

/**
 * The read API talks to a `ReadApiDataSource`, not directly to Postgres or the
 * mock dataset. This is the seam that lets us swap stubbed mock data for real
 * Postgres reads endpoint-by-endpoint without the dashboard ever changing — the
 * contract stays identical.
 */
export interface ReadApiDataSource {
  /** Human-readable label for diagnostics (e.g. "mock", "postgres"). */
  readonly label: string;

  getFleet(): Promise<FleetResponse>;
  getAccountDetail(accountId: string): Promise<AccountDetailResponse>;
  getRequests(): Promise<RequestsResponse>;
  getApprovals(): Promise<ApprovalsResponse>;
  resolveApproval(
    approvalId: string,
    decision: ApprovalDecision,
    operator: string,
  ): Promise<ResolveApprovalResponse>;
  getQaFlags(): Promise<QaFlagsResponse>;
  getQaHealth(): Promise<QaHealthResponse>;
  resolveQaFlag(
    flagId: string,
    decision: QaDecision,
    operator: string,
  ): Promise<ResolveQaFlagResponse>;
  getAudit(): Promise<AuditResponse>;
}
