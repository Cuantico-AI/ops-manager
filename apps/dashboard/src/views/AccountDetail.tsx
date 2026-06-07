import type { Account, AccountDetailResponse, AuditResult } from '@cuantico/contracts';
import { type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { StatusDot, StatusPill, VTag } from '../components/atoms';
import { fmtAgo, requestStatusToPill, resultIcon } from '../lib/format';
import { reqGroupLabel } from '../lib/requests';
import { QAHealthPanel } from './QAView';

function pitMeta(a: Account): { color: string; label: string; sub: string; pct: number } {
  if (a.pit === 'expired') return { color: 'var(--red)', label: 'Expired', sub: 'rotate now', pct: 0 };
  // pitDays is null when days-to-expiry isn't tracked yet — show the real status
  // without faking a countdown.
  if (a.pitDays === null) {
    const valid = a.pit === 'valid';
    return {
      color: valid ? 'var(--green)' : 'var(--amber)',
      label: valid ? 'Valid' : 'Expiring',
      sub: 'expiry not tracked',
      pct: valid ? 100 : 40,
    };
  }
  if (a.pit === 'expiring')
    return { color: 'var(--amber)', label: 'Expiring', sub: `${a.pitDays} days left`, pct: Math.max(8, (a.pitDays / 90) * 100) };
  return { color: 'var(--green)', label: 'Valid', sub: `${a.pitDays} days left`, pct: (a.pitDays / 90) * 100 };
}

const RESULT_COLOR: Record<AuditResult, string> = {
  ok: 'var(--green)',
  fail: 'var(--red)',
  pending: 'var(--amber)',
  info: 'var(--text-3)',
};

interface AccountDetailProps {
  detail: AccountDetailResponse;
  onBack: () => void;
  onOpenApprovals: (approvalId?: string) => void;
  onOpenQA: () => void;
}

export function AccountDetail({ detail, onBack, onOpenApprovals, onOpenQA }: AccountDetailProps) {
  const a = detail.account;
  const pit = pitMeta(a);
  const max = Math.max(1, ...a.spark);
  const openReqs = detail.openRequests;

  return (
    <div className="detail fadein">
      <div className="detail-inner">
        <span className="backlink" onClick={onBack}>
          <Icon name="chevL" size={15} /> Fleet
        </span>

        <div className="detail-head">
          <div className="dh-logo" style={{ background: `linear-gradient(150deg,${a.tint[0]},${a.tint[1]})` }}>
            {a.initials}
          </div>
          <div>
            <h1>
              {a.name} <StatusPill status={a.status} />
            </h1>
            <div className="dh-meta">
              <VTag vert={a.vert} label={a.vertLabel} />
              <span className="mono">{a.id}</span>
              <span className="mono">GHL {a.locationId ?? '—'}</span>
              <span>· last activity {a.lastActivity}</span>
            </div>
          </div>
          <div className="detail-actions">
            <button className="gbtn">
              <Icon name="external" size={14} /> Open in GHL
            </button>
            <button className="gbtn">
              <Icon name="refresh" size={14} /> Re-poll
            </button>
            {a.issue && a.status !== 'healthy' && (
              <button className="gbtn primary" onClick={() => onOpenApprovals(undefined)}>
                <Icon name="shield" size={14} /> Resolve
              </button>
            )}
          </div>
        </div>

        {a.issue && a.status !== 'healthy' && (
          <div
            className="panel"
            style={{ borderColor: a.status === 'down' ? 'var(--red-bd)' : 'var(--amber-bd)', marginBottom: 18 }}
          >
            <div className="panel-head" style={{ borderBottom: 0 }}>
              <Icon name="alert" size={16} style={{ color: a.status === 'down' ? 'var(--red)' : 'var(--amber)' }} />
              <h3 style={{ color: a.status === 'down' ? 'var(--red)' : 'var(--amber)' }}>
                {a.status === 'down' ? 'Service disruption' : 'Needs attention'}
              </h3>
              <span className="grow" />
              <span style={{ fontSize: 12, color: 'var(--text-1)' }}>{a.issue}</span>
            </div>
          </div>
        )}

        <div className="dgrid">
          <IntegrationCard
            logo="GHL"
            tint="#ffb43e"
            title="GHL Private Integration"
            sub={a.locationId ?? '—'}
            status={a.pit === 'expired' ? 'down' : a.pit === 'expiring' ? 'attention' : 'healthy'}
            rows={[
              ['Token', <span key="t"><span style={{ color: pit.color }}>● </span>{pit.label}</span>],
              ['Expires', pit.sub],
              ['Scopes', 'contacts, convos, calendars'],
              ['Last rotated', a.pit === 'valid' ? '34d ago' : '92d ago'],
            ]}
            bar={{ pct: pit.pct, color: pit.color }}
          />

          <IntegrationCard
            logo="A"
            tint="#36c08a"
            title="Assistable"
            sub={a.assistantId ?? 'not provisioned'}
            status={a.assistable === 'disconnected' ? 'down' : 'healthy'}
            rows={[
              [
                'Connection',
                a.assistable === 'connected' ? (
                  <span key="c" style={{ color: 'var(--green)' }}>● Connected</span>
                ) : (
                  <span key="c" style={{ color: 'var(--red)' }}>● Disconnected</span>
                ),
              ],
              ['Assistant', a.assistantId ?? '—'],
              ['Minute usage', a.minuteCap === null ? 'not tracked' : `${a.minuteCap}% of cap`],
              ['Last call', a.assistable === 'connected' ? a.lastActivity : '—'],
            ]}
            bar={a.minuteCap === null ? null : { pct: a.minuteCap, color: a.minuteCap > 90 ? 'var(--amber)' : 'var(--accent)' }}
          />

          <IntegrationCard
            logo="n8"
            tint="#c08cff"
            title="n8n Workflows"
            sub={a.n8n === 'none' ? 'none configured' : `${a.n8nCount} workflows`}
            status={a.n8n === 'none' ? 'onboarding' : a.n8nErr ? 'attention' : 'healthy'}
            rows={
              a.n8n === 'none'
                ? [
                    ['Status', <span key="s" style={{ color: 'var(--text-2)' }}>Not configured</span>],
                    ['Workflows', '0'],
                    ['Action', 'awaiting build'],
                  ]
                : [
                    ['Active', `${a.n8nCount} workflows`],
                    [
                      'Health',
                      a.n8nErr ? (
                        <span key="h" style={{ color: 'var(--amber)' }}>● 1 erroring</span>
                      ) : (
                        <span key="h" style={{ color: 'var(--green)' }}>● all passing</span>
                      ),
                    ],
                    ['Runs (24h)', `${a.spark.reduce((s, v) => s + v, 0)}`],
                    ['Last run', a.lastActivity],
                  ]
            }
            bar={a.n8n === 'none' ? null : { pct: a.n8nErr ? 70 : 100, color: a.n8nErr ? 'var(--amber)' : 'var(--green)' }}
          />
        </div>

        <QAHealthPanel qa={detail.qa} onOpenQA={onOpenQA} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="panel">
            <div className="panel-head">
              <Icon name="pulse" size={15} style={{ color: 'var(--accent-2)' }} />
              <h3>Health timeline</h3>
              <span className="grow" />
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>last 7 days</span>
            </div>
            <div className="timeline">
              <div className="tl-spark">
                {a.spark.map((v, i) => (
                  <div
                    key={i}
                    className="tlb"
                    title={`${v} runs`}
                    style={{
                      height: `${Math.max(4, (v / max) * 100)}%`,
                      background: a.status === 'down' ? 'var(--red)' : a.status === 'attention' ? 'var(--amber)' : 'var(--accent)',
                      opacity: 0.55 + 0.45 * (v / max),
                    }}
                  />
                ))}
              </div>
              <div className="tl-axis">
                <span>7d ago</span>
                <span>6d</span>
                <span>5d</span>
                <span>4d</span>
                <span>3d</span>
                <span>2d</span>
                <span>today</span>
              </div>
              <div className="tl-events">
                {detail.timeline.length === 0 && (
                  <div className="empty" style={{ padding: '20px' }}>
                    No timeline events yet.
                  </div>
                )}
                {detail.timeline.map((e, i) => (
                  <div className="tl-event" key={i}>
                    <span className="tl-node" style={{ background: RESULT_COLOR[e.result] }} />
                    <span className="tl-txt">
                      <b>{e.text}</b>
                    </span>
                    <span className="tl-time">{e.ts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="panel">
              <div className="panel-head">
                <Icon name="history" size={15} style={{ color: 'var(--accent-2)' }} />
                <h3>Recent actions</h3>
                <span className="grow" />
                <span className="imm">
                  <Icon name="lock" size={12} /> immutable
                </span>
              </div>
              <div className="loglist">
                {detail.recentActions.length === 0 && (
                  <div className="empty" style={{ padding: '26px' }}>
                    No recent actions logged.
                  </div>
                )}
                {detail.recentActions.slice(0, 5).map((e, i) => (
                  <div className="logrow" key={i}>
                    <span className="lt">{e.ts || fmtAgo(e.min)}</span>
                    <div className="lmid">
                      <div className="la">{e.action}</div>
                      <div className="lsub">
                        <span className={`trig ${e.trigger}`}>{e.who}</span>
                        {e.detail && <span>{e.detail}</span>}
                      </div>
                    </div>
                    <span className={`lres res-${e.result}`}>
                      <Icon name={resultIcon(e.result)} size={12} />
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <Icon name="list" size={15} style={{ color: 'var(--accent-2)' }} />
                <h3>Open requests</h3>
                <span className="grow" />
                <span className="count tnum" style={{ fontSize: 11 }}>
                  {openReqs.length}
                </span>
              </div>
              <div className="loglist">
                {openReqs.length === 0 && (
                  <div className="empty" style={{ padding: '26px' }}>
                    No open requests for this account.
                  </div>
                )}
                {openReqs.map((r) => (
                  <div
                    className="logrow"
                    key={r.id}
                    style={{ gridTemplateColumns: '1fr auto', cursor: r.status === 'awaiting' ? 'pointer' : 'default' }}
                    onClick={() => r.status === 'awaiting' && onOpenApprovals(r.approvalId)}
                  >
                    <div className="lmid">
                      <div className="la">{r.title}</div>
                      <div className="lsub">
                        <span className="req-time">{fmtAgo(r.min)}</span>
                      </div>
                    </div>
                    <StatusPill status={requestStatusToPill(r.status)} label={reqGroupLabel(r.status)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface IntegrationCardProps {
  logo: string;
  tint: string;
  title: string;
  sub: string;
  status: Account['status'];
  rows: Array<[string, ReactNode]>;
  bar: { pct: number; color: string } | null;
}

function IntegrationCard({ logo, tint, title, sub, status, rows, bar }: IntegrationCardProps) {
  return (
    <div className="icard">
      <div className="icard-head">
        <div className="ilogo" style={{ background: `${tint}22`, color: tint, border: `1px solid ${tint}40` }}>
          {logo}
        </div>
        <div className="it">
          <div className="t">{title}</div>
          <div className="s">{sub}</div>
        </div>
        <StatusDot status={status} />
      </div>
      <div className="icard-rows">
        {rows.map((r, i) => (
          <div className="irow" key={i}>
            <span className="k">{r[0]}</span>
            <span className="v">{r[1]}</span>
          </div>
        ))}
      </div>
      {bar && (
        <div className="bar">
          <i style={{ width: `${Math.min(100, bar.pct)}%`, background: bar.color }} />
        </div>
      )}
    </div>
  );
}
