import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectSearchPath, pipelinesPath } from '../lib/hs-api';

interface PipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata?: { isClosed?: string };
}

interface ContentRecord {
  id: string;
  title: string;
  contentType: string;
  pipelineStage: string;
  targetDate: string | null;
  linearIssueUrl: string | null;
}

interface ContentDataContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: ContentDataContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

export async function main(context: ContentDataContext): Promise<{ statusCode: number; body: string }> {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token' }) };
  }

  // hubspot.serverless() from a page or card does not populate context.accountId;
  // callers pass portalId explicitly. Same fallback as AppSettingsApi.
  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: `No portal config for ${portalId}` }) };
  }

  const { objectTypeId, pipelines } = config.content;
  // content_piece spans two pipelines. Callers pick one; the stages returned and
  // the records returned must come from the SAME pipeline, or the caller ends up
  // matching stage ids against another pipeline's stages and shows nothing.
  const requested = param(context, 'pipeline') === 'changelog' ? 'changelog' : 'content';
  const pipelineId = pipelines[requested].pipelineId;

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
        sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
        limit: 100,
        after: '0',
      }),
    }),
  ]);

  if (!pipelineRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Pipeline fetch failed ${pipelineRes.status}: ${await pipelineRes.text()}` }) };
  }
  if (!searchRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: `Records search failed ${searchRes.status}: ${await searchRes.text()}` }) };
  }

  const pipeline = await pipelineRes.json() as { stages: PipelineStage[] };
  const search = await searchRes.json() as { results: Array<{ id: string; properties: Record<string, string | null> }> };

  const stages = pipeline.stages
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
      isClosed: s.metadata?.isClosed === 'true',
    }));

  const records: ContentRecord[] = search.results.map(r => ({
    id: r.id,
    title: r.properties.title ?? 'Untitled',
    contentType: r.properties.content_type ?? '',
    pipelineStage: r.properties.hs_pipeline_stage ?? '',
    targetDate: r.properties.target_date ?? null,
    linearIssueUrl: r.properties.linear_issue_url ?? null,
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      stages,
      records,
      objectTypeId,
      portalId: context.accountId,
      total: search.results.length,
    }),
  };
}
