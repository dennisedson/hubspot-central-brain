import {
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  CONTENT_STAGE_TO_ASANA_STAGE,
  CHANGELOG_STAGE_TO_ASANA_STAGE,
  ASANA_STAGE_TO_CONTENT_STAGE,
  ASANA_STAGE_TO_CHANGELOG_STAGE,
} from './mapping';
import type { PortalConfig } from './portal-config';

export type PipelineName = 'content' | 'changelog';

export interface DriftResult {
  inSync: boolean;
  expectedState: string | null;
  actualState: string;
}

export function resolvePipeline(config: PortalConfig, hsPipelineId: string): PipelineName | null {
  const { content, changelog } = config.content.pipelines;
  if (hsPipelineId === content.pipelineId) return 'content';
  if (hsPipelineId === changelog.pipelineId) return 'changelog';
  return null;
}

export function stageNameFromId(
  config: PortalConfig,
  pipeline: PipelineName,
  stageId: string,
): string | null {
  const stageIds = config.content.pipelines[pipeline].stageIds;
  const match = Object.entries(stageIds).find(([, id]) => id === stageId);
  return match ? match[0] : null;
}

// The mapping tables are many-to-one in BOTH directions, so a single-direction
// check produces false drift. Accept a match from either side.
function compare(
  forward: Record<string, string>,
  reverse: Record<string, string>,
  stage: string,
  actual: string,
): DriftResult | null {
  const expectedState = forward[stage] ?? null;
  const reversedStage = reverse[actual] ?? null;
  // If we cannot interpret the external state at all, report unknown rather
  // than drift — our sync does not model it, so "expected" would be a guess.
  if (reversedStage === null) return null;
  return {
    inSync: expectedState === actual || reversedStage === stage,
    expectedState,
    actualState: actual,
  };
}

export function computeLinearDrift(
  pipeline: PipelineName,
  stage: string,
  linearState: string,
): DriftResult | null {
  return pipeline === 'content'
    ? compare(CONTENT_STAGE_TO_LINEAR_STATE, LINEAR_STATE_TO_CONTENT_STAGE, stage, linearState)
    : compare(CHANGELOG_STAGE_TO_LINEAR_STATE, LINEAR_STATE_TO_CHANGELOG_STAGE, stage, linearState);
}

export function computeAsanaDrift(
  pipeline: PipelineName,
  stage: string,
  asanaStageGid: string,
): DriftResult | null {
  return pipeline === 'content'
    ? compare(CONTENT_STAGE_TO_ASANA_STAGE, ASANA_STAGE_TO_CONTENT_STAGE, stage, asanaStageGid)
    : compare(CHANGELOG_STAGE_TO_ASANA_STAGE, ASANA_STAGE_TO_CHANGELOG_STAGE, stage, asanaStageGid);
}
