import type { Account, AccountStatus, QaHealthStatus } from '@cuantico/contracts';
import { STATUS_LABEL } from '../lib/format';

type PillStatus = AccountStatus | 'accent';

export function StatusPill({ status, label }: { status: PillStatus; label?: string }) {
  return (
    <span className={`pill ${status}`}>
      <span className="pdot" />
      {label ?? STATUS_LABEL[status as AccountStatus] ?? status}
    </span>
  );
}

export function StatusDot({ status }: { status: AccountStatus }) {
  return <span className={`statusdot ${status}`} title={STATUS_LABEL[status]} />;
}

export function VTag({ vert, label }: { vert: Account['vert']; label: string }) {
  return <span className={`vtag ${vert}`}>{label}</span>;
}

/** GHL PIT, Assistable, and n8n mini status badges for a fleet row. */
export function IntegrationBadges({ acct }: { acct: Account }) {
  const pit = acct.pit === 'expired' ? 'err' : acct.pit === 'expiring' ? 'warn' : 'ok';
  const pitTxt = acct.pit === 'expired' ? 'expired' : acct.pit === 'expiring' ? `${acct.pitDays}d` : 'PIT';
  const asst = acct.assistable === 'disconnected' ? 'err' : 'ok';
  const n8 = acct.n8n === 'none' ? 'off' : acct.n8nErr ? 'warn' : 'ok';
  return (
    <div className="intg">
      <span className={`ibadge ${pit}`} title={`GHL PIT token: ${acct.pit}`}>
        <span className="idot" />
        {pitTxt}
      </span>
      <span className={`ibadge ${asst}`} title={`Assistable: ${acct.assistable}`}>
        <span className="idot" />A
      </span>
      <span className={`ibadge ${n8}`} title={`n8n: ${acct.n8n}`}>
        <span className="idot" />
        n8n{acct.n8n !== 'none' ? ` ${acct.n8nCount}` : ''}
      </span>
    </div>
  );
}

interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({ data, w = 70, h = 22, color = 'var(--accent)', fill = true }: SparklineProps) {
  if (data.length < 2) {
    return <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const max = Math.max(1, ...data);
  const step = w / (data.length - 1);
  const pts = data.map((v, i): [number, number] => [i * step, h - (v / max) * (h - 3) - 1.5]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const gid = `sg${Math.round(color.length * data.length * max)}${data[0]}`;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={area} fill={`url(#${gid})`} stroke="none" />}
      <path d={line} stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function qaColor(status: QaHealthStatus): string {
  return status === 'good' ? 'var(--green)' : status === 'watch' ? 'var(--amber)' : 'var(--red)';
}

interface QAGaugeProps {
  score: number;
  status: QaHealthStatus;
  size?: number;
  stroke?: number;
}

export function QAGauge({ score, status, size = 96, stroke = 8 }: QAGaugeProps) {
  const color = qaColor(status);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    <div className="qa-gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.32,.72,0,1)', strokeLinecap: 'round' }}
        />
      </svg>
      <div className="gtext">
        <div>
          <div className="gv" style={{ color }}>
            {score}
          </div>
          <div className="gl">QA score</div>
        </div>
      </div>
    </div>
  );
}
