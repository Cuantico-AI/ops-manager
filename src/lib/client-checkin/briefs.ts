import { z } from 'zod';
import { resolveAccountInput } from '../accounts/resolve-account-input.js';
import { query } from '../db/client.js';
import { NotFoundError } from '../errors.js';
import { clientCheckinSignalsSchema, type ClientCheckinSignals } from './health-signals.js';
import {
  clientCheckinOpenIssueSchema,
  type ClientCheckinOpenIssue,
  type GenerateClientCheckinBriefOutput,
} from '../../skills/client-checkin/generate-brief.js';

const DEFAULT_CLIENT_CHECKIN_HISTORY_LIMIT = 10;
const MAX_CLIENT_CHECKIN_HISTORY_LIMIT = 25;

export interface ClientCheckinBriefRecord {
  id: string;
  jobId: string | null;
  accountId: string;
  accountName: string;
  status: 'healthy' | 'watch' | 'at_risk';
  summary: string;
  talkingPoints: string[];
  openIssues: ClientCheckinOpenIssue[];
  followUpQuestions: string[];
  signals: ClientCheckinSignals;
  modelUsed: string;
  generatedAt: string;
  createdAt: string;
}

interface ClientCheckinBriefRow {
  id: string;
  job_id: string | null;
  account_id: string;
  account_name: string;
  status: 'healthy' | 'watch' | 'at_risk';
  summary: string;
  talking_points: unknown;
  open_issues: unknown;
  follow_up_questions: unknown;
  signals: unknown;
  model_used: string;
  generated_at: Date | string;
  created_at: Date | string;
}

export interface PersistClientCheckinBriefInput {
  jobId: string;
  output: GenerateClientCheckinBriefOutput;
}

export async function persistClientCheckinBrief(
  input: PersistClientCheckinBriefInput,
): Promise<ClientCheckinBriefRecord> {
  const { rows } = await query<ClientCheckinBriefRow>(
    `INSERT INTO client_checkin_briefs (
       job_id,
       account_id,
       status,
       summary,
       talking_points,
       open_issues,
       follow_up_questions,
       signals,
       model_used,
       generated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING
       client_checkin_briefs.*,
       (SELECT name FROM accounts WHERE accounts.id = client_checkin_briefs.account_id) AS account_name`,
    [
      input.jobId,
      input.output.accountId,
      input.output.status,
      input.output.summary,
      JSON.stringify(input.output.talkingPoints),
      JSON.stringify(input.output.openIssues),
      JSON.stringify(input.output.followUpQuestions),
      JSON.stringify(input.output.signals),
      input.output.modelUsed,
      input.output.generatedAt,
    ],
  );

  return mapClientCheckinBriefRow(rows[0]);
}

export interface ListClientCheckinBriefsInput {
  accountId?: string;
  accountQuery?: string;
  limit?: number;
}

export interface ListClientCheckinBriefsOutput {
  accountId: string;
  accountName: string;
  limit: number;
  briefs: ClientCheckinBriefRecord[];
}

export async function listClientCheckinBriefsForAccount(
  input: ListClientCheckinBriefsInput,
): Promise<ListClientCheckinBriefsOutput> {
  const account = await resolveAccountInput(input);
  const limit = normalizeClientCheckinHistoryLimit(input.limit);
  const { rows } = await query<ClientCheckinBriefRow>(
    `SELECT ccb.*, a.name AS account_name
     FROM client_checkin_briefs ccb
     JOIN accounts a ON a.id = ccb.account_id
     WHERE ccb.account_id = $1
     ORDER BY ccb.generated_at DESC
     LIMIT $2`,
    [account.id, limit],
  );

  return {
    accountId: account.id,
    accountName: account.name,
    limit,
    briefs: rows.map(mapClientCheckinBriefRow),
  };
}

export async function getClientCheckinBriefById(id: string): Promise<ClientCheckinBriefRecord> {
  const { rows } = await query<ClientCheckinBriefRow>(
    `SELECT ccb.*, a.name AS account_name
     FROM client_checkin_briefs ccb
     JOIN accounts a ON a.id = ccb.account_id
     WHERE ccb.id = $1
     LIMIT 1`,
    [id.trim()],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`No client check-in brief found for ID "${id}"`);
  }

  return mapClientCheckinBriefRow(row);
}

export function normalizeClientCheckinHistoryLimit(limit: number | undefined): number {
  if (!limit) {
    return DEFAULT_CLIENT_CHECKIN_HISTORY_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CLIENT_CHECKIN_HISTORY_LIMIT);
}

function mapClientCheckinBriefRow(
  row: ClientCheckinBriefRow | undefined,
): ClientCheckinBriefRecord {
  if (!row) {
    throw new NotFoundError('Client check-in brief was not found');
  }

  return {
    id: row.id,
    jobId: row.job_id,
    accountId: row.account_id,
    accountName: row.account_name,
    status: row.status,
    summary: row.summary,
    talkingPoints: parseStringArray(row.talking_points),
    openIssues: parseOpenIssues(row.open_issues),
    followUpQuestions: parseStringArray(row.follow_up_questions),
    signals: parseSignals(row.signals, row.account_id, row.account_name),
    modelUsed: row.model_used,
    generatedAt:
      row.generated_at instanceof Date ? row.generated_at.toISOString() : row.generated_at,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  const result = clientCheckinStringArraySchema.safeParse(parsed);
  return result.success ? result.data : [];
}

function parseOpenIssues(value: unknown): ClientCheckinOpenIssue[] {
  const parsed = parseJsonValue(value);
  const result = clientCheckinOpenIssueSchema.array().safeParse(parsed);
  return result.success ? result.data : [];
}

function parseSignals(
  value: unknown,
  accountId: string,
  accountName: string,
): ClientCheckinSignals {
  const parsed = parseJsonValue(value);
  const result = clientCheckinSignalsSchema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  return {
    accountId,
    accountName,
    accountStatus: 'unknown',
    ghl: {
      locationId: null,
      pitTokenPresent: false,
      status: 'unknown',
      checkedAt: null,
      httpStatus: null,
      message: null,
    },
    assistable: {
      subaccountId: null,
      status: 'unknown',
      checkedAt: null,
      httpStatus: null,
      message: null,
    },
    n8n: {
      workflowIds: [],
      workflowCount: 0,
      status: 'unknown',
      checkedAt: null,
      failingWorkflows: null,
      staleWorkflows: null,
    },
  };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const clientCheckinStringArraySchema = z.array(z.string().trim().min(1));
