import type { Channel, Priority, RequestStatus } from '@cuantico/contracts';

export interface ReqGroup {
  key: RequestStatus;
  label: string;
  color: string;
}

export const REQ_GROUPS: ReqGroup[] = [
  { key: 'new', label: 'New', color: 'var(--text-1)' },
  { key: 'triaging', label: 'Triaging', color: 'var(--accent)' },
  { key: 'awaiting', label: 'Awaiting Approval', color: 'var(--amber)' },
  { key: 'progress', label: 'In Progress', color: 'var(--green)' },
  { key: 'done', label: 'Done', color: 'var(--text-3)' },
];

export function reqGroupLabel(status: RequestStatus): string {
  return REQ_GROUPS.find((g) => g.key === status)?.label ?? status;
}

export const PRIO_COLOR: Record<Priority, string> = {
  high: 'var(--red)',
  med: 'var(--amber)',
  low: 'var(--gray)',
};

export const CHAN_ICON: Record<Channel, string> = {
  auto: 'zap',
  system: 'cpu',
  human: 'user',
  rule: 'flow',
};
