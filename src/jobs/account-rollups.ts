import { query } from '../lib/db/client.js';
import { childLogger } from '../lib/logger.js';

export const ACCOUNT_ROLLUPS_QUEUE = 'account-rollups';

/**
 * How many trailing days the rollup materializes. The dashboard reads the last
 * 7 days for the activity sparkline and the last 14 for the QA trend, so 14 is
 * the widest window any reader needs.
 */
export const ROLLUP_WINDOW_DAYS = 14;

export function getAccountRollupsCron(): string {
  // Hourly by default — today's bar stays fresh as jobs run, without churn.
  return process.env.ACCOUNT_ROLLUPS_CRON ?? '0 * * * *';
}

/**
 * Recomputes account_daily_metrics for the trailing window. Deterministic and
 * idempotent: it deletes the window and rebuilds it from the source tables, so
 * the same source rows always yield the same rollup (a day whose activity later
 * drops to zero is correctly zeroed, not left stale). No agent involved — this
 * is scripted cron plumbing.
 *
 * - activity_count: number of jobs started for the account that day.
 * - qa_avg_score:   rounded average qa_reviews.score for the account that day.
 */
export async function runAccountRollups(): Promise<void> {
  const log = childLogger({ job: ACCOUNT_ROLLUPS_QUEUE });
  log.info('Account rollups job starting');

  await query(`DELETE FROM account_daily_metrics WHERE day >= (CURRENT_DATE - $1::int)`, [
    ROLLUP_WINDOW_DAYS - 1,
  ]);

  const { rowCount } = await query(
    `INSERT INTO account_daily_metrics (account_id, day, activity_count, qa_avg_score)
     SELECT COALESCE(a.account_id, q.account_id) AS account_id,
            COALESCE(a.day, q.day)               AS day,
            COALESCE(a.cnt, 0)                   AS activity_count,
            q.avg_score                          AS qa_avg_score
     FROM (
       SELECT account_id, date(started_at) AS day, COUNT(*)::int AS cnt
       FROM jobs
       WHERE account_id IS NOT NULL
         AND started_at >= (CURRENT_DATE - ($1::int - 1))
       GROUP BY account_id, date(started_at)
     ) a
     FULL OUTER JOIN (
       SELECT account_id, date(reviewed_at) AS day, ROUND(AVG(score))::int AS avg_score
       FROM qa_reviews
       WHERE reviewed_at >= (CURRENT_DATE - ($1::int - 1))
       GROUP BY account_id, date(reviewed_at)
     ) q ON a.account_id = q.account_id AND a.day = q.day`,
    [ROLLUP_WINDOW_DAYS],
  );

  log.info({ rows: rowCount }, 'Account rollups job complete');
}
