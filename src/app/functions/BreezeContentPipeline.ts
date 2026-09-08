import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectSearchPath, pipelinesPath } from '../lib/hs-api';

interface AgentToolBody {
  callbackId?: string;
  origin?: { portalId: number };
  inputFields?: { pipeline?: string; stageFilter?: string };
  fields?: { pipeline?: string; stageFilter?: string };
}

interface BreezeContentPipelineContext {
  method: string;
  body: AgentToolBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

interface PipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { isClosed?: string };
}

interface CrmRecord {
  id: string;
  properties: Record<string, string | null>;
}

export async function main(context: BreezeContentPipelineContext): Promise<{ statusCode: number; body: string }> {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token' }) };
  }

  const portalId = context.accountId ?? context.body.origin?.portalId ?? 0;
  const inputFields = context.body.inputFields ?? context.body.fields ?? {};
  const requestedPipeline = inputFields.pipeline === 'changelog' ? 'changelog' : 'content';
  const stageFilter = inputFields.stageFilter?.toLowerCase();

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: `No portal config for portalId ${portalId}` }) };
  }

  const { objectTypeId, pipelines } = config.content;
  const pipelineId = pipelines[requestedPipeline].pipelineId;
  if (!pipelineId) {
    return { statusCode: 400, body: JSON.stringify({ error: `Pipeline '${requestedPipeline}' not configured for this portal` }) };
  }

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [pipelineRes, searchRes] = await Promise.all([
    fetch(`${HS_BASE}${pipelinesPath(objectTypeId, pipelineId)}`, { headers }),
    fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: pipelineId }] },
        ],
        properties: ['title', 'content_type', 'hs_pipeline_stage', 'target_date', 'linear_issue_url'],
        sorts: [{ propertyName: 'hs_pipeline_stage', direction: 'ASCENDING' }],
        limit: 100,
        after: '0',
      }),
    }),
  ]);

  if (!pipelineRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Pipeline fetch failed: ${pipelineRes.status}` }) };
  }
  if (!searchRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Records search failed: ${searchRes.status}` }) };
  }

  const pipeline = await pipelineRes.json() as { stages: PipelineStage[] };
  const search = await searchRes.json() as { results: CrmRecord[]; total?: number };

  const allStages = pipeline.stages
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const visibleStages = stageFilter
    ? allStages.filter(s => s.label.toLowerCase().includes(stageFilter))
    : allStages.filter(s => s.metadata?.isClosed !== 'true');

  const stageIndex = new Map(allStages.map(s => [s.id, s.label]));

  const recordsByStage: Record<string, string[]> = {};
  for (const stage of allStages) {
    recordsByStage[stage.id] = [];
  }
  for (const r of search.results) {
    const stageId = r.properties.hs_pipeline_stage ?? '';
    if (recordsByStage[stageId] !== undefined) {
      const title = r.properties.title ?? 'Untitled';
      const type = r.properties.content_type ? ` [${r.properties.content_type}]` : '';
      const date = r.properties.target_date
        ? ` (target: ${new Date(r.properties.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        : '';
      recordsByStage[stageId].push(`${title}${type}${date}`);
    }
  }

  const totalRecords = search.results.length;
  const label = requestedPipeline.charAt(0).toUpperCase() + requestedPipeline.slice(1);
  const lines: string[] = [`${label} Pipeline — ${totalRecords} active record${totalRecords !== 1 ? 's' : ''}\n`];

  for (const stage of visibleStages) {
    const records = recordsByStage[stage.id] ?? [];
    if (stageFilter || records.length > 0) {
      lines.push(`${stage.label} (${records.length}):`);
      if (records.length === 0) {
        lines.push('  (empty)');
      } else {
        records.forEach(r => lines.push(`  • ${r}`));
      }
    }
  }

  // Surface any records in stages outside the visible set (e.g. archived)
  const hiddenCount = search.results.filter(r => {
    const stageLabel = stageIndex.get(r.properties.hs_pipeline_stage ?? '');
    return !visibleStages.find(s => s.id === r.properties.hs_pipeline_stage) && stageLabel;
  }).length;
  if (hiddenCount > 0 && !stageFilter) {
    lines.push(`\n(${hiddenCount} record${hiddenCount !== 1 ? 's' : ''} in closed/archived stages not shown)`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        pipelineSummary: lines.join('\n'),
        recordCount: String(totalRecords),
        pipeline: requestedPipeline,
      },
    }),
  };
}
