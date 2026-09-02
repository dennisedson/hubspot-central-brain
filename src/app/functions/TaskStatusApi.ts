import { getPortalConfig } from '../lib/portal-config';
import { getLinearIssue } from '../lib/linear-client';
import { getAsanaTask } from '../lib/asana-client';
import {
  resolvePipeline,
  stageNameFromId,
  computeLinearDrift,
  computeAsanaDrift,
} from '../lib/drift';

const HS_BASE = 'https://api.hubapi.com';

interface TaskStatusContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: TaskStatusContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(context: TaskStatusContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!objectId) return json(400, { error: 'objectId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });

  const config = getPortalConfig(portalId);
  const props = ['linear_issue_id', 'asana_task_id', 'hs_pipeline', 'hs_pipeline_stage'];
  const url = `${HS_BASE}/crm/v3/objects/${config.content.objectTypeId}/${objectId}?properties=${props.join(',')}`;

  const recordRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!recordRes.ok) {
    return json(502, { error: `Could not read record ${objectId}: ${recordRes.status}` });
  }
  const record = await recordRes.json() as { properties: Record<string, string | null> };

  const linearId = record.properties.linear_issue_id || null;
  const asanaId = record.properties.asana_task_id || null;
  const pipelineId = record.properties.hs_pipeline || '';
  const stageId = record.properties.hs_pipeline_stage || '';

  const pipeline = resolvePipeline(config, pipelineId);
  const stage = pipeline ? stageNameFromId(config, pipeline, stageId) : null;

  const [linearOutcome, asanaOutcome] = await Promise.allSettled([
    linearId ? getLinearIssue(process.env.LINEAR_API_KEY ?? '', linearId) : Promise.resolve(null),
    asanaId ? getAsanaTask(process.env.ASANA_API_KEY ?? '', asanaId) : Promise.resolve(null),
  ]);

  const errors: { linear: string | null; asana: string | null } = { linear: null, asana: null };

  let linear = null;
  if (linearOutcome.status === 'rejected') {
    errors.linear = reason(linearOutcome.reason);
  } else if (linearOutcome.value) {
    const issue = linearOutcome.value;
    linear = {
      ...issue,
      drift: pipeline && stage ? computeLinearDrift(pipeline, stage, issue.state) : null,
    };
  }

  let asana = null;
  if (asanaOutcome.status === 'rejected') {
    errors.asana = reason(asanaOutcome.reason);
  } else if (asanaOutcome.value) {
    const task = asanaOutcome.value;
    asana = {
      ...task,
      drift:
        pipeline && stage && task.stageGid
          ? computeAsanaDrift(pipeline, stage, task.stageGid)
          : null,
    };
  }

  return json(200, { linear, asana, pipeline, stageLabel: stage, errors });
}
