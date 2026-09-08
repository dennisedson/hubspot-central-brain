import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath } from '../lib/hs-api';

interface AgentToolBody {
  callbackId?: string;
  origin?: { portalId: number };
  inputFields?: { meetingSummary?: string; actionItems?: string };
  fields?: { meetingSummary?: string; actionItems?: string };
}

interface BreezeMeetingRouterContext {
  method: string;
  body: AgentToolBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

type ItemCategory = 'content_idea' | 'linear_task' | 'hubspot_task' | 'skip';

interface RoutedItem {
  text: string;
  category: ItemCategory;
  reason: string;
}

const CONTENT_KEYWORDS = [
  'blog', 'post', 'write', 'draft', 'article', 'tutorial', 'guide', 'docs',
  'documentation', 'changelog', 'video', 'talk', 'demo', 'walkthrough',
  'content', 'publish', 'announce', 'share', 'explain', 'cover', 'show how',
];

const LINEAR_KEYWORDS = [
  'bug', 'fix', 'issue', 'pr', 'pull request', 'code', 'build', 'deploy',
  'implement', 'refactor', 'test', 'ci', 'release', 'api', 'endpoint',
  'feature', 'ticket', 'linear', 'engineer', 'dev',
];

function classify(item: string): { category: ItemCategory; reason: string } {
  const lower = item.toLowerCase();

  const contentScore = CONTENT_KEYWORDS.filter(k => lower.includes(k)).length;
  const linearScore = LINEAR_KEYWORDS.filter(k => lower.includes(k)).length;

  if (item.trim().length < 5) return { category: 'skip', reason: 'too short to classify' };

  if (contentScore > 0 && contentScore >= linearScore) {
    return { category: 'content_idea', reason: `matched: ${CONTENT_KEYWORDS.filter(k => lower.includes(k)).slice(0, 2).join(', ')}` };
  }
  if (linearScore > 0) {
    return { category: 'linear_task', reason: `matched: ${LINEAR_KEYWORDS.filter(k => lower.includes(k)).slice(0, 2).join(', ')}` };
  }
  return { category: 'hubspot_task', reason: 'general follow-up' };
}

async function createContentIdea(
  token: string,
  objectTypeId: string,
  pipelineId: string,
  stageId: string,
  title: string,
  notes: string,
): Promise<string | null> {
  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      properties: {
        title,
        notes,
        hs_pipeline: pipelineId,
        hs_pipeline_stage: stageId,
        content_type: 'blog post',
      },
    }),
  });

  if (!res.ok) {
    console.error(`Failed to create content idea "${title}": ${res.status} ${await res.text()}`);
    return null;
  }

  const record = await res.json() as { id: string };
  return record.id;
}

export async function main(context: BreezeMeetingRouterContext): Promise<{ statusCode: number; body: string }> {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token' }) };
  }

  const portalId = context.accountId ?? context.body.origin?.portalId ?? 0;
  const inputFields = context.body.inputFields ?? context.body.fields ?? {};
  const meetingSummary = (inputFields.meetingSummary ?? '').trim();
  const actionItemsText = (inputFields.actionItems ?? '').trim();

  if (!actionItemsText) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        outputFields: {
          contentIdeasCreated: '0',
          hubspotTasksSuggested: 'None',
          linearTasksSuggested: 'None',
          routingSummary: 'No action items provided.',
        },
      }),
    };
  }

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: `No portal config for portalId ${portalId}` }) };
  }

  const { objectTypeId, pipelines } = config.content;
  const { pipelineId, stageIds } = pipelines.content;
  const ideaStageId = stageIds.idea;

  // Parse action items (one per line, skip blank lines and bullet prefixes)
  const rawItems = actionItemsText
    .split('\n')
    .map(line => line.replace(/^[-•*\d.]+\s*/, '').trim())
    .filter(line => line.length > 0);

  const routed: RoutedItem[] = rawItems.map(text => ({
    text,
    ...classify(text),
  }));

  const contentIdeas = routed.filter(r => r.category === 'content_idea');
  const linearTasks = routed.filter(r => r.category === 'linear_task');
  const hubspotTasks = routed.filter(r => r.category === 'hubspot_task');

  // Create HubSpot content_piece records for each content idea
  const created: Array<{ title: string; id: string }> = [];
  const failed: string[] = [];

  const notesPrefix = meetingSummary
    ? `From meeting: ${meetingSummary.slice(0, 200)}${meetingSummary.length > 200 ? '…' : ''}\n\n`
    : 'Created from meeting action item.\n\n';

  for (const item of contentIdeas) {
    const id = await createContentIdea(
      token,
      objectTypeId,
      pipelineId,
      ideaStageId,
      item.text,
      `${notesPrefix}Routed from meeting action item.`,
    );
    if (id) {
      created.push({ title: item.text, id });
    } else {
      failed.push(item.text);
    }
  }

  // Format output
  const createdLines = created.length > 0
    ? created.map(c => `  • "${c.title}" (record ${c.id})`).join('\n')
    : '  (none)';

  const failedNote = failed.length > 0
    ? `\n  Failed to create: ${failed.map(f => `"${f}"`).join(', ')}`
    : '';

  const hsTaskLines = hubspotTasks.length > 0
    ? hubspotTasks.map(t => `  • ${t.text}`).join('\n')
    : '  (none)';

  const linearLines = linearTasks.length > 0
    ? linearTasks.map(t => `  • ${t.text}`).join('\n')
    : '  (none)';

  const summary = [
    `Routed ${rawItems.length} action item${rawItems.length !== 1 ? 's' : ''} from meeting:`,
    `  ${contentIdeas.length} → Content Ideas (created in HubSpot)`,
    `  ${linearTasks.length} → Linear task suggestions`,
    `  ${hubspotTasks.length} → HubSpot task suggestions`,
  ].join('\n');

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        contentIdeasCreated: String(created.length),
        hubspotTasksSuggested: hsTaskLines,
        linearTasksSuggested: linearLines,
        routingSummary: `${summary}\n\nContent ideas created in HubSpot (Idea stage):\n${createdLines}${failedNote}`,
      },
    }),
  };
}
