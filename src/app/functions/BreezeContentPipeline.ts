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

/** HubSpot CRM search page size. The handler does not paginate; see the
 *  truncation note it appends when `total` exceeds this. */
const PAGE_SIZE = 100;

interface CrmRecord {
  id: string;
  properties: Record<string, string | null>;
}

/**
 * Render a target date, or nothing at all if it will not parse.
 *
 * HubSpot date properties come back as `YYYY-MM-DD` on some surfaces and as an
 * epoch-millisecond string on others; `new Date("1735689600000")` is an
 * Invalid Date, so numeric strings are parsed as numbers. Anything still
 * unparseable renders as empty rather than putting the literal text
 * "Invalid Date" into the agent's context. Dates are formatted in UTC because
 * that is how HubSpot stores them — without it the day slips in negative
 * offsets.
 */
function formatTargetDate(raw: string | null | undefined): string {
  if (!raw) return '';
  const when = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  if (Number.isNaN(when.getTime())) return '';
  const formatted = when.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return ` (target: ${formatted})`;
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
        limit: PAGE_SIZE,
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
      const date = formatTargetDate(r.properties.target_date);
      recordsByStage[stageId].push(`${title}${type}${date}`);
    }
  }

  // The header must count only what is actually listed below. `results.length`
  // is every record the search returned, including the closed and archived
  // stages that `visibleStages` deliberately drops — reporting that as the
  // "active" count overstated the pipeline by every published record in it.
  const visibleStageIds = new Set(visibleStages.map(s => s.id));
  const shownCount = search.results.filter(r =>
    visibleStageIds.has(r.properties.hs_pipeline_stage ?? ''),
  ).length;

  const label = requestedPipeline.charAt(0).toUpperCase() + requestedPipeline.slice(1);
  const scope = stageFilter ? `matching "${stageFilter}"` : 'active';
  const lines: string[] = [`${label} Pipeline — ${shownCount} ${scope} record${shownCount !== 1 ? 's' : ''}\n`];

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
    return !visibleStageIds.has(r.properties.hs_pipeline_stage ?? '') && stageLabel;
  }).length;
  if (hiddenCount > 0 && !stageFilter) {
    lines.push(`\n(${hiddenCount} record${hiddenCount !== 1 ? 's' : ''} in closed/archived stages not shown)`);
  }

  // The search is capped at PAGE_SIZE with no pagination. Say so when the cap
  // bites: an agent given a silently truncated list answers "what is in
  // review?" confidently and wrongly.
  const matched = search.total ?? search.results.length;
  if (matched > search.results.length) {
    lines.push(
      `\n(truncated: showing the first ${search.results.length} of ${matched} records in this pipeline — ` +
      'narrow the request with a stage filter for a complete list)',
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        pipelineSummary: lines.join('\n'),
        recordCount: String(shownCount),
        pipeline: requestedPipeline,
      },
    }),
  };
}
