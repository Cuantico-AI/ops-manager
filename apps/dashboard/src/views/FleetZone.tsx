import { useMemo, useState } from 'react';
import type { Account, AccountStatus } from '@cuantico/contracts';
import { Icon } from '../components/Icon';
import { IntegrationBadges, StatusDot, VTag } from '../components/atoms';
import { shortIssue } from '../lib/format';

const STATUS_ORDER: Record<AccountStatus, number> = { down: 0, attention: 1, onboarding: 2, healthy: 3 };

const SEG: Array<[string, string, string | null]> = [
  ['all', 'All', null],
  ['down', 'Down', 'var(--red)'],
  ['attention', 'Attention', 'var(--amber)'],
  ['healthy', 'Healthy', 'var(--green)'],
  ['onboarding', 'Onboarding', 'var(--gray)'],
];

export function FleetZone({ accounts, onOpen }: { accounts: Account[]; onOpen: (a: Account) => void }) {
  const [status, setStatus] = useState('all');
  const [vert, setVert] = useState('all');
  const [intg, setIntg] = useState('all');
  const [q, setQ] = useState('');
  const [needsFirst, setNeedsFirst] = useState(true);

  const sc = useMemo(() => {
    const c: Record<string, number> = { all: accounts.length, healthy: 0, attention: 0, down: 0, onboarding: 0 };
    accounts.forEach((a) => (c[a.status] += 1));
    return c;
  }, [accounts]);

  const rows = useMemo(() => {
    let r = accounts.filter((a) => {
      if (status !== 'all' && a.status !== status) return false;
      if (vert !== 'all' && a.vert !== vert) return false;
      if (intg === 'pit' && a.pit === 'valid') return false;
      if (intg === 'assist' && a.assistable !== 'disconnected') return false;
      if (intg === 'n8n' && a.n8n !== 'none' && !a.n8nErr) return false;
      if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    r = r
      .slice()
      .sort((a, b) =>
        needsFirst
          ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.lastMin - b.lastMin
          : a.name.localeCompare(b.name),
      );
    return r;
  }, [accounts, status, vert, intg, q, needsFirst]);

  return (
    <div className="zone">
      <div className="zone-head">
        <div className="zone-title">
          <Icon name="pulse" size={16} style={{ color: 'var(--accent-2)' }} />
          <h2>Fleet Health</h2>
          <span className="count tnum">
            {rows.length} / {accounts.length}
          </span>
          <span className="grow" />
          <button className={`sortbtn ${needsFirst ? 'on' : ''}`} onClick={() => setNeedsFirst((v) => !v)}>
            <Icon name="sort" size={13} />
            {needsFirst ? 'Needs attention first' : 'A → Z'}
          </button>
        </div>
        <div className="filters">
          <div className="seg">
            {SEG.map(([k, l, c]) => (
              <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>
                {c && <span className="sdot" style={{ background: c }} />}
                {l}
                <span className="scount tnum">{sc[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filters">
          <div className="field" style={{ flex: '1 1 160px', minWidth: 140 }}>
            <Icon name="search" size={14} />
            <input placeholder="Search accounts…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" value={vert} onChange={(e) => setVert(e.target.value)}>
            <option value="all">All verticals</option>
            <option value="mortgage">Mortgage</option>
            <option value="realestate">Real Estate</option>
            <option value="insurance">Insurance</option>
          </select>
          <select className="select" value={intg} onChange={(e) => setIntg(e.target.value)}>
            <option value="all">All integrations</option>
            <option value="pit">PIT issues</option>
            <option value="assist">Assistable disconnected</option>
            <option value="n8n">n8n missing / erroring</option>
          </select>
        </div>
      </div>

      <div className="zone-body">
        {rows.length === 0 ? (
          <div className="empty">
            <Icon name="search" size={30} />
            <div>No accounts match these filters.</div>
          </div>
        ) : (
          <div className="fleet-list">
            {rows.map((a) => (
              <div key={a.id} className={`fleet-row ${a.status}`} onClick={() => onOpen(a)}>
                <StatusDot status={a.status} />
                <div className="fr-name">
                  <div className="nm">{a.name}</div>
                  <div className="meta">
                    <VTag vert={a.vert} label={a.vertLabel} />
                    <span className="last">{a.lastActivity}</span>
                    {a.issue && a.status !== 'healthy' && (
                      <span className="last" style={{ color: 'var(--text-1)', fontFamily: 'var(--sans)' }}>
                        · {shortIssue(a.issue)}
                      </span>
                    )}
                  </div>
                </div>
                <IntegrationBadges acct={a} />
                <span className="fr-chev">
                  <Icon name="chevR" size={15} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
