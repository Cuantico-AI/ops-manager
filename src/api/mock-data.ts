import type {
  Account,
  Approval,
  AuditEntry,
  QaFlag,
  QaHealth,
  Request,
  Rollup,
} from '@cuantico/contracts';

/**
 * Contract-valid mock read-model for the dashboard, mirroring the prototype's
 * `design_handoff_cuantico_ops/src/data.jsx`. This is what the read API serves
 * until each endpoint is wired to Postgres. Deterministic and self-consistent
 * so the dashboard renders meaningfully end-to-end.
 */

const TINTS: Array<[string, string]> = [
  ['#5b8cff', '#3b63d6'],
  ['#36c08a', '#1f8a63'],
  ['#f3b13e', '#c8861a'],
  ['#c08cff', '#8a4fd6'],
  ['#f0635f', '#c43e3a'],
  ['#7fd4c0', '#3fa890'],
  ['#ff9d6b', '#d96a3a'],
  ['#6ba8ff', '#3b78d6'],
  ['#e07fb0', '#b8487f'],
  ['#9bd45f', '#6aa82f'],
];

const VERT_LABEL: Record<Account['vert'], string> = {
  mortgage: 'Mortgage',
  realestate: 'Real Estate',
  insurance: 'Insurance',
};

export function fmtAgo(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function initials(name: string): string {
  const w = name.replace(/&/g, '').split(/\s+/).filter(Boolean);
  return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

interface AccountSeed {
  name: string;
  vert: Account['vert'];
  status: Account['status'];
  pit: Account['pit'];
  assistable: Account['assistable'];
  n8n: Account['n8n'];
  n8nCount: number;
  n8nErr?: boolean;
  last: number;
  issue: string | null;
  minuteCap?: number;
}

const SEEDS: AccountSeed[] = [
  {
    name: 'Ironclad Insurance',
    vert: 'insurance',
    status: 'down',
    pit: 'expired',
    assistable: 'disconnected',
    n8n: 'active',
    n8nCount: 6,
    n8nErr: true,
    last: 4,
    issue: 'GHL PIT token expired 6h ago — all outbound automations failing (401).',
  },
  {
    name: 'Coastal Key Realty',
    vert: 'realestate',
    status: 'down',
    pit: 'valid',
    assistable: 'disconnected',
    n8n: 'active',
    n8nCount: 4,
    n8nErr: true,
    last: 11,
    issue: 'Assistable voice agent disconnected — inbound calls dropping to voicemail.',
  },
  {
    name: 'Harbor Mortgage Co',
    vert: 'mortgage',
    status: 'attention',
    pit: 'expiring',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 5,
    last: 7,
    issue: 'PIT token expires in 2 days. Auto-rotation pending approval.',
  },
  {
    name: 'Brightwater Insurance',
    vert: 'insurance',
    status: 'attention',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 7,
    n8nErr: true,
    last: 19,
    issue: 'n8n "Policy Renewal" workflow erroring on 3 of last 10 runs.',
  },
  {
    name: 'Urban Nest Realty',
    vert: 'realestate',
    status: 'attention',
    pit: 'expiring',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 3,
    last: 33,
    issue: 'PIT token expires in 5 days.',
  },
  {
    name: 'Pioneer Mortgage',
    vert: 'mortgage',
    status: 'attention',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'none',
    n8nCount: 0,
    last: 52,
    issue: 'No n8n workflows configured — lead routing still manual.',
  },
  {
    name: 'Vista Verde Realty',
    vert: 'realestate',
    status: 'attention',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 4,
    last: 88,
    issue: 'Webhook latency p95 above 4s for 40 min.',
  },
  {
    name: 'Capstone Insurance Group',
    vert: 'insurance',
    status: 'attention',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 8,
    last: 64,
    issue: 'Assistable usage at 92% of monthly minute cap.',
    minuteCap: 92,
  },
  {
    name: 'Granite Peak Mortgage',
    vert: 'mortgage',
    status: 'onboarding',
    pit: 'valid',
    assistable: 'disconnected',
    n8n: 'none',
    n8nCount: 0,
    last: 140,
    issue: 'New client — Assistable + n8n not yet provisioned.',
  },
  {
    name: 'Summit Mortgage Group',
    vert: 'mortgage',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 5,
    last: 23,
    issue: null,
  },
  {
    name: 'Marigold Realty',
    vert: 'realestate',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 6,
    last: 18,
    issue: null,
  },
  {
    name: 'Sentry Shield Insurance',
    vert: 'insurance',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 4,
    last: 51,
    issue: null,
  },
  {
    name: 'BlueKey Lending',
    vert: 'mortgage',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 3,
    last: 24,
    issue: null,
  },
  {
    name: 'Northstar Mortgage',
    vert: 'mortgage',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 7,
    last: 46,
    issue: null,
  },
  {
    name: 'Redwood Realty Group',
    vert: 'realestate',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 5,
    last: 74,
    issue: null,
  },
  {
    name: 'Hearthstone Homes',
    vert: 'realestate',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 9,
    last: 165,
    issue: null,
  },
  {
    name: 'Clearview Insurance',
    vert: 'insurance',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 4,
    last: 190,
    issue: null,
  },
  {
    name: 'Compass Point Realty',
    vert: 'realestate',
    status: 'healthy',
    pit: 'valid',
    assistable: 'connected',
    n8n: 'active',
    n8nCount: 6,
    last: 240,
    issue: null,
  },
];

function spark(status: Account['status'], seed: number): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const base = status === 'down' ? 2 : status === 'onboarding' ? 1 : 10;
    return Math.max(0, Math.round(base + Math.sin(seed + i) * (base / 2)));
  });
}

function buildAccount(s: AccountSeed, idx: number): Account {
  const pitDays = s.pit === 'expired' ? -1 : s.pit === 'expiring' ? 2 + (idx % 5) : 18 + (idx % 60);
  return {
    id: `acc_${String(idx + 1).padStart(2, '0')}`,
    locationId: `loc_${(idx + 1).toString(36).padStart(6, '0')}`,
    name: s.name,
    vert: s.vert,
    vertLabel: VERT_LABEL[s.vert],
    status: s.status,
    initials: initials(s.name),
    tint: TINTS[idx % TINTS.length],
    pit: s.pit,
    pitDays,
    assistable: s.assistable,
    assistantId: s.assistable === 'connected' ? `asst_${1000 + idx}` : null,
    n8n: s.n8n,
    n8nCount: s.n8nCount,
    n8nErr: Boolean(s.n8nErr),
    lastMin: s.last,
    lastActivity: fmtAgo(s.last),
    issue: s.issue,
    spark: spark(s.status, idx),
    minuteCap: s.minuteCap ?? 20 + ((idx * 7) % 55),
  };
}

export const MOCK_ACCOUNTS: Account[] = SEEDS.map(buildAccount);

export const MOCK_REQUESTS: Request[] = [
  { id: 'req_01', acct: 'Ironclad Insurance', title: 'Outbound SMS blasts failing across all campaigns since this morning', status: 'triaging', min: 38, chan: 'auto', prio: 'high' },
  { id: 'req_02', acct: 'Coastal Key Realty', title: 'Inbound calls going straight to voicemail — reconnect voice agent', status: 'progress', min: 11, chan: 'auto', prio: 'high' },
  { id: 'req_03', acct: 'Harbor Mortgage Co', title: 'Rotate GHL Private Integration token before it expires', status: 'awaiting', min: 7, chan: 'system', prio: 'high', approvalId: 'apr_01' },
  { id: 'req_04', acct: 'Granite Peak Mortgage', title: 'Provision Assistable assistant + base n8n lead-routing workflow', status: 'progress', min: 140, chan: 'human', prio: 'med' },
  { id: 'req_05', acct: 'Brightwater Insurance', title: 'Policy Renewal workflow throwing errors — investigate node 7', status: 'new', min: 19, chan: 'auto', prio: 'med' },
  { id: 'req_06', acct: 'Pioneer Mortgage', title: 'Build n8n workflow to route Facebook leads into pipeline', status: 'new', min: 52, chan: 'human', prio: 'med' },
  { id: 'req_07', acct: 'Marigold Realty', title: 'Add appointment-reminder sequence to buyer pipeline', status: 'progress', min: 95, chan: 'human', prio: 'low' },
  { id: 'req_08', acct: 'Capstone Insurance Group', title: 'Raise Assistable monthly minute cap — at 92% of limit', status: 'awaiting', min: 64, chan: 'system', prio: 'med', approvalId: 'apr_02' },
  { id: 'req_09', acct: 'Sentry Shield Insurance', title: 'Disable stale "Cold Lead Reactivation" workflow', status: 'awaiting', min: 120, chan: 'rule', prio: 'low', approvalId: 'apr_04' },
  { id: 'req_10', acct: 'Vista Verde Realty', title: 'Webhook latency spiking — confirm n8n instance scaling', status: 'triaging', min: 88, chan: 'auto', prio: 'med' },
  { id: 'req_11', acct: 'Redwood Realty Group', title: 'Quarterly automation health review + report export', status: 'done', min: 300, chan: 'human', prio: 'low' },
  { id: 'req_12', acct: 'Urban Nest Realty', title: 'Schedule PIT token rotation ahead of 5-day expiry', status: 'awaiting', min: 33, chan: 'system', prio: 'med', approvalId: 'apr_03' },
];

export const MOCK_APPROVALS: Approval[] = [
  {
    id: 'apr_01', acct: 'Harbor Mortgage Co', risk: 'med', verb: 'Rotate GHL Private Integration Token',
    desc: 'Token expires in 2 days. ops-manager will mint a new PIT via the GHL OAuth app and hot-swap it on all 5 active automations with zero downtime.',
    diff: [
      { k: 'PIT token', from: 'pit_…a91f (exp 2d)', to: 'pit_…new (exp 90d)' },
      { k: 'Automations', from: '5 on old token', to: '5 on new token' },
    ],
    trigger: 'rule', who: 'rule: token-expiry < 72h', min: 7,
  },
  {
    id: 'apr_02', acct: 'Capstone Insurance Group', risk: 'low', verb: 'Increase Assistable Minute Cap',
    desc: 'Account is at 92% of its 4,000-minute monthly cap with 9 days left. Raise cap one tier to avoid dropped calls. Billing impact: +$80/mo.',
    diff: [
      { k: 'Minute cap', from: '4,000 / mo', to: '6,000 / mo' },
      { k: 'Est. cost', from: '$240 / mo', to: '$320 / mo' },
    ],
    trigger: 'rule', who: 'rule: usage > 90% cap', min: 64,
  },
  {
    id: 'apr_03', acct: 'Urban Nest Realty', risk: 'med', verb: 'Schedule PIT Token Rotation',
    desc: 'Token expires in 5 days. Queue an automated rotation for tonight 02:00 local during the maintenance window.',
    diff: [
      { k: 'Rotation', from: 'not scheduled', to: 'tonight 02:00' },
      { k: 'PIT token', from: 'exp in 5d', to: 'exp in 90d' },
    ],
    trigger: 'rule', who: 'rule: token-expiry < 7d', min: 33,
  },
  {
    id: 'apr_04', acct: 'Sentry Shield Insurance', risk: 'low', verb: 'Disable Stale Workflow',
    desc: '"Cold Lead Reactivation" has had 0 successful runs in 30 days and is consuming a webhook slot. Recommend disabling.',
    diff: [
      { k: 'Workflow', from: 'active (0 runs/30d)', to: 'disabled' },
      { k: 'Webhook slot', from: 'occupied', to: 'freed' },
    ],
    trigger: 'system', who: 'anomaly: dormant workflow', min: 120,
  },
];

interface AuditSeed {
  acct: string;
  action: string;
  detail: string;
  trigger: AuditEntry['trigger'];
  who: string;
  result: AuditEntry['result'];
  min: number;
}

const AUDIT_SEEDS: AuditSeed[] = [
  { acct: 'Ironclad Insurance', action: 'PIT token auth failed — automations halted', detail: '401 from GHL API on 5 calls', trigger: 'system', who: 'health-poller', result: 'fail', min: 4 },
  { acct: 'Coastal Key Realty', action: 'Assistable connection lost', detail: 'websocket closed, code 1006', trigger: 'system', who: 'health-poller', result: 'fail', min: 11 },
  { acct: 'Marigold Realty', action: 'Approved: add appointment-reminder sequence', detail: '4 messages, buyer pipeline', trigger: 'operator', who: 'A. Reyes', result: 'ok', min: 18 },
  { acct: 'Brightwater Insurance', action: 'Workflow error detected — Policy Renewal', detail: 'node 7 timeout, 3/10 runs', trigger: 'system', who: 'health-poller', result: 'fail', min: 19 },
  { acct: 'BlueKey Lending', action: 'Google Calendar reconnected', detail: 'OAuth refreshed, booking restored', trigger: 'rule', who: 'auto-heal', result: 'ok', min: 24 },
  { acct: 'Vista Verde Realty', action: 'Webhook latency alert raised', detail: 'p95 4.2s over 40m window', trigger: 'system', who: 'health-poller', result: 'pending', min: 30 },
  { acct: 'Urban Nest Realty', action: 'Token-expiry rule fired', detail: 'PIT expires in 5d → approval queued', trigger: 'rule', who: 'token-expiry', result: 'info', min: 33 },
  { acct: 'Northstar Mortgage', action: 'Daily automation digest sent', detail: '12 runs, 0 errors', trigger: 'rule', who: 'daily-digest', result: 'ok', min: 46 },
  { acct: 'Harbor Mortgage Co', action: 'Token rotation queued for approval', detail: 'PIT expires in 2d', trigger: 'rule', who: 'token-expiry', result: 'info', min: 7 },
  { acct: 'Capstone Insurance Group', action: 'Minute-cap threshold crossed', detail: 'usage 92% of 4,000', trigger: 'rule', who: 'usage-monitor', result: 'info', min: 64 },
  { acct: 'Redwood Realty Group', action: 'Approved: quarterly health report exported', detail: 'PDF, 8 pages', trigger: 'operator', who: 'A. Reyes', result: 'ok', min: 74 },
  { acct: 'Sentry Shield Insurance', action: 'Dormant workflow flagged', detail: '0 runs in 30d', trigger: 'system', who: 'anomaly-scan', result: 'info', min: 120 },
  { acct: 'Granite Peak Mortgage', action: 'Onboarding started', detail: 'GHL location linked, PIT minted', trigger: 'operator', who: 'A. Reyes', result: 'ok', min: 140 },
  { acct: 'Hearthstone Homes', action: 'n8n workflow deployed — Lead Nurture v3', detail: '9 nodes, activated', trigger: 'operator', who: 'J. Okafor', result: 'ok', min: 165 },
  { acct: 'Clearview Insurance', action: 'PIT token rotated', detail: 'new token exp 90d, 4 automations swapped', trigger: 'rule', who: 'token-expiry', result: 'ok', min: 190 },
  { acct: 'Compass Point Realty', action: 'Assistable assistant updated', detail: 'prompt v2, voice unchanged', trigger: 'operator', who: 'J. Okafor', result: 'ok', min: 240 },
];

function fnv1a(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `00000000${(h >>> 0).toString(16)}`.slice(-8);
}

/** Build the hash-chained audit log (newest first for display). */
export function buildMockAudit(): AuditEntry[] {
  const chronological = AUDIT_SEEDS.slice().reverse();
  let prev = '00000000';
  const chained = chronological.map((e, i) => {
    const seq = i + 1;
    const hash = fnv1a(prev + e.acct + e.action + seq);
    const entry: AuditEntry = { ...e, seq, hash, prev, ts: fmtAgo(e.min) };
    prev = hash;
    return entry;
  });
  return chained.reverse();
}

export const MOCK_AUDIT: AuditEntry[] = buildMockAudit();

export const MOCK_QA_FLAGS: QaFlag[] = [
  {
    id: 'qa_01', acct: 'Summit Mortgage Group', channel: 'voice', severity: 'high', confidence: 96, category: 'unsafe-promise', when: 23,
    transcript: [
      { role: 'caller', text: 'So what kind of rate could I actually get?' },
      { role: 'assistant', flag: true, text: "Yes — I can guarantee you'll qualify for our 4.9% rate with zero closing costs." },
    ],
    reason: 'Assistant guaranteed a specific rate and loan approval. Client script forbids quoting rates or guaranteeing approval — these must transfer to a licensed loan officer. High legal/compliance exposure.',
  },
  {
    id: 'qa_02', acct: 'Sentry Shield Insurance', channel: 'sms', severity: 'high', confidence: 93, category: 'wrong-info', when: 51,
    transcript: [
      { role: 'customer', text: 'Does my policy cover flooding?' },
      { role: 'assistant', flag: true, text: 'Yes, your policy covers flood damage up to $500,000 automatically.' },
    ],
    reason: 'Standard policy on file does NOT include flood coverage. Assistant asserted coverage that does not exist — material misrepresentation that could create a bad-faith claim.',
  },
  {
    id: 'qa_03', acct: 'Marigold Realty', channel: 'voice', severity: 'high', confidence: 88, category: 'off-script', when: 74,
    transcript: [
      { role: 'caller', text: 'What do you think of the listing on Elm Street?' },
      { role: 'assistant', flag: true, text: "Honestly? That one has foundation problems — I'd skip it if I were you." },
    ],
    reason: 'Assistant volunteered an unverified, disparaging claim about a specific live listing. Off-script and a defamation / disclosure liability.',
  },
  {
    id: 'qa_04', acct: 'Summit Mortgage Group', channel: 'sms', severity: 'med', confidence: 79, category: 'hallucination', when: 96,
    transcript: [
      { role: 'customer', text: 'Where are you located and when do you close?' },
      { role: 'assistant', flag: true, text: "We're at 4421 Birch Ave and we're open until 9pm tonight!" },
    ],
    reason: 'Address and hours do not match the account record (office closes 6pm; no Birch Ave location exists). Fabricated details.',
  },
  {
    id: 'qa_05', acct: 'Capstone Insurance Group', channel: 'voice', severity: 'med', confidence: 74, category: 'out-of-scope', when: 120,
    transcript: [
      { role: 'caller', text: 'Can you just cancel my auto policy?' },
      { role: 'assistant', flag: true, text: 'Of course, I can go ahead and cancel your auto policy for you right now.' },
    ],
    reason: 'Assistant offered to perform a policy cancellation — not an enabled capability and requires a licensed agent. Should have routed to a human.',
  },
  {
    id: 'qa_06', acct: 'Brightwater Insurance', channel: 'sms', severity: 'med', confidence: 71, category: 'off-script', when: 160,
    transcript: [
      { role: 'customer', text: 'Is this a good deal?' },
      { role: 'assistant', flag: true, text: "Between us, you'd probably be better off with a competitor for that." },
    ],
    reason: 'Assistant recommended a competitor and undercut the client. Clear off-script behavior.',
  },
  {
    id: 'qa_07', acct: 'Oakline Properties', channel: 'voice', severity: 'low', confidence: 62, category: 'tone', when: 210,
    transcript: [
      { role: 'caller', text: 'I need to move the showing to Saturday.' },
      { role: 'assistant', flag: true, text: 'I mean… whatever works for you, I guess.' },
    ],
    reason: 'Dismissive tone below brand standard. No factual error — low severity, tracked for coaching.',
  },
  {
    id: 'qa_08', acct: 'Hearthstone Homes', channel: 'sms', severity: 'low', confidence: 58, category: 'out-of-scope', when: 280,
    transcript: [
      { role: 'customer', text: 'How do I reach the seller directly?' },
      { role: 'assistant', flag: true, text: "Sure — I can text you the seller's personal cell number." },
    ],
    reason: 'Offered to share contact data not in the approved knowledge base. Possible privacy issue.',
  },
];

interface QaHealthSeed {
  acct: string;
  score: number;
  slope: number;
  flagsWk: number;
}

const QA_HEALTH_SEEDS: QaHealthSeed[] = [
  { acct: 'Summit Mortgage Group', score: 71, slope: -2.0, flagsWk: 4 },
  { acct: 'Sentry Shield Insurance', score: 74, slope: -1.6, flagsWk: 2 },
  { acct: 'Marigold Realty', score: 83, slope: -1.1, flagsWk: 1 },
  { acct: 'Capstone Insurance Group', score: 86, slope: -0.6, flagsWk: 1 },
  { acct: 'Brightwater Insurance', score: 81, slope: -0.8, flagsWk: 1 },
  { acct: 'Oakline Properties', score: 91, slope: 0.2, flagsWk: 1 },
  { acct: 'Hearthstone Homes', score: 90, slope: 0.1, flagsWk: 1 },
  { acct: 'BlueKey Lending', score: 97, slope: 0.3, flagsWk: 0 },
  { acct: 'Redwood Realty Group', score: 95, slope: 0.1, flagsWk: 0 },
  { acct: 'Northstar Mortgage', score: 96, slope: 0.2, flagsWk: 0 },
  { acct: 'Clearview Insurance', score: 94, slope: 0.0, flagsWk: 0 },
  { acct: 'Compass Point Realty', score: 93, slope: 0.1, flagsWk: 0 },
];

export function qaStatusFor(score: number): QaHealth['status'] {
  return score >= 90 ? 'good' : score >= 78 ? 'watch' : 'degrading';
}

function trendFrom(end: number, slope: number): number[] {
  return Array.from({ length: 10 }, (_, i) =>
    Math.max(40, Math.min(100, Math.round(end - slope * (9 - i) + (i % 2 ? 1 : -1)))),
  );
}

export const MOCK_QA_HEALTH: QaHealth[] = QA_HEALTH_SEEDS.map((q) => {
  const lastFlagFlag = MOCK_QA_FLAGS.find((f) => f.acct === q.acct);
  return {
    acct: q.acct,
    score: q.score,
    slope: q.slope,
    flagsWk: q.flagsWk,
    status: qaStatusFor(q.score),
    trend: trendFrom(q.score, q.slope),
    lastFlag: lastFlagFlag ? fmtAgo(lastFlagFlag.when) : '—',
    reviewed: 40 + ((q.score * 3) % 120),
  };
});

export function computeRollup(
  accounts: Account[],
  requests: Request[],
  approvals: Approval[],
  flags: QaFlag[],
  health: QaHealth[],
): Rollup {
  const counts = { healthy: 0, attention: 0, down: 0, onboarding: 0 };
  for (const a of accounts) counts[a.status]++;

  const tokensExpiring = accounts.filter((a) => a.pit === 'expiring').length;
  const tokensExpired = accounts.filter((a) => a.pit === 'expired').length;
  const assistDisc = accounts.filter((a) => a.assistable === 'disconnected').length;
  const n8nActive = accounts.filter((a) => a.n8n === 'active').length;
  const n8nNone = accounts.filter((a) => a.n8n === 'none').length;
  const qaHigh = flags.filter((f) => f.severity === 'high').length;
  const avgQa = health.length
    ? Math.round(health.reduce((s, q) => s + q.score, 0) / health.length)
    : 0;

  return {
    total: accounts.length,
    counts,
    tokensExpiring,
    tokensExpired,
    assistDisc,
    n8nActive,
    n8nNone,
    uptime: accounts.length
      ? Math.round(((counts.healthy + counts.attention * 0.5) / accounts.length) * 1000) / 10
      : 0,
    pendingApprovals: approvals.length,
    activeRequests: requests.filter((r) => r.status !== 'done').length,
    awaiting: requests.filter((r) => r.status === 'awaiting').length,
    qaPending: flags.length,
    qaHigh,
    avgQa,
    qaDegrading: health.filter((q) => q.status === 'degrading').length,
  };
}
