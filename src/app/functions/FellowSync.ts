import { pollFellowActionItems, getFellowMeetingParticipants } from '../lib/fellow-client';
import {
  getFellowLastSync,
  setFellowLastSync,
  findContactByEmail,
  upsertFellowProject,
  associateProjectToContact,
  resolveProjectsPipeline,
} from '../lib/hubspot-client';
import { getPortalConfig } from '../lib/portal-config';

interface FellowSyncBody {
  callbackId: string;
  hs_object_id?: string;
  inputFields: Record<string, string>;
}

interface FellowSyncContext {
  method: string;
  body: FellowSyncBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

function buildActionItemId(meetingId: string, itemIndex: number, assigneeName: string): string {
  return `${meetingId}:${itemIndex}:${assigneeName.toLowerCase().replace(/\s+/g, '_')}`;
}

export async function main(context: FellowSyncContext): Promise<{ statusCode: number; body: string }> {
  const fellowApiKey = process.env.FELLOW_API_KEY;
  if (!fellowApiKey) {
    console.error('FELLOW_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  let config;
  try {
    config = getPortalConfig(context.accountId);
  } catch {
    console.error(`FellowSync: no config for accountId ${context.accountId}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'No portal config' }) };
  }

  const appConfigRecordId = context.body.hs_object_id;
  if (!appConfigRecordId) {
    console.error('FellowSync: no hs_object_id — cannot read/write sync timestamp');
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing hs_object_id' }) };
  }

  const [lastSync, pipeline] = await Promise.all([
    getFellowLastSync(config.appConfig.objectTypeId, appConfigRecordId),
    resolveProjectsPipeline(),
  ]);
  console.log(`FellowSync: polling since ${lastSync ?? 'beginning (7-day window)'}`);

  const groups = await pollFellowActionItems(fellowApiKey, lastSync);

  // Save timestamp before processing so progress is never lost on partial failure
  const now = new Date().toISOString();
  await setFellowLastSync(config.appConfig.objectTypeId, appConfigRecordId, now);
  console.log(`FellowSync: ${groups.length} note(s) with action items, sync timestamp saved`);

  if (groups.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'success', projectsCreated: '0', projectsUpdated: '0' } }),
    };
  }

  let created = 0;
  let updated = 0;

  for (const group of groups) {
    let participants: Awaited<ReturnType<typeof getFellowMeetingParticipants>> = [];
    try {
      participants = await getFellowMeetingParticipants(fellowApiKey, group.meetingId);
    } catch (err) {
      console.warn(`FellowSync: could not fetch participants for meeting ${group.meetingId}:`, err);
    }

    const emailByName = new Map(
      participants.filter(p => p.email).map(p => [p.name.toLowerCase(), p.email]),
    );

    for (let itemIdx = 0; itemIdx < group.actionItems.length; itemIdx++) {
      const item = group.actionItems[itemIdx];

      for (const assignee of item.assignees) {
        const actionItemId = buildActionItemId(group.meetingId, itemIdx, assignee.name);

        const email = emailByName.get(assignee.name.toLowerCase());
        let contactId: string | null = null;
        if (email) {
          try {
            contactId = await findContactByEmail(email);
          } catch (err) {
            console.warn(`FellowSync: contact lookup failed for ${email}:`, err);
          }
        }

        const properties: Record<string, string> = {
          hs_name: item.text.slice(0, 255),
          hs_description: `From meeting: ${group.noteTitle}\nAssigned to: ${assignee.name}`,
          hs_pipeline: pipeline.pipelineId,
          hs_pipeline_stage: assignee.status === 'done'
            ? pipeline.completedStageId
            : pipeline.executionStageId,
          hs_type: 'internal_ops',
          fellow_action_item_id: actionItemId,
        };

        try {
          const result = await upsertFellowProject(actionItemId, properties);
          if (result.action === 'created') {
            created++;
            if (contactId) await associateProjectToContact(result.id, contactId);
          } else {
            updated++;
          }
          console.log(`FellowSync: project ${result.action} id=${result.id} for "${assignee.name}" — "${item.text.slice(0, 60)}"`);
        } catch (err) {
          console.error(`FellowSync: error upserting project for "${item.text.slice(0, 60)}":`, err);
        }
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: { syncStatus: 'success', projectsCreated: String(created), projectsUpdated: String(updated) },
    }),
  };
}
