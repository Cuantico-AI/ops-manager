import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Account, ApprovalDecision, QaDecision, Rollup } from '@cuantico/contracts';
import { Icon } from './components/Icon';
import {
  useAccountDetail,
  useApprovals,
  useAudit,
  useFleet,
  useQaFlags,
  useQaHealth,
  useRequests,
  useResolveApproval,
  useResolveQaFlag,
} from './lib/api';
import { FleetZone } from './views/FleetZone';
import { RequestsZone } from './views/RequestsZone';
import { ApprovalPanel } from './views/ApprovalPanel';
import { QAView } from './views/QAView';
import { AuditView } from './views/AuditView';
import { AccountDetail } from './views/AccountDetail';

export function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const fleet = useFleet();
  const requests = useRequests();
  const approvals = useApprovals();
  const qaFlags = useQaFlags();
  const qaHealth = useQaHealth();
  const audit = useAudit();

  const resolveApproval = useResolveApproval();
  const resolveQaFlag = useResolveQaFlag();

  const [panelOpen, setPanelOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const accounts = fleet.data?.accounts ?? [];
  const rollup = fleet.data?.rollup;

  const accountIndex = useMemo(() => {
    const byName = new Map<string, Account>();
    for (const a of accounts) byName.set(a.name, a);
    return byName;
  }, [accounts]);
  const accountsByName = (name: string): Account | undefined => accountIndex.get(name);

  function openApprovals(approvalId?: string) {
    setHighlightId(approvalId ?? null);
    setPanelOpen(true);
  }
  function openAccount(a: Account) {
    navigate(`/accounts/${encodeURIComponent(a.id)}`);
  }

  const pendingApprovals = approvals.data?.approvals.length ?? rollup?.pendingApprovals ?? 0;
  const qaHigh = rollup?.qaHigh ?? 0;

  return (
    <div className="app">
      <Rail
        path={location.pathname}
        navigate={(to) => navigate(to)}
        qaHigh={qaHigh}
        onOpenApprovals={() => openApprovals()}
        pendingApprovals={pendingApprovals}
      />
      <div className="main">
        <TopBar
          rollup={rollup}
          syncedAt={fleet.data?.syncedAt}
          pendingApprovals={pendingApprovals}
          onOpenApprovals={() => openApprovals()}
          onChip={() => navigate('/')}
        />
        {rollup && !location.pathname.startsWith('/accounts/') && <Ribbon rollup={rollup} />}

        <Routes>
          <Route
            path="/"
            element={
              <Loadable loading={fleet.isLoading} error={fleet.isError}>
                <div className="ops">
                  <FleetZone accounts={accounts} onOpen={openAccount} />
                  <RequestsZone
                    requests={requests.data?.requests ?? []}
                    accountsByName={accountsByName}
                    onOpenApprovals={openApprovals}
                    onOpenAccount={openAccount}
                  />
                </div>
              </Loadable>
            }
          />
          <Route
            path="/qa"
            element={
              <Loadable loading={qaFlags.isLoading || qaHealth.isLoading} error={qaFlags.isError || qaHealth.isError}>
                <QAView
                  flags={qaFlags.data?.flags ?? []}
                  health={qaHealth.data?.health ?? []}
                  onResolve={(id, decision: QaDecision) => resolveQaFlag.mutate({ id, decision })}
                  onOpenAccount={openAccount}
                  accountsByName={accountsByName}
                />
              </Loadable>
            }
          />
          <Route
            path="/audit"
            element={
              <Loadable loading={audit.isLoading} error={audit.isError}>
                <AuditView audit={audit.data?.entries ?? []} accountsByName={accountsByName} />
              </Loadable>
            }
          />
          <Route
            path="/accounts/:id"
            element={<AccountDetailRoute onBack={() => navigate('/')} onOpenApprovals={openApprovals} onOpenQA={() => navigate('/qa')} />}
          />
        </Routes>
      </div>

      <ApprovalPanel
        open={panelOpen}
        approvals={approvals.data?.approvals ?? []}
        onClose={() => setPanelOpen(false)}
        onResolve={(id, decision: ApprovalDecision) => resolveApproval.mutate({ id, decision })}
        accountsByName={accountsByName}
        highlightId={highlightId}
      />
    </div>
  );
}

function Loadable({ loading, error, children }: { loading: boolean; error: boolean; children: ReactNode }) {
  if (error) {
    return (
      <div className="loadwrap">
        <div className="err">Could not reach the ops-manager read API. Is the backend running?</div>
      </div>
    );
  }
  if (loading) {
    return <div className="loadwrap">Loading fleet…</div>;
  }
  return <>{children}</>;
}

function AccountDetailRoute({
  onBack,
  onOpenApprovals,
  onOpenQA,
}: {
  onBack: () => void;
  onOpenApprovals: (approvalId?: string) => void;
  onOpenQA: () => void;
}) {
  const { id } = useParams();
  const detail = useAccountDetail(id);

  if (detail.isLoading) return <div className="loadwrap">Loading account…</div>;
  if (detail.isError || !detail.data) {
    return (
      <div className="loadwrap">
        <div className="err">Account not found.</div>
      </div>
    );
  }
  return <AccountDetail detail={detail.data} onBack={onBack} onOpenApprovals={onOpenApprovals} onOpenQA={onOpenQA} />;
}

interface RailProps {
  path: string;
  navigate: (to: string) => void;
  qaHigh: number;
  pendingApprovals: number;
  onOpenApprovals: () => void;
}

function Rail({ path, navigate, qaHigh, pendingApprovals, onOpenApprovals }: RailProps) {
  const isOps = path === '/' || path.startsWith('/accounts/');
  return (
    <nav className="rail">
      <div className="rail-logo">C</div>
      <button className={`rail-btn ${isOps ? 'active' : ''}`} title="Operations" onClick={() => navigate('/')}>
        <Icon name="grid" size={19} />
      </button>
      <button className="rail-btn" title="Approval Gate" onClick={onOpenApprovals}>
        <Icon name="shield" size={19} />
        {pendingApprovals > 0 && <span className="rail-badge">{pendingApprovals}</span>}
      </button>
      <button className={`rail-btn ${path === '/qa' ? 'active' : ''}`} title="QA / Truthfulness" onClick={() => navigate('/qa')}>
        <Icon name="cpu" size={19} />
        {qaHigh > 0 && <span className="rail-badge" style={{ background: 'var(--red)' }}>{qaHigh}</span>}
      </button>
      <button className={`rail-btn ${path === '/audit' ? 'active' : ''}`} title="Audit Log" onClick={() => navigate('/audit')}>
        <Icon name="history" size={19} />
      </button>
      <span className="rail-spacer" />
      <div className="rail-avatar" title="Operator">
        AR
      </div>
    </nav>
  );
}

interface TopBarProps {
  rollup?: Rollup;
  syncedAt?: string;
  pendingApprovals: number;
  onOpenApprovals: () => void;
  onChip: () => void;
}

function TopBar({ rollup, syncedAt, pendingApprovals, onOpenApprovals, onChip }: TopBarProps) {
  const ago = useSyncedAgo(syncedAt);
  const counts = rollup?.counts;
  return (
    <header className="topbar">
      <div className="wordmark">
        <b>Cuantico</b>
        <span>Ops</span>
      </div>
      <div className="topbar-sep" />
      <div className="fleet-summary">
        <div className="fs-chip" onClick={onChip}>
          <span className="dot" style={{ background: 'var(--green)' }} />
          <span className="n tnum">{counts?.healthy ?? '—'}</span>
          <span className="l">healthy</span>
        </div>
        <div className="fs-chip" onClick={onChip}>
          <span className="dot" style={{ background: 'var(--amber)' }} />
          <span className="n tnum">{counts?.attention ?? '—'}</span>
          <span className="l">attention</span>
        </div>
        <div className="fs-chip" onClick={onChip}>
          <span className="dot" style={{ background: 'var(--red)' }} />
          <span className="n tnum">{counts?.down ?? '—'}</span>
          <span className="l">down</span>
        </div>
      </div>
      <div className="topbar-right">
        <div className="sync">
          <span className="pulse" />
          synced <b>{ago}</b>
        </div>
        <button className={`approvals-btn ${pendingApprovals > 0 ? 'pulse-glow' : ''}`} onClick={onOpenApprovals}>
          <Icon name="lock" size={15} />
          Approvals
          {pendingApprovals > 0 && <span className="cnt">{pendingApprovals}</span>}
        </button>
      </div>
    </header>
  );
}

function Ribbon({ rollup }: { rollup: Rollup }) {
  const tiles = [
    {
      label: 'Fleet',
      value: `${rollup.total}`,
      small: `${rollup.counts.healthy} healthy`,
      trendClass: 'trend-flat',
      trend: `${rollup.counts.down} down`,
    },
    {
      label: 'GHL tokens',
      value: `${rollup.tokensExpiring}`,
      small: 'expiring',
      trendClass: rollup.tokensExpired ? 'trend-down' : 'trend-flat',
      trend: `${rollup.tokensExpired} expired`,
    },
    {
      label: 'Assistable',
      value: `${rollup.assistDisc}`,
      small: 'disconnected',
      trendClass: rollup.assistDisc ? 'trend-down' : 'trend-up',
      trend: rollup.assistDisc ? 'needs attention' : 'all connected',
    },
    {
      label: 'n8n active',
      value: `${rollup.n8nActive}`,
      small: `${rollup.n8nNone} none`,
      trendClass: 'trend-flat',
      trend: 'workflows',
    },
    {
      label: 'Uptime',
      value: `${rollup.uptime}`,
      small: '%',
      trendClass: rollup.uptime >= 99 ? 'trend-up' : 'trend-down',
      trend: 'fleet',
    },
    {
      label: 'Requests',
      value: `${rollup.activeRequests}`,
      small: 'active',
      trendClass: rollup.awaiting ? 'trend-down' : 'trend-flat',
      trend: `${rollup.awaiting} awaiting`,
    },
    {
      label: 'QA score',
      value: `${rollup.avgQa}`,
      small: 'avg',
      trendClass: rollup.qaHigh ? 'trend-down' : 'trend-up',
      trend: `${rollup.qaHigh} high flags`,
    },
  ];

  return (
    <div className="ribbon">
      {tiles.map((t) => (
        <div className="metric" key={t.label}>
          <div className="mlabel">{t.label}</div>
          <div className="mval">
            {t.value}
            <small>{t.small}</small>
          </div>
          <div className={`mtrend ${t.trendClass}`}>{t.trend}</div>
        </div>
      ))}
    </div>
  );
}

function useSyncedAgo(syncedAt?: string): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!syncedAt) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(syncedAt)) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}
