import { useEffect, useRef, useState } from 'react';
import type { Account, Approval, ApprovalDecision, Risk } from '@cuantico/contracts';
import { Icon } from '../components/Icon';
import { StatusDot } from '../components/atoms';
import { fmtAgo } from '../lib/format';

const RISK_LABEL: Record<Risk, string> = { low: 'Low risk', med: 'Medium', high: 'High risk' };

interface ApprovalPanelProps {
  open: boolean;
  approvals: Approval[];
  onClose: () => void;
  onResolve: (id: string, decision: ApprovalDecision) => void;
  accountsByName: (name: string) => Account | undefined;
  highlightId?: string | null;
}

export function ApprovalPanel({ open, approvals, onClose, onResolve, accountsByName, highlightId }: ApprovalPanelProps) {
  const [resolving, setResolving] = useState<Record<string, ApprovalDecision>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && highlightId && bodyRef.current) {
      const el = bodyRef.current.querySelector(`[data-apr="${highlightId}"]`);
      if (el) {
        el.animate(
          [{ boxShadow: '0 0 0 0 rgba(91,140,255,.5)' }, { boxShadow: '0 0 0 4px rgba(91,140,255,0)' }],
          { duration: 1400, iterations: 2 },
        );
      }
    }
  }, [open, highlightId, approvals.length]);

  function resolve(id: string, kind: ApprovalDecision) {
    setResolving((s) => ({ ...s, [id]: kind }));
    setTimeout(() => onResolve(id, kind), 280);
  }

  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`appanel ${open ? 'show' : ''}`} aria-hidden={!open}>
        <div className="ap-head">
          <div className="ap-head-top">
            <div className="ap-lock">
              <Icon name="lock" size={15} />
            </div>
            <div>
              <h2>Approval Gate</h2>
              <div className="sub">Actions ops-manager wants to take — held for a human yes / no</div>
            </div>
            <button className="ap-close" onClick={onClose}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="ap-meta">
            <span className="gate">
              <Icon name="shield" size={12} style={{ color: 'var(--green)' }} /> Every change is gated
            </span>
            <span className="gate">
              <Icon name="history" size={12} /> Logged immutably
            </span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>{approvals.length} pending</span>
          </div>
        </div>

        <div className="ap-body" ref={bodyRef}>
          {approvals.length === 0 ? (
            <div className="ap-empty">
              <div>
                <div className="ic">
                  <Icon name="check" size={22} />
                </div>
                <h3>Queue clear</h3>
                <div>No actions awaiting approval. ops-manager will surface the next gated change here.</div>
              </div>
            </div>
          ) : (
            approvals.map((ap) => {
              const a = accountsByName(ap.acct);
              const r = resolving[ap.id];
              return (
                <div className={`ap-card ${r ? 'resolving' : ''}`} key={ap.id} data-apr={ap.id} style={{ maxHeight: 600 }}>
                  <div className="ap-card-top">
                    <div className="ap-acct">
                      <div className="nm">
                        {a && <StatusDot status={a.status} />}
                        {ap.acct}
                      </div>
                      <div className="vert">
                        {a ? a.vertLabel : ''} · {a ? a.id : ''}
                      </div>
                    </div>
                    <span className={`ap-risk ${ap.risk}`}>{RISK_LABEL[ap.risk]}</span>
                  </div>
                  <div className="ap-action">
                    <div className="verb">
                      <Icon name="zap" size={15} />
                      {ap.verb}
                    </div>
                    <div className="desc">{ap.desc}</div>
                  </div>
                  {ap.diff.length > 0 && (
                    <div className="ap-diff">
                      {ap.diff.map((d, i) => (
                        <div className="drow" key={i}>
                          <span className="dk">{d.k}</span>
                          <span className="from">{d.from}</span>
                          <span className="arrow">→</span>
                          <span className="to">{d.to}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="ap-trigger">
                    <Icon name="flow" size={12} style={{ color: 'var(--text-2)' }} />
                    Triggered by <span className="who">{ap.who}</span> · {fmtAgo(ap.min)}
                  </div>
                  <div className="ap-actions">
                    <button className="btn btn-reject" onClick={() => resolve(ap.id, 'reject')}>
                      <Icon name="x" size={15} />
                      Reject
                    </button>
                    <button className="btn btn-approve" onClick={() => resolve(ap.id, 'approve')}>
                      <Icon name="check" size={15} />
                      Approve
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="ap-foot">
          <Icon name="lock" size={12} /> Approvals are signed with your operator key and appended to the audit log.
        </div>
      </aside>
    </>
  );
}
