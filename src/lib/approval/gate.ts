import { ApprovalNotImplementedError } from '../errors.js';

export interface ApprovalRequest {
  jobId: string;
  skill: string;
  targetSummary: string;
  proposedAction: unknown;
}

export type ApprovalResult = { status: 'approved' } | { status: 'rejected' };

export class ApprovalGate {
  async gate(_request: ApprovalRequest): Promise<ApprovalResult> {
    if (process.env.BYPASS_APPROVAL === 'true') {
      return { status: 'approved' };
    }
    throw new ApprovalNotImplementedError();
  }
}

export const approvalGate = new ApprovalGate();
