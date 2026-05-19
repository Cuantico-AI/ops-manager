import { query } from '../db/client.js';
import { logger } from '../logger.js';

export interface AuditEntry {
  jobId: string;
  actor: string;
  action: string;
  target: string;
  mutated: boolean;
  input?: unknown;
  output?: unknown;
  approvalId?: string;
}

export class AuditLogger {
  async log(entry: AuditEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_log (job_id, actor, action, target, mutated, input, output, approval_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.jobId,
          entry.actor,
          entry.action,
          entry.target,
          entry.mutated,
          entry.input !== undefined ? JSON.stringify(entry.input) : null,
          entry.output !== undefined ? JSON.stringify(entry.output) : null,
          entry.approvalId ?? null,
        ],
      );
    } catch (err) {
      logger.error({ err, entry }, 'Failed to write audit log entry');
    }
  }
}

export const auditLogger = new AuditLogger();
