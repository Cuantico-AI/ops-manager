import { describe, expect, it } from 'vitest';
import {
  looksLikeWorkflowId,
  resolveTrackedWorkflowId,
} from '../../../src/lib/n8n/resolve-workflow-id.js';

describe('resolveTrackedWorkflowId', () => {
  it('uses the sole tracked workflow when none is specified', () => {
    expect(resolveTrackedWorkflowId(['wf_1'])).toBe('wf_1');
  });

  it('requires an explicit workflow when multiple are tracked', () => {
    expect(() => resolveTrackedWorkflowId(['wf_1', 'wf_2'])).toThrow(/multiple tracked workflows/i);
  });

  it('rejects workflow ids that are not tracked for the account', () => {
    expect(() => resolveTrackedWorkflowId(['wf_1'], 'wf_2')).toThrow(/not tracked/i);
  });
});

describe('looksLikeWorkflowId', () => {
  it('matches typical n8n workflow ids', () => {
    expect(looksLikeWorkflowId('wf_123')).toBe(true);
    expect(looksLikeWorkflowId('An')).toBe(false);
  });
});
