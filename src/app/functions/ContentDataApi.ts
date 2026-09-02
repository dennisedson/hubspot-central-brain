import { getPortalConfig } from '../lib/portal-config';

const HS_BASE = 'https://api.hubapi.com';

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
  accountId: number;
  body?: Record<string, string>;
}

export async function main(context: ContentDataContext): Promise<{ statusCode: number; body: string }> {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token' }) };
  }

  let config;
  try {
    config = getPortalConfig(context.accountId);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: `No portal config for ${context.accountId}` }) };
  }

  const { objectTypeId, pipelines } = config.content;
  const pipelineId = pipelines.content.pipelineId;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [pipelineRes, searchRes] = await Promise.all([
    fetch(`${HS_BASE}/crm/v3/pipelines/${objectTypeId}/${pipelineId}`, { headers }),
    fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filterGroups: [],
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
