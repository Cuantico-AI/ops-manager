import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  API_BASE_PATH,
  type AccountDetailResponse,
  type ApprovalDecision,
  type ApprovalsResponse,
  type AuditResponse,
  type FleetResponse,
  type QaDecision,
  type QaFlagsResponse,
  type QaHealthResponse,
  type RequestsResponse,
  type ResolveApprovalResponse,
  type ResolveQaFlagResponse,
} from '@cuantico/contracts';

const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ''}${API_BASE_PATH}`;

/** Poll cadence — mirrors the backend health-sweep rhythm rather than hammering. */
export const POLL_MS = 15_000;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const queryKeys = {
  fleet: ['fleet'] as const,
  requests: ['requests'] as const,
  approvals: ['approvals'] as const,
  qaFlags: ['qa', 'flags'] as const,
  qaHealth: ['qa', 'health'] as const,
  audit: ['audit'] as const,
  account: (id: string) => ['account', id] as const,
};

export function useFleet(): UseQueryResult<FleetResponse> {
  return useQuery({ queryKey: queryKeys.fleet, queryFn: () => getJson<FleetResponse>('/fleet'), refetchInterval: POLL_MS });
}

export function useRequests(): UseQueryResult<RequestsResponse> {
  return useQuery({
    queryKey: queryKeys.requests,
    queryFn: () => getJson<RequestsResponse>('/requests'),
    refetchInterval: POLL_MS,
  });
}

export function useApprovals(): UseQueryResult<ApprovalsResponse> {
  return useQuery({
    queryKey: queryKeys.approvals,
    queryFn: () => getJson<ApprovalsResponse>('/approvals'),
    refetchInterval: POLL_MS,
  });
}

export function useQaFlags(): UseQueryResult<QaFlagsResponse> {
  return useQuery({
    queryKey: queryKeys.qaFlags,
    queryFn: () => getJson<QaFlagsResponse>('/qa/flags'),
    refetchInterval: POLL_MS,
  });
}

export function useQaHealth(): UseQueryResult<QaHealthResponse> {
  return useQuery({
    queryKey: queryKeys.qaHealth,
    queryFn: () => getJson<QaHealthResponse>('/qa/health'),
    refetchInterval: POLL_MS,
  });
}

export function useAudit(): UseQueryResult<AuditResponse> {
  return useQuery({ queryKey: queryKeys.audit, queryFn: () => getJson<AuditResponse>('/audit'), refetchInterval: POLL_MS });
}

export function useAccountDetail(id: string | undefined): UseQueryResult<AccountDetailResponse> {
  return useQuery({
    queryKey: queryKeys.account(id ?? ''),
    queryFn: () => getJson<AccountDetailResponse>(`/accounts/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id),
  });
}

/** Approve/reject an approval. The server is authoritative; on success we
 * invalidate the affected queries so every view reflects the new state. */
export function useResolveApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: ApprovalDecision }) =>
      postJson<ResolveApprovalResponse>(`/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.approvals });
      void qc.invalidateQueries({ queryKey: queryKeys.requests });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
      void qc.invalidateQueries({ queryKey: queryKeys.fleet });
    },
  });
}

export function useResolveQaFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: QaDecision }) =>
      postJson<ResolveQaFlagResponse>(`/qa/flags/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.qaFlags });
      void qc.invalidateQueries({ queryKey: queryKeys.qaHealth });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}
