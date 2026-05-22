import { describe, expect, it } from 'vitest';
import { parseTriggerN8nCommandArgs } from '../../src/slack/mutating-command-args.js';

describe('parseTriggerN8nCommandArgs', () => {
  it('parses account-only commands', () => {
    expect(parseTriggerN8nCommandArgs(['trigger-n8n', 'Harrison', 'Ford', 'Auto'])).toEqual({
      accountQuery: 'Harrison Ford Auto',
    });
  });

  it('parses account and workflow id commands', () => {
    expect(
      parseTriggerN8nCommandArgs(['trigger-n8n', 'Harrison', 'Ford', 'Auto', 'wf_123']),
    ).toEqual({
      accountQuery: 'Harrison Ford Auto',
      workflowId: 'wf_123',
    });
  });
});
