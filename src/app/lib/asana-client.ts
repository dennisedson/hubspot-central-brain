import { ASANA_PIPELINE_STAGE_FIELD_GID, ASANA_LINEAR_ISSUE_URL_FIELD_GID } from './mapping';

const ASANA_API = 'https://app.asana.com/api/1.0';

export async function getTaskPipelineStage(apiKey: string, taskGid: string): Promise<string | null> {
  const res = await fetch(
    `${ASANA_API}/tasks/${taskGid}?opt_fields=custom_fields.gid,custom_fields.enum_value.gid`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!res.ok) throw new Error(`Asana GET task failed ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: { custom_fields: Array<{ gid: string; enum_value?: { gid: string } }> } };
  const field = json.data.custom_fields.find(f => f.gid === ASANA_PIPELINE_STAGE_FIELD_GID);
  return field?.enum_value?.gid ?? null;
}

async function request<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ASANA_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`Asana API error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json() as { data: T };
  return json.data;
}

export async function updateTaskPipelineStage(
  apiKey: string,
  taskGid: string,
  stageOptionGid: string,
): Promise<void> {
  await request(apiKey, 'PUT', `/tasks/${taskGid}`, {
    data: {
      custom_fields: {
        [ASANA_PIPELINE_STAGE_FIELD_GID]: stageOptionGid,
      },
    },
  });
}

export async function createTask(
  apiKey: string,
  projectGid: string,
  name: string,
  customFields: Record<string, string>,
  sectionGid?: string,
): Promise<{ gid: string }> {
  const memberships = sectionGid
    ? [{ project: projectGid, section: sectionGid }]
    : undefined;
  return request<{ gid: string }>(apiKey, 'POST', '/tasks', {
    data: {
      name,
      projects: [projectGid],
      custom_fields: customFields,
      ...(memberships ? { memberships } : {}),
    },
  });
}

export async function findTaskByLinearIssueUrl(
  apiKey: string,
  workspaceGid: string,
  projectGid: string,
  linearIssueUrl: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    'projects.any': projectGid,
    [`custom_fields.${ASANA_LINEAR_ISSUE_URL_FIELD_GID}.value`]: linearIssueUrl,
    opt_fields: 'gid,name',
  });
  const tasks = await request<Array<{ gid: string }>>(apiKey, 'GET', `/workspaces/${workspaceGid}/tasks/search?${params}`);
  return tasks[0]?.gid ?? null;
}
