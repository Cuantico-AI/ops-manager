import type { GhlOpportunity, GhlPipeline } from './client.js';

export interface StageOpportunityCounts {
  stageId: string;
  stageName: string;
  open: number;
  won: number;
  lost: number;
  abandoned: number;
  other: number;
  total: number;
}

export interface PipelineSnapshot {
  pipelineId: string;
  pipelineName: string;
  stages: StageOpportunityCounts[];
  totalOpportunities: number;
}

export interface GhlAccountSnapshot {
  accountId: string;
  accountName: string;
  locationId: string;
  pipelines: PipelineSnapshot[];
  totalOpportunities: number;
  capturedAt: string;
}

export function buildGhlAccountSnapshot(input: {
  accountId: string;
  accountName: string;
  locationId: string;
  pipelines: GhlPipeline[];
  opportunities: GhlOpportunity[];
  capturedAt?: string;
}): GhlAccountSnapshot {
  const stageNameById = new Map<string, string>();
  for (const pipeline of input.pipelines) {
    for (const stage of pipeline.stages) {
      stageNameById.set(stage.id, stage.name);
    }
  }

  const countsByPipelineStage = new Map<string, StageOpportunityCounts>();

  for (const opportunity of input.opportunities) {
    const stageName = stageNameById.get(opportunity.pipelineStageId) ?? 'Unknown stage';
    const key = `${opportunity.pipelineId}:${opportunity.pipelineStageId}`;
    const existing = countsByPipelineStage.get(key) ?? {
      stageId: opportunity.pipelineStageId,
      stageName,
      open: 0,
      won: 0,
      lost: 0,
      abandoned: 0,
      other: 0,
      total: 0,
    };

    existing.total += 1;
    if (opportunity.status === 'open') existing.open += 1;
    else if (opportunity.status === 'won') existing.won += 1;
    else if (opportunity.status === 'lost') existing.lost += 1;
    else if (opportunity.status === 'abandoned') existing.abandoned += 1;
    else existing.other += 1;

    countsByPipelineStage.set(key, existing);
  }

  const pipelines: PipelineSnapshot[] = input.pipelines.map((pipeline) => {
    const stages = pipeline.stages.map((stage) => {
      const key = `${pipeline.id}:${stage.id}`;
      return (
        countsByPipelineStage.get(key) ?? {
          stageId: stage.id,
          stageName: stage.name,
          open: 0,
          won: 0,
          lost: 0,
          abandoned: 0,
          other: 0,
          total: 0,
        }
      );
    });

    return {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      stages,
      totalOpportunities: stages.reduce((sum, stage) => sum + stage.total, 0),
    };
  });

  return {
    accountId: input.accountId,
    accountName: input.accountName,
    locationId: input.locationId,
    pipelines,
    totalOpportunities: input.opportunities.length,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function formatGhlAccountSnapshot(snapshot: GhlAccountSnapshot): string {
  const lines = [
    `GHL snapshot — ${snapshot.accountName}`,
    `Location ID: ${snapshot.locationId}`,
    `Pipelines: ${snapshot.pipelines.length}`,
    `Opportunities: ${snapshot.totalOpportunities}`,
  ];

  for (const pipeline of snapshot.pipelines) {
    lines.push('', `Pipeline: ${pipeline.pipelineName} (${pipeline.totalOpportunities})`);
    for (const stage of pipeline.stages) {
      if (stage.total === 0) {
        lines.push(`• ${stage.stageName} — 0`);
        continue;
      }
      lines.push(
        `• ${stage.stageName} — ${stage.total} (open ${stage.open}, won ${stage.won}, lost ${stage.lost})`,
      );
    }
  }

  return lines.join('\n');
}
