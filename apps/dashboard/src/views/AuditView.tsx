import { useState } from 'react';
import type { Account, AuditEntry } from '@cuantico/contracts';
import { Icon } from '../components/Icon';
import { resultIcon, resultLabel } from '../lib/format';

interface AuditViewProps {
  audit: AuditEntry[];
  accountsByName: (name: string) => Account | undefined;
}

export function AuditView({ audit, accountsByName }: AuditViewProps) {
  const [trig, setTrig] = useState('all');
  const [q, setQ] = useState('');

  const rows = audit.filter((e) => {
    if (trig !== 'all' && e.trigger !== trig) return false;
    if (q) {
      const s = `${e.acct} ${e.action} ${e.detail} ${e.who}`.toLowerCase();
      if (!s.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="audit fadein">
      <div className="audit-head">
        <div className="ah-top">
          <Icon name="history" size={20} style={{ color: 'var(--accent-2)' }} />
          <h1>Audit Log</h1>
          {/* Real audit_log is immutable via Postgres role grants (ops_app has
              INSERT/SELECT only) — see ARCHITECTURE.md. The chain hash shown is a
              display-stable derivation of the row id, not a cryptographic chain. */}
          <span className="chainbadge">
            <Icon name="lock" size={13} /> Append-only · role-enforced
          </span>
          <span className="grow" style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
            {audit.length} entries · genesis 00000000
          </span>
        </div>
        <div className="ah-sub">
          Every action ops-manager takes — automated or human-approved — is written here once and never modified. The
          `ops_app` role holds INSERT and SELECT only, so entries cannot be updated or deleted in place.
        </div>
        <div className="audit-filters">
          <div className="field" style={{ width: 240 }}>
            <Icon name="search" size={14} />
            <input placeholder="Search log…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="seg">
            {(
              [
                ['all', 'All'],
                ['system', 'System'],
                ['rule', 'Rule'],
                ['operator', 'Operator'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={trig === k ? 'on' : ''} onClick={() => setTrig(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="audit-table-wrap">
        <table className="atable">
          <thead>
            <tr>
              <th style={{ width: 46 }}>#</th>
              <th style={{ width: 78 }}>Time</th>
              <th style={{ width: 200 }}>Account</th>
              <th>Action</th>
              <th style={{ width: 120 }}>Trigger</th>
              <th style={{ width: 64 }}>Result</th>
              <th style={{ width: 190 }}>Hash chain</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty" style={{ padding: '28px' }}>
                    <Icon name="history" size={28} />
                    <div>{audit.length === 0 ? 'No audit entries yet.' : 'No entries match these filters.'}</div>
                  </div>
                </td>
              </tr>
            )}
            {rows.map((e) => {
              const a = accountsByName(e.acct);
              return (
                <tr key={e.seq}>
                  <td className="c-seq">{String(e.seq).padStart(3, '0')}</td>
                  <td className="c-time">{e.ts}</td>
                  <td className="c-acct">
                    {a && <span className={`statusdot ${a.status}`} />}
                    {e.acct}
                  </td>
                  <td className="c-action">
                    <b>{e.action}</b>
                    <div style={{ color: 'var(--text-2)', fontSize: 11, marginTop: 2 }}>{e.detail}</div>
                  </td>
                  <td>
                    <span className={`trig ${e.trigger}`}>{e.who}</span>
                  </td>
                  <td>
                    <span className={`lres res-${e.result}`}>
                      <Icon name={resultIcon(e.result)} size={12} />
                      {resultLabel(e.result)}
                    </span>
                  </td>
                  <td className="c-hash">
                    <div className="hashchain">
                      <span className="hh" title="this entry">
                        {e.hash}
                      </span>
                      <span className="link">
                        <Icon name="link" size={11} />
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-3)', marginTop: 2 }}>prev {e.prev}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="audit-foot">
        <Icon name="lock" size={12} style={{ color: 'var(--green)' }} />
        <span>
          Immutable — head <span className="mono">{audit[0] && audit[0].hash}</span>
        </span>
        <span style={{ marginLeft: 'auto' }}>Retention: 7 years · role-enforced · exported nightly</span>
      </div>
    </div>
  );
}
