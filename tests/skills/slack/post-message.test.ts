import { randomUUID } from 'node:crypto';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { describeIntegration as describe } from '../../helpers.js';
import { auditLogger } from '../../../src/lib/audit/log.js';
import { approvalGate } from '../../../src/lib/approval/gate.js';
import { query } from '../../../src/lib/db/client.js';
import { llmClient } from '../../../src/lib/llm/client.js';
import { slackPostMessageSkill } from '../../../src/skills/slack/post-message.js';
import { setSlackClient, resetSlackClient } from '../../../src/slack/client.js';

describe('slack.post-message skill', () => {
  beforeEach(() => {
    setSlackClient({
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
      },
    } as unknown as import('@slack/web-api').WebClient);
  });

  afterEach(() => {
    resetSlackClient();
  });

  it('posts to Slack and writes audit log before and after', async () => {
    const jobId = randomUUID();
    await query(
      `INSERT INTO jobs (id, agent_id, trigger_type, status) VALUES ($1, 'system', 'manual', 'running')`,
      [jobId],
    );

    const result = await slackPostMessageSkill.execute(
      { channel: '#ops-manager-alerts', text: 'test message' },
      {
        jobId,
        agentId: 'system',
        audit: auditLogger,
        approval: approvalGate,
        llm: llmClient,
      },
    );

    expect(result.ts).toBe('1234567890.123456');

    const { rows } = await query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM audit_log WHERE job_id = $1 AND action = $2',
      [jobId, 'slack.post-message'],
    );

    expect(Number(rows[0]?.count)).toBe(2);
  });
});
