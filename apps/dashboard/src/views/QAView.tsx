import { useMemo, useState } from 'react';
import type { Account, QaDecision, QaFlag, QaHealth, QaSeverity } from '@cuantico/contracts';
import { Icon } from '../components/Icon';
import { QAGauge, Sparkline, StatusDot, VTag, qaColor } from '../components/atoms';
import { fmtAgo } from '../lib/format';

const SEV_ORDER: Record<QaSeverity, number> = { high: 0, med: 1, low: 2 };
const SEV_COLOR: Record<QaSeverity, string> = { high: 'var(--red)', med: 'var(--amber)', low: 'var(--text-2)' };
const CHAN_QA: Record<QaFlag['channel'], string> = { voice: 'phone', sms: 'bell' };

export function QAHealthPanel({ qa, onOpenQA }: { qa: QaHealth | null; onOpenQA?: () => void }) {
  if (!qa) {
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <Icon name="shield" size={15} style={{ color: 'var(--text-2)' }} />
          <h3>Bot QA · Truthfulness</h3>
          <span className="grow" />
          <span className="imm">no assistant connected</span>
        </div>
        <div className="empty" style={{ padding: '28px' }}>
          No assistant is live for this account — nothing for QA to score yet.
        </div>
      </div>
    );
  }
  const desc =
    qa.status === 'degrading'
      ? 'Truthfulness is trending down — this bot has produced multiple flagged responses recently. Distinct from uptime: the integrations may be green while the bot says wrong things.'
      : qa.status === 'watch'
        ? 'Mostly accurate with occasional flagged responses. Watch the trend.'
        : 'Bot responses are scoring accurate and on-script. No open truthfulness concerns.';
  return (
    <div
      className="panel"
      style={{
        marginBottom: 16,
        borderColor: qa.status === 'degrading' ? 'var(--red-bd)' : qa.status === 'watch' ? 'var(--amber-bd)' : 'var(--border-1)',
      }}
    >
      <div className="panel-head">
        <Icon name="shield" size={15} style={{ color: 'var(--accent-2)' }} />
        <h3>Bot QA · Truthfulness</h3>
        <span className="qa-layer-note">
          <Icon name="dot" size={10} /> a layer beyond uptime — “is the bot saying correct things”
        </span>
        <span className="grow" />
        <span className={`qh-pill ${qa.status}`}>{qa.status}</span>
      </div>
      <div className="qa-detail">
        <QAGauge score={qa.score} status={qa.status} />
        <div className="qd-mid">
          <div className="qd-h">
            <h4>Transcript QA</h4>
          </div>
          <div className="qd-desc">{desc}</div>
          <div className="qd-stats">
            <div className="qd-stat">
              <div className="n" style={{ color: qa.flagsWk ? 'var(--red)' : 'var(--text)' }}>
                {qa.flagsWk}
              </div>
              <div className="k">flags / 7d</div>
            </div>
            <div className="qd-stat">
              <div className="n">{qa.reviewed}</div>
              <div className="k">reviewed</div>
            </div>
            <div className="qd-stat">
              <div className="n">{qa.lastFlag}</div>
              <div className="k">last flag</div>
            </div>
          </div>
        </div>
        <div className="qd-trend">
          <div style={{ fontSize: 10, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            14-day trend
          </div>
          <Sparkline data={qa.trend} w={150} h={40} color={qaColor(qa.status)} />
          {qa.flagsWk > 0 && onOpenQA && (
            <div className="req-link" style={{ marginTop: 8 }} onClick={onOpenQA}>
              Open QA queue <Icon name="chevR" size={11} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface QAViewProps {
  flags: QaFlag[];
  health: QaHealth[];
  onResolve: (id: string, decision: QaDecision) => void;
  onOpenAccount: (a: Account) => void;
  accountsByName: (name: string) => Account | undefined;
}

export function QAView({ flags, health, onResolve, onOpenAccount, accountsByName }: QAViewProps) {
  const [sev, setSev] = useState('all');
  const [resolving, setResolving] = useState<Record<string, QaDecision>>({});

  const visible = useMemo(
    () =>
      flags
        .filter((f) => sev === 'all' || f.severity === sev)
        .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.confidence - a.confidence),
    [flags, sev],
  );

  const sortedHealth = useMemo(() => health.slice().sort((a, b) => a.score - b.score), [health]);
  const counts: Record<string, number> = { all: flags.length, high: 0, med: 0, low: 0 };
  flags.forEach((f) => (counts[f.severity] += 1));

  function resolve(id: string, kind: QaDecision) {
    setResolving((s) => ({ ...s, [id]: kind }));
    setTimeout(() => onResolve(id, kind), 270);
  }

  return (
    <div className="qa fadein">
      <div className="zone">
        <div className="zone-head">
          <div className="zone-title">
            <Icon name="shield" size={16} style={{ color: 'var(--accent-2)' }} />
            <h2>QA Review Queue</h2>
            <span className="count tnum">{visible.length}</span>
            <span className="grow" />
            <div className="seg">
              {(
                [
                  ['all', 'All'],
                  ['high', 'High'],
                  ['med', 'Med'],
                  ['low', 'Low'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={sev === k ? 'on' : ''} onClick={() => setSev(k)}>
                  {k !== 'all' && <span className="sdot" style={{ background: SEV_COLOR[k as QaSeverity] }} />}
                  {l}
                  <span className="scount tnum">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ap-meta" style={{ margin: 0, fontSize: 11 }}>
            <span className="gate">
              <Icon name="cpu" size={12} style={{ color: 'var(--accent-2)' }} /> QA agent reads every transcript and flags
              likely hallucinations / off-script replies for a human
            </span>
          </div>
        </div>

        <div className="zone-body">
          {visible.length === 0 ? (
            <div className="ap-empty" style={{ height: '100%' }}>
              <div>
                <div className="ic">
                  <Icon name="check" size={22} />
                </div>
                <h3>No open flags</h3>
                <div>Every flagged interaction has been reviewed.</div>
              </div>
            </div>
          ) : (
            <div className="qa-list">
              {visible.map((f) => {
                const a = accountsByName(f.acct);
                const r = resolving[f.id];
                return (
                  <div
                    className={`qa-card ${f.severity === 'high' ? 'high ' : ''}${r ? 'resolving' : ''}`}
                    key={f.id}
                    style={{ maxHeight: 600 }}
                  >
                    <div className="qa-card-top">
                      <span className="acctnm">
                        {a && <StatusDot status={a.status} />}
                        {f.acct}
                      </span>
                      <span className="asst">· {a ? a.assistantId ?? 'asst' : f.assistantId ?? 'asst'}</span>
                      <span className="grow" />
                      <span className="qa-chan">
                        <Icon name={CHAN_QA[f.channel]} size={12} />
                        {f.channel}
                      </span>
                      <span className="cat">{f.category}</span>
                      <span className={`sev ${f.severity}`}>{f.severity}</span>
                    </div>

                    {f.transcript.length > 0 && (
                      <div className="transcript">
                        {f.transcript.map((t, i) => (
                          <div className={`tline ${t.flag ? 'flagged' : ''}`} key={i}>
                            <span className="who">{t.role}</span>
                            <span className="said">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="qa-reason">
                      <span className="ql">
                        <Icon name="cpu" size={14} />
                      </span>
                      <span>
                        <b>Why flagged:</b> {f.reason}
                      </span>
                    </div>

                    <div className="qa-card-actions">
                      <button className="btn btn-confirm sm" onClick={() => resolve(f.id, 'confirm')}>
                        <Icon name="alert" size={14} />
                        Confirm flag
                      </button>
                      <button className="btn btn-dismiss sm" onClick={() => resolve(f.id, 'dismiss')}>
                        <Icon name="x" size={14} />
                        Dismiss
                      </button>
                      <span className="tune">
                        <Icon name="cpu" size={11} />
                        <span className="conf">
                          conf{' '}
                          <span className="cbar">
                            <i style={{ width: `${f.confidence}%`, background: SEV_COLOR[f.severity] }} />
                          </span>
                          {f.confidence}%
                        </span>
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="cpu" size={11} /> Confirm / dismiss feeds back into the QA tuning set · flagged{' '}
                      {fmtAgo(f.when)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="zone">
        <div className="zone-head">
          <div className="zone-title">
            <Icon name="pulse" size={16} style={{ color: 'var(--accent-2)' }} />
            <h2>Assistant QA Health</h2>
            <span className="count tnum">{health.length} bots</span>
            <span className="grow" />
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>worst first</span>
          </div>
          <div className="ap-meta" style={{ margin: 0, fontSize: 11 }}>
            <span className="gate">
              <Icon name="alert" size={12} style={{ color: 'var(--amber)' }} /> A falling score means a specific bot is
              degrading — catch drift before clients do
            </span>
          </div>
        </div>
        <div className="zone-body">
          {sortedHealth.map((q) => {
            const a = accountsByName(q.acct);
            return (
              <div className="qa-health-row" key={q.acct} onClick={() => a && onOpenAccount(a)}>
                <div className="qh-name">
                  <div className="nm">
                    {a && <StatusDot status={a.status} />}
                    {q.acct}
                  </div>
                  <div className="sub">
                    {a && <VTag vert={a.vert} label={a.vertLabel} />}
                    <span style={{ fontFamily: 'var(--mono)' }}>{q.reviewed} reviewed</span>
                    {q.flagsWk > 0 && (
                      <span style={{ color: 'var(--red)' }}>
                        {q.flagsWk} flag{q.flagsWk > 1 ? 's' : ''}/7d
                      </span>
                    )}
                  </div>
                </div>
                <Sparkline data={q.trend} w={92} h={28} color={qaColor(q.status)} />
                <div className="qh-status">
                  <div className="qh-score" style={{ textAlign: 'right' }}>
                    <span
                      className="v"
                      style={{ color: q.status === 'good' ? 'var(--text)' : qaColor(q.status) }}
                    >
                      {q.score}
                    </span>
                  </div>
                  <span className={`qh-pill ${q.status}`}>{q.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
