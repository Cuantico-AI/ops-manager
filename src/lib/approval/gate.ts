import {
  ApprovalPendingError,
  ApprovalRejectedError,
} from '../errors.js';
import {
  createApproval,
  findApprovedApprovalForJob,
  findPendingApprovalForJob,
  setApprovalSlackMessageTs,
  setJobStatus,
  type ApprovalRecord,
} from './store.js';
import { postApprovalRequest } from './slack-flow.js';

export interface ApprovalRequest {
  jobId: string;
  skill: string;
  targetSummary: string;
  proposedAction: unknown;
}

export type ApprovalResult =
  | { status: 'approved'; approvalId?: string }
  | { status: 'rejected'; approvalId?: string };

export class ApprovalGate {
  async gate(request: ApprovalRequest): Promise<ApprovalResult> {
    if (process.env.BYPASS_APPROVAL === 'true') {
      return { status: 'approved' };
    }

    const approved = await findApprovedApprovalForJob(request.jobId);
    if (approved) {
      return { status: 'approved', approvalId: approved.id };
    }

    const pending = await findPendingApprovalForJob(request.jobId);
    if (pending) {
      throw new ApprovalPendingError(pending.id);
    }

    const approval = await createApproval(request);
    await setJobStatus(request.jobId, 'awaiting_approval');

    try {
      const slackMessageTs = await postApprovalRequest(approval);
      await setApprovalSlackMessageTs(approval.id, slackMessageTs);
    } catch {
      // Approval row still exists; operators can approve via /ops approve.
    }

    throw new ApprovalPendingError(approval.id);
  }
}

export function isApprovalPendingError(err: unknown): err is ApprovalPendingError {
  return err instanceof ApprovalPendingError;
}

export function isApprovalRejectedError(err: unknown): err is ApprovalRejectedError {
  return err instanceof ApprovalRejectedError;
}

export const approvalGate = new ApprovalGate();

export type { ApprovalRecord };
