import type { AccountStatus, AuditResult, RequestStatus } from '@cuantico/contracts';

export const STATUS_LABEL: Record<AccountStatus, string> = {
  healthy: 'Healthy',
  attention: 'Attention',
  down: 'Down',
  onboarding: 'Onboarding',
};

export function fmtAgo(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

export function fmtClock(min: number): string {
  const d = new Date(Date.now() - min * 60000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function shortIssue(s: string): string {
  return s.length > 52 ? `${s.slice(0, 50)}…` : s;
}

/** Maps a request status onto the status-pill visual vocabulary. */
export function requestStatusToPill(s: RequestStatus): AccountStatus | 'accent' {
  if (s === 'awaiting') return 'attention';
  if (s === 'progress') return 'healthy';
  if (s === 'done') return 'onboarding';
  if (s === 'triaging') return 'accent';
  return 'onboarding';
}

export function resultIcon(r: AuditResult): string {
  return r === 'ok' ? 'check' : r === 'fail' ? 'x' : r === 'pending' ? 'clock' : 'dot';
}

export function resultLabel(r: AuditResult): string {
  return r === 'ok' ? 'ok' : r === 'fail' ? 'fail' : r === 'pending' ? 'open' : 'info';
}
