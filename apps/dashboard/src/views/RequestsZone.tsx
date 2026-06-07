import { useMemo, useState } from 'react';
import type { Account, Request } from '@cuantico/contracts';
import { Icon } from '../components/Icon';
import { StatusDot, StatusPill } from '../components/atoms';
import { fmtAgo, requestStatusToPill } from '../lib/format';
import { CHAN_ICON, PRIO_COLOR, REQ_GROUPS, reqGroupLabel } from '../lib/requests';

interface RequestsZoneProps {
  requests: Request[];
  accountsByName: (name: string) => Account | undefined;
  onOpenApprovals: (approvalId?: string) => void;
  onOpenAccount: (a: Account) => void;
}

export function RequestsZone({ requests, accountsByName, onOpenApprovals, onOpenAccount }: RequestsZoneProps) {
  const [filter, setFilter] = useState<'active' | 'all' | 'awaiting'>('active');

  const visible = useMemo(
    () =>
      requests.filter((r) => {
        if (filter === 'active') return r.status !== 'done';
        if (filter === 'awaiting') return r.status === 'awaiting';
        return true;
      }),
    [requests, filter],
  );

  const grouped = REQ_GROUPS.map((g) => ({ ...g, items: visible.filter((r) => r.status === g.key) })).filter(
    (g) => g.items.length,
  );

  const awaitingN = requests.filter((r) => r.status === 'awaiting').length;

  return (
    <div className="zone">
      <div className="zone-head">
        <div className="zone-title">
          <Icon name="list" size={16} style={{ color: 'var(--accent-2)' }} />
          <h2>Client Requests</h2>
          <span className="count tnum">{visible.length}</span>
          <span className="grow" />
          <div className="seg">
            {(
              [
                ['active', 'Active'],
                ['awaiting', 'Awaiting'],
                ['all', 'All'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                {l}
                {k === 'awaiting' && <span className="scount tnum">{awaitingN}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="filters" style={{ marginTop: -2 }}>
          <div className="ap-meta" style={{ margin: 0, fontSize: 11 }}>
            <span className="gate">
              <Icon name="lock" size={12} /> Awaiting-approval items are gated by the Approval Gate
            </span>
          </div>
        </div>
      </div>

      <div className="zone-body">
        {grouped.map((g) => (
          <div className="req-group" key={g.key}>
            <div className="req-group-head">
              <span className="gicon" style={{ background: g.color }} />
              <h3>{g.label}</h3>
              <span className="gcount tnum">{g.items.length}</span>
            </div>
            {g.items.map((r) => {
              const a = accountsByName(r.acct);
              return (
                <div
                  className="req-row"
                  key={r.id}
                  onClick={() => (r.status === 'awaiting' ? onOpenApprovals(r.approvalId) : a && onOpenAccount(a))}
                >
                  <span className="req-prio" style={{ background: PRIO_COLOR[r.prio] }} />
                  <div className="req-main">
                    <div className="req-title">{r.title}</div>
                    <div className="req-sub">
                      <span className="req-acct">
                        {a && <StatusDot status={a.status} />}
                        {r.acct}
                      </span>
                      <span className="chan">
                        <Icon name={CHAN_ICON[r.chan]} size={11} />
                        {r.chan}
                      </span>
                      <span className="req-time">{fmtAgo(r.min)}</span>
                    </div>
                  </div>
                  <div className="req-right">
                    <StatusPill status={requestStatusToPill(r.status)} label={reqGroupLabel(r.status)} />
                    {r.status === 'awaiting' && (
                      <span
                        className="req-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenApprovals(r.approvalId);
                        }}
                      >
                        Review <Icon name="chevR" size={11} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="empty">
            <Icon name="check" size={30} />
            <div>Queue is clear.</div>
          </div>
        )}
      </div>
    </div>
  );
}
